//! Two-way synchronisation between the active Psalm150 library and a Visual
//! Song Book `.mdb`. Rows are read with `jetdb`; writes go through the Access
//! ODBC driver (`writer`). The link table in `vsb-sync.json` records the hashes
//! both sides had after the previous run, so each run knows which side changed.

pub mod fields;
pub mod plan;
pub mod writer;

use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};

use chrono::Utc;
use serde::{Deserialize, Serialize};

use crate::import::mdb::{read_vsb_categories, read_vsb_mdb, VsbSongRow};
use crate::import::vsb_to_chordpro::convert_song;
use crate::library::chordpro::{parse_chordpro, serialize_chordpro, ParsedSong};
use crate::library::files::{
    content_hash, create_song_unique, delete_song_recoverable, replace_song,
};
use crate::library::scan_songs_folder;

use fields::{fields_from_song, row_hash};
use plan::{Action, FileSnapshot, Link, PlanInput};
use writer::VsbWriter;

const MAX_BACKUPS: usize = 10;

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct SyncState {
    pub mdb_path: String,
    pub links: Vec<Link>,
}

/// What one run did. Blocked items are changes that could not be applied on
/// this PC (no Access driver, read-only library, server permissions).
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct VsbSyncReport {
    pub files_written: usize,
    pub files_created: usize,
    pub files_deleted: usize,
    pub rows_written: usize,
    pub rows_inserted: usize,
    pub rows_deleted: usize,
    pub conflicts: usize,
    pub differing: usize,
    pub sent_to_server: usize,
    pub linked: usize,
    pub blocked: Vec<String>,
    pub errors: Vec<String>,
    /// Songs whose number another VSB song already had: Psalm150 gave them
    /// the next free number before writing them to VSB ("Way Maker: 12 → 1041").
    #[serde(default)]
    pub renumbered: Vec<String>,
    pub backup: Option<String>,
    pub finished_at: String,
}

impl VsbSyncReport {
    pub fn changed_library(&self) -> bool {
        self.files_written + self.files_created + self.files_deleted > 0
    }

    pub fn summary(&self) -> String {
        let to_library = self.files_written + self.files_created + self.files_deleted;
        let to_vsb = self.rows_written + self.rows_inserted + self.rows_deleted;
        let mut parts = Vec::new();
        if to_library == 0 && to_vsb == 0 && self.sent_to_server == 0 {
            parts.push("Everything is in step".to_string());
        } else {
            if to_library > 0 {
                parts.push(format!("{to_library} updated in Psalm150"));
            }
            if self.sent_to_server > 0 {
                parts.push(format!("{} sent to the song server", self.sent_to_server));
            }
            if to_vsb > 0 {
                parts.push(format!("{to_vsb} updated in VSB"));
            }
        }
        if self.conflicts > 0 {
            parts.push(format!(
                "{} edited on both sides (Psalm150 version kept)",
                self.conflicts
            ));
        }
        if !self.renumbered.is_empty() {
            parts.push(format!(
                "{} given a new number (theirs was taken in VSB)",
                self.renumbered.len()
            ));
        }
        if !self.blocked.is_empty() {
            parts.push(format!("{} waiting", self.blocked.len()));
        }
        if !self.errors.is_empty() {
            parts.push(format!("{} failed", self.errors.len()));
        }
        parts.join(" · ")
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct VsbSyncProgress {
    pub label: String,
    pub current: usize,
    pub total: usize,
}

/// Where library-side changes go.
pub enum LibraryTarget<'a> {
    /// A local songs folder this PC may write (unless `read_only`).
    Local {
        app: &'a tauri::AppHandle,
        folder_hash: &'a str,
        read_only: bool,
    },
    /// The read-only replica of a song server: changes become [`ServerOp`]s
    /// sent with the desktop token, then the replica is downloaded again.
    /// `manifest` maps replica filenames to server songs (from the export).
    Server {
        manifest: &'a HashMap<String, ServerSongRef>,
    },
}

/// A server song behind a replica file, from `psa150-manifest.json`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServerSongRef {
    pub filename: String,
    pub id: String,
    pub revision_id: String,
}

/// A change for the song server. Updates and deletes carry the revision the
/// replica was built from, so a newer server edit answers 409 instead of
/// being overwritten. Their links are left as they were: only the next pass,
/// after the replica is downloaded again, sees the change and relinks, so a
/// failed request is simply retried.
#[derive(Debug, Clone)]
pub enum ServerOp {
    Import {
        filename: String,
        chordpro: String,
    },
    Update {
        song_id: String,
        base_revision_id: String,
        title: String,
        chordpro: String,
    },
    Delete {
        song_id: String,
        base_revision_id: String,
        title: String,
    },
}

/// Opens the database for writing, or explains why it cannot be written.
pub type OpenWriter = dyn Fn(&Path) -> Result<Box<dyn VsbWriter>, String>;

pub struct SyncRun<'a> {
    pub mdb_path: &'a Path,
    pub songs_folder: &'a Path,
    pub target: LibraryTarget<'a>,
    pub backup_dir: &'a Path,
    pub progress: &'a dyn Fn(VsbSyncProgress),
    pub open_writer: &'a OpenWriter,
}

pub struct SyncOutcome {
    pub links: Vec<Link>,
    pub report: VsbSyncReport,
    /// Changes for the song server (server libraries only).
    pub server_ops: Vec<ServerOp>,
}

pub fn state_path(library_root: &Path) -> PathBuf {
    library_root.join("vsb-sync.json")
}

pub fn load_state(library_root: &Path, mdb_path: &Path) -> SyncState {
    let state: SyncState = fs::read_to_string(state_path(library_root))
        .ok()
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default();
    if Path::new(&state.mdb_path) == mdb_path {
        state
    } else {
        SyncState {
            mdb_path: mdb_path.to_string_lossy().into(),
            links: Vec::new(),
        }
    }
}

pub fn save_state(library_root: &Path, state: &SyncState) -> Result<(), String> {
    fs::create_dir_all(library_root).map_err(|e| e.to_string())?;
    let text = serde_json::to_string_pretty(state).map_err(|e| e.to_string())?;
    let path = state_path(library_root);
    let temp = path.with_extension("json.tmp");
    fs::write(&temp, text).map_err(|e| e.to_string())?;
    if path.exists() {
        fs::remove_file(&path).map_err(|e| e.to_string())?;
    }
    fs::rename(temp, path).map_err(|e| e.to_string())
}

/// Cheap change marker: size and timestamp of the database plus every song
/// file. Periodic runs skip the full comparison while it is unchanged.
pub fn fingerprint(mdb_path: &Path, songs_folder: &Path) -> String {
    let stamp = |path: &Path| {
        fs::metadata(path)
            .ok()
            .map(|meta| {
                let modified = meta
                    .modified()
                    .ok()
                    .and_then(|m| m.duration_since(std::time::UNIX_EPOCH).ok())
                    .map(|d| d.as_millis())
                    .unwrap_or_default();
                format!("{}:{modified}", meta.len())
            })
            .unwrap_or_default()
    };
    let mut parts = vec![stamp(mdb_path)];
    if let Ok(files) = crate::library::scan::list_chordpro_files(songs_folder) {
        let mut stamps: Vec<String> = files
            .iter()
            .map(|path| format!("{}={}", path.display(), stamp(path)))
            .collect();
        stamps.sort();
        parts.extend(stamps);
    }
    content_hash(&parts.join("\n"))
}

pub fn run(sync: SyncRun<'_>, links: &[Link]) -> Result<SyncOutcome, String> {
    (sync.progress)(VsbSyncProgress {
        label: "Reading Visual Song Book".into(),
        current: 0,
        total: 0,
    });
    let rows = read_vsb_mdb(sync.mdb_path)?;
    let categories = read_vsb_categories(sync.mdb_path).unwrap_or_default();
    let songs = scan_songs_folder(sync.songs_folder)?;

    if !links.is_empty() && rows.is_empty() {
        return Err("The VSB database has no songs; nothing was changed".into());
    }
    if !links.is_empty() && songs.is_empty() {
        return Err("The song library is empty; nothing was changed".into());
    }

    let row_hashes: HashMap<i64, String> = rows.iter().map(|r| (r.song_id, row_hash(r))).collect();
    let converted: HashMap<i64, String> = rows
        .iter()
        .filter_map(|row| {
            convert_song(row, &categories)
                .ok()
                .map(|(_, content)| (row.song_id, content))
        })
        .collect();
    let files: Vec<FileSnapshot> = songs
        .iter()
        .map(|song| FileSnapshot {
            filename: song.meta.filename.clone(),
            hash: content_hash(&song.raw),
            vsb_song_id: song.meta.vsb_song_id,
            title: song.meta.title.clone(),
            song_num: song.meta.song_num,
            content: song.raw.clone(),
        })
        .collect();

    let actions = plan::plan(PlanInput {
        rows: &rows,
        row_hashes: &row_hashes,
        files: &files,
        links,
        converted: &converted,
    });

    let deletions = actions
        .iter()
        .filter(|a| matches!(a, Action::DeleteFile { .. } | Action::DeleteRow { .. }))
        .count();
    if deletions > 10 && deletions * 2 > links.len() {
        return Err(format!(
            "{deletions} songs would be deleted, which looks like the wrong database or folder; nothing was changed"
        ));
    }

    let rows_by_id: HashMap<i64, &VsbSongRow> = rows.iter().map(|r| (r.song_id, r)).collect();
    let songs_by_name: HashMap<&str, &ParsedSong> = songs
        .iter()
        .map(|s| (s.meta.filename.as_str(), s))
        .collect();
    let previous: HashMap<i64, &Link> = links.iter().map(|l| (l.song_id, l)).collect();
    let previous_by_file: HashMap<&str, &Link> =
        links.iter().map(|l| (l.filename.as_str(), l)).collect();

    // Song numbers in use: a song is never written to VSB under a number
    // another VSB song has (that fails); it gets the next free one instead.
    let mut numbers = Numbers::new(&rows, &songs);

    let mut exec = Executor {
        sync: &sync,
        categories: &categories,
        report: VsbSyncReport::default(),
        links: Vec::new(),
        server_ops: Vec::new(),
        writer: None,
        writer_error: None,
        rehash_rows: HashMap::new(),
    };

    let total = actions
        .iter()
        .filter(|a| !matches!(a, Action::Keep(_) | Action::LinkDiffering(_)))
        .count();
    let mut done = 0;

    for action in actions {
        let keep_previous_by_id = |exec: &mut Executor, id: i64| {
            if let Some(link) = previous.get(&id) {
                exec.links.push((*link).clone());
            }
        };
        match action {
            Action::Keep(link) => {
                exec.report.linked += 1;
                exec.links.push(link);
                continue;
            }
            Action::LinkDiffering(link) => {
                exec.report.linked += 1;
                exec.report.differing += 1;
                exec.links.push(link);
                continue;
            }
            _ => {}
        }
        done += 1;
        (sync.progress)(VsbSyncProgress {
            label: "Synchronizing with Visual Song Book".into(),
            current: done,
            total,
        });

        match action {
            Action::Keep(_) | Action::LinkDiffering(_) => {}
            Action::WriteFile { song_id, filename } => {
                let row = rows_by_id[&song_id];
                match exec.write_file(row, songs_by_name.get(filename.as_str()).copied()) {
                    Ok(Some(link)) => {
                        exec.report.files_written += 1;
                        exec.links.push(link);
                    }
                    Ok(None) => keep_previous_by_id(&mut exec, song_id),
                    Err(error) => {
                        exec.report.errors.push(format!("{}: {error}", row.title));
                        keep_previous_by_id(&mut exec, song_id);
                    }
                }
            }
            Action::CreateFile { song_id } => {
                let row = rows_by_id[&song_id];
                match exec.create_file(row) {
                    Ok(Some(link)) => {
                        exec.report.files_created += 1;
                        exec.links.push(link);
                    }
                    Ok(None) => keep_previous_by_id(&mut exec, song_id),
                    Err(error) => {
                        exec.report.errors.push(format!("{}: {error}", row.title));
                        keep_previous_by_id(&mut exec, song_id);
                    }
                }
            }
            Action::DeleteFile { filename } => match exec.delete_file(&filename) {
                Ok(true) => exec.report.files_deleted += 1,
                Ok(false) => {
                    if let Some(link) = previous_by_file.get(filename.as_str()) {
                        exec.links.push((*link).clone());
                    }
                }
                Err(error) => {
                    exec.report.errors.push(format!("{filename}: {error}"));
                    if let Some(link) = previous_by_file.get(filename.as_str()) {
                        exec.links.push((*link).clone());
                    }
                }
            },
            Action::WriteRow {
                song_id,
                filename,
                conflict,
            } => {
                let renumbered = exec.free_number(songs_by_name[filename.as_str()], Some(song_id), &mut numbers);
                let song = renumbered.as_ref().unwrap_or(songs_by_name[filename.as_str()]);
                let fallback_category = rows_by_id.get(&song_id).map_or(0, |r| r.category_id);
                match exec.with_writer(|writer, categories| {
                    writer.update(
                        song_id,
                        &fields_from_song(song, categories, fallback_category),
                    )
                }) {
                    Ok(Some(())) => {
                        exec.report.rows_written += 1;
                        if conflict {
                            exec.report.conflicts += 1;
                        }
                        exec.rehash_rows
                            .insert(song_id, (filename.clone(), content_hash(&song.raw)));
                    }
                    Ok(None) => keep_previous_by_id(&mut exec, song_id),
                    Err(error) => {
                        exec.report.errors.push(format!("{filename}: {error}"));
                        keep_previous_by_id(&mut exec, song_id);
                    }
                }
            }
            Action::InsertRow { filename } => {
                let renumbered = exec.free_number(songs_by_name[filename.as_str()], None, &mut numbers);
                let song = renumbered.as_ref().unwrap_or(songs_by_name[filename.as_str()]);
                match exec.with_writer(|writer, categories| {
                    writer.insert(&fields_from_song(song, categories, 0))
                }) {
                    Ok(Some(song_id)) => {
                        numbers.take(song.meta.song_num, song_id);
                        exec.report.rows_inserted += 1;
                        exec.rehash_rows
                            .insert(song_id, (filename.clone(), content_hash(&song.raw)));
                    }
                    Ok(None) => {}
                    Err(error) => exec.report.errors.push(format!("{filename}: {error}")),
                }
            }
            Action::DeleteRow { song_id } => {
                match exec.with_writer(|writer, _| writer.delete(song_id)) {
                    Ok(Some(())) => exec.report.rows_deleted += 1,
                    Ok(None) => keep_previous_by_id(&mut exec, song_id),
                    Err(error) => {
                        exec.report
                            .errors
                            .push(format!("VSB song {song_id}: {error}"));
                        keep_previous_by_id(&mut exec, song_id);
                    }
                }
            }
        }
    }

    // Rows we wrote are hashed as the database now stores them, so the next
    // run does not mistake the driver's normalisation for an edit.
    exec.writer = None;
    if !exec.rehash_rows.is_empty() {
        let reread = read_vsb_mdb(sync.mdb_path)?;
        for row in reread {
            if let Some((filename, file_hash)) = exec.rehash_rows.remove(&row.song_id) {
                exec.links.push(Link {
                    song_id: row.song_id,
                    filename,
                    row_hash: row_hash(&row),
                    file_hash,
                });
            }
        }
    }

    if let Some(error) = exec.writer_error.take() {
        exec.report.blocked.insert(0, error);
    }
    let mut seen = HashSet::new();
    exec.links.retain(|link| seen.insert(link.song_id));
    exec.report.finished_at = Utc::now().to_rfc3339();
    Ok(SyncOutcome {
        links: exec.links,
        report: exec.report,
        server_ops: exec.server_ops,
    })
}

struct Executor<'r, 'a> {
    sync: &'r SyncRun<'a>,
    categories: &'r [(i64, String)],
    report: VsbSyncReport,
    links: Vec<Link>,
    server_ops: Vec<ServerOp>,
    writer: Option<Box<dyn VsbWriter>>,
    /// Set once opening the writer failed; later row changes wait silently.
    writer_error: Option<String>,
    rehash_rows: HashMap<i64, (String, String)>,
}

/// Which VSB song has which number, and the next number nobody has.
struct Numbers {
    in_vsb: HashMap<i64, i64>,
    next: i64,
}

impl Numbers {
    fn new(rows: &[VsbSongRow], songs: &[ParsedSong]) -> Self {
        let in_vsb = rows
            .iter()
            .filter(|row| row.song_num > 0)
            .map(|row| (row.song_num, row.song_id))
            .collect::<HashMap<_, _>>();
        let highest = rows
            .iter()
            .map(|row| row.song_num)
            .chain(songs.iter().filter_map(|song| song.meta.song_num))
            .max()
            .unwrap_or(0);
        Self { in_vsb, next: highest + 1 }
    }

    /// `number` is held by a VSB song other than `song_id` (any, for a new row).
    fn clashes(&self, number: Option<i64>, song_id: Option<i64>) -> bool {
        number
            .and_then(|n| self.in_vsb.get(&n))
            .is_some_and(|holder| Some(*holder) != song_id)
    }

    fn fresh(&mut self) -> i64 {
        let number = self.next;
        self.next += 1;
        number
    }

    fn take(&mut self, number: Option<i64>, song_id: i64) {
        if let Some(number) = number {
            self.in_vsb.insert(number, song_id);
        }
    }
}

/// The song's ChordPro with `{meta: song_num=N}` set: the old number line
/// replaced, or a new one under `{title}`. Everything else stays as written.
pub(crate) fn with_song_num(raw: &str, number: i64) -> String {
    let directive = format!("{{meta: song_num={number}}}");
    let newline = if raw.contains("\r\n") { "\r\n" } else { "\n" };
    let is_number = |line: &str| {
        let line = line.trim().to_ascii_lowercase();
        line.starts_with("{meta:") && line.contains("song_num=")
    };
    let mut lines: Vec<String> = raw.lines().map(str::to_string).collect();
    if let Some(at) = lines.iter().position(|l| is_number(l)) {
        lines[at] = directive;
    } else {
        let title = lines.iter().position(|l| {
            let l = l.trim().to_ascii_lowercase();
            l.starts_with("{title:") || l.starts_with("{t:")
        });
        lines.insert(title.map_or(0, |i| i + 1), directive);
    }
    let mut out = lines.join(newline);
    if raw.ends_with('\n') {
        out.push_str(newline);
    }
    out
}

impl<'r, 'a> Executor<'r, 'a> {
    /// When the song's number belongs to another VSB song, give it the next
    /// free number in Psalm150 first (the file, or the server song), and
    /// return the renumbered song to write to VSB. `None`: the number is
    /// free, or the song has none (VSB then picks or keeps one).
    fn free_number(
        &mut self,
        song: &ParsedSong,
        song_id: Option<i64>,
        numbers: &mut Numbers,
    ) -> Option<ParsedSong> {
        if !numbers.clashes(song.meta.song_num, song_id) {
            return None;
        }
        let old = song.meta.song_num.unwrap_or_default();
        let number = numbers.fresh();
        let content = with_song_num(&song.raw, number);
        let what = format!("\"{}\" needs a new number", song.meta.title);
        let saved = if matches!(self.sync.target, LibraryTarget::Server { .. }) {
            match self.server_song(&song.meta.filename, &what) {
                Some(server) => {
                    self.server_ops.push(ServerOp::Update {
                        song_id: server.id,
                        base_revision_id: server.revision_id,
                        title: song.meta.title.clone(),
                        chordpro: content.clone(),
                    });
                    self.report.sent_to_server += 1;
                    true
                }
                None => false,
            }
        } else {
            match self.local(&what) {
                Some((app, folder_hash)) => replace_song(
                    app,
                    folder_hash,
                    self.sync.songs_folder,
                    &song.meta.filename,
                    &content,
                    &content_hash(&song.raw),
                )
                .map_err(|error| self.report.errors.push(format!("{}: {error}", song.meta.filename)))
                .is_ok(),
                None => false,
            }
        };
        let mut renumbered = parse_chordpro(&content, &song.meta.filename);
        if !saved {
            // Psalm150 keeps its number for now; VSB gets the song without
            // one, so it picks a free number (or keeps the row's).
            renumbered = song.clone();
            renumbered.meta.song_num = None;
            return Some(renumbered);
        }
        self.report
            .renumbered
            .push(format!("{}: {old} → {number}", song.meta.title));
        Some(renumbered)
    }

    /// Runs `f` with an open writer, backing the database up first. `None`
    /// means writing is unavailable on this PC and the change waits.
    fn with_writer<T>(
        &mut self,
        f: impl FnOnce(&mut dyn VsbWriter, &[(i64, String)]) -> Result<T, String>,
    ) -> Result<Option<T>, String> {
        if self.writer_error.is_some() {
            return Ok(None);
        }
        if self.writer.is_none() {
            match backup_database(self.sync.mdb_path, self.sync.backup_dir)
                .and_then(|backup| (self.sync.open_writer)(self.sync.mdb_path).map(|w| (backup, w)))
            {
                Ok((backup, writer)) => {
                    self.report.backup = Some(backup.to_string_lossy().into());
                    self.writer = Some(writer);
                }
                Err(error) => {
                    self.writer_error = Some(error);
                    return Ok(None);
                }
            }
        }
        f(self.writer.as_deref_mut().unwrap(), self.categories).map(Some)
    }

    /// Local folder the file change may be written to; `None` when it must
    /// wait (read-only) or goes to the server instead.
    fn local(&mut self, what: &str) -> Option<(&'r tauri::AppHandle, &'r str)> {
        let sync: &'r SyncRun<'a> = self.sync;
        match &sync.target {
            LibraryTarget::Local {
                app,
                folder_hash,
                read_only: false,
            } => Some((*app, *folder_hash)),
            LibraryTarget::Local {
                read_only: true, ..
            } => {
                self.report
                    .blocked
                    .push(format!("{what}: the library is read-only"));
                None
            }
            LibraryTarget::Server { .. } => None,
        }
    }

    /// Server song behind a replica file. A missing entry (older server, or
    /// no manifest yet) makes the change wait.
    fn server_song(&mut self, filename: &str, what: &str) -> Option<ServerSongRef> {
        let LibraryTarget::Server { manifest } = &self.sync.target else {
            return None;
        };
        let found = manifest.get(filename).cloned();
        if found.is_none() {
            self.report.blocked.push(format!(
                "{what}: the song server did not list this file; synchronize the server library, or update the server"
            ));
        }
        found
    }

    /// Row changed in VSB: rewrite the file, keeping Psalm150-only metadata.
    fn write_file(
        &mut self,
        row: &VsbSongRow,
        existing: Option<&ParsedSong>,
    ) -> Result<Option<Link>, String> {
        let what = format!("\"{}\" was edited in VSB", row.title);
        let existing = existing.ok_or("the song file is missing")?;
        let (_, converted) = convert_song(row, self.categories)?;
        let mut song = parse_chordpro(&converted, &existing.meta.filename);
        song.meta.ccli = existing.meta.ccli.clone();
        song.meta.tags = existing.meta.tags.clone();
        song.meta.base_song = existing.meta.base_song.clone();
        if existing.meta.arrangement.is_some() {
            song.meta.arrangement = existing.meta.arrangement.clone();
        }
        let content = serialize_chordpro(&song);
        if matches!(self.sync.target, LibraryTarget::Server { .. }) {
            let Some(server) = self.server_song(&existing.meta.filename, &what) else {
                return Ok(None);
            };
            self.server_ops.push(ServerOp::Update {
                song_id: server.id,
                base_revision_id: server.revision_id,
                title: row.title.clone(),
                chordpro: content,
            });
            self.report.sent_to_server += 1;
            return Ok(None);
        } else {
            let Some((app, folder_hash)) = self.local(&what) else {
                return Ok(None);
            };
            replace_song(
                app,
                folder_hash,
                self.sync.songs_folder,
                &existing.meta.filename,
                &content,
                &content_hash(&existing.raw),
            )?;
        }
        Ok(Some(Link {
            song_id: row.song_id,
            filename: existing.meta.filename.clone(),
            row_hash: row_hash(row),
            file_hash: content_hash(&content),
        }))
    }

    fn create_file(&mut self, row: &VsbSongRow) -> Result<Option<Link>, String> {
        let (filename, content) = convert_song(row, self.categories)?;
        if matches!(self.sync.target, LibraryTarget::Server { .. }) {
            self.server_ops.push(ServerOp::Import {
                filename,
                chordpro: content,
            });
            self.report.sent_to_server += 1;
            return Ok(None);
        }
        let what = format!("\"{}\" is new in VSB", row.title);
        if self.local(&what).is_none() {
            return Ok(None);
        }
        let filename = create_song_unique(self.sync.songs_folder, &filename, &content)?;
        Ok(Some(Link {
            song_id: row.song_id,
            filename,
            row_hash: row_hash(row),
            file_hash: content_hash(&content),
        }))
    }

    fn delete_file(&mut self, filename: &str) -> Result<bool, String> {
        let what = format!("{filename} was deleted in VSB");
        if matches!(self.sync.target, LibraryTarget::Server { .. }) {
            let Some(server) = self.server_song(filename, &what) else {
                return Ok(false);
            };
            self.server_ops.push(ServerOp::Delete {
                song_id: server.id,
                base_revision_id: server.revision_id,
                title: filename.to_string(),
            });
            self.report.sent_to_server += 1;
            return Ok(false);
        }
        let Some((app, folder_hash)) = self.local(&what) else {
            return Ok(false);
        };
        delete_song_recoverable(app, folder_hash, self.sync.songs_folder, filename)?;
        Ok(true)
    }
}

fn backup_database(mdb_path: &Path, backup_dir: &Path) -> Result<PathBuf, String> {
    fs::create_dir_all(backup_dir)
        .map_err(|e| format!("Could not back up the VSB database: {e}"))?;
    let stem = mdb_path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("vsb");
    let extension = mdb_path
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("mdb");
    let destination = backup_dir.join(format!(
        "{stem}-{}.{extension}",
        Utc::now().format("%Y%m%d-%H%M%S")
    ));
    fs::copy(mdb_path, &destination)
        .map_err(|e| format!("Could not back up the VSB database: {e}"))?;

    let mut backups: Vec<PathBuf> = fs::read_dir(backup_dir)
        .map_err(|e| e.to_string())?
        .filter_map(|entry| entry.ok().map(|e| e.path()))
        .filter(|path| {
            path.file_name()
                .and_then(|n| n.to_str())
                .is_some_and(|n| n.starts_with(&format!("{stem}-")))
        })
        .collect();
    backups.sort();
    while backups.len() > MAX_BACKUPS {
        let _ = fs::remove_file(backups.remove(0));
    }
    Ok(destination)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn row(song_id: i64, song_num: i64) -> VsbSongRow {
        VsbSongRow {
            song_id,
            song_num,
            title: format!("Song {song_id}"),
            body: String::new(),
            key: None,
            author: None,
            copyright: None,
            category_id: 0,
        }
    }

    #[test]
    fn sets_the_number_line_or_adds_one_under_the_title() {
        assert_eq!(
            with_song_num("{title: A}\n{meta: song_num=12}\n\n[G]Words\n", 41),
            "{title: A}\n{meta: song_num=41}\n\n[G]Words\n"
        );
        assert_eq!(
            with_song_num("{title: A}\r\n\r\nWords", 7),
            "{title: A}\r\n{meta: song_num=7}\r\n\r\nWords"
        );
        assert_eq!(parse_chordpro(&with_song_num("{title: A}\nWords\n", 9), "a.pro").meta.song_num, Some(9));
    }

    #[test]
    fn a_number_another_vsb_song_has_is_a_clash() {
        let songs = vec![parse_chordpro("{title: Mine}\n{meta: song_num=40}\nWords", "0040-mine.pro")];
        let mut numbers = Numbers::new(&[row(1, 12), row(2, 30)], &songs);
        assert!(numbers.clashes(Some(12), None), "a new row may not take 12");
        assert!(numbers.clashes(Some(12), Some(2)), "nor may another row");
        assert!(!numbers.clashes(Some(12), Some(1)), "its own row keeps it");
        assert!(!numbers.clashes(Some(13), None));
        assert!(!numbers.clashes(None, None));
        // Above everything in VSB and in Psalm150.
        assert_eq!(numbers.fresh(), 41);
        assert_eq!(numbers.fresh(), 42);
        numbers.take(Some(41), 3);
        assert!(numbers.clashes(Some(41), None));
    }
}
