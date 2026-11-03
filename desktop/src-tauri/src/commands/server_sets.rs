//! Sets shared through the song server.
//!
//! In a server library the setlists of this PC mirror the church's sets on
//! the server (same ids). Local changes are marked `dirty` and uploaded with
//! the version they were based on; the server answers 409 when someone else
//! changed the set first. Then the server's version is kept under the set's
//! id and this PC's edit is kept as a separate copy, so neither is lost.
//!
//! After uploading, the whole list is downloaded again (`GET /sets/snapshot`).
//! Songs a set needs that are not in the offline copy yet (added on a phone
//! since the last library sync) are fetched one by one and indexed.

use std::collections::HashMap;
use std::fs;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use reqwest::header::{AUTHORIZATION, CONTENT_TYPE};
use reqwest::StatusCode;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};

use crate::commands::server_library::{read_manifest, read_token, write_manifest};
use crate::setlist::{valid_id, ServerSetState, Setlist, SetlistItem, SetlistItemType};
use crate::vsb_sync::ServerSongRef;
use crate::{with_state, AppState};

/// How often a connected desktop looks for set changes made elsewhere.
const POLL_INTERVAL: Duration = Duration::from_secs(60);

#[derive(Debug, Clone, Deserialize)]
struct ServerSetItem {
    id: String,
    kind: String,
    song_id: Option<String>,
    #[serde(default)]
    transpose: i32,
    #[serde(default)]
    note: String,
}

#[derive(Debug, Clone, Deserialize)]
struct ServerSet {
    id: String,
    name: String,
    service_date: Option<String>,
    version: i32,
    items: Vec<ServerSetItem>,
}

#[derive(Debug, Serialize)]
struct SetItemInput {
    id: Option<String>,
    kind: &'static str,
    song_id: Option<String>,
    transpose: i32,
    note: String,
}

#[derive(Debug, Default, Clone, Serialize)]
pub struct SetSyncReport {
    pub uploaded: usize,
    pub downloaded: usize,
    /// Edits that arrived after someone else's and were kept as copies.
    pub conflicts: Vec<String>,
    /// Items left out of an upload because their song is not on the server.
    pub skipped_items: usize,
    pub fetched_songs: usize,
    /// The server predates sets (`/sets/snapshot` is missing).
    pub unsupported: bool,
}

/// Set while a sync runs, so the timer and a local edit never overlap.
static RUNNING: AtomicBool = AtomicBool::new(false);
/// Asked for while a sync was running: run once more afterwards.
static AGAIN: AtomicBool = AtomicBool::new(false);

/// Upload local changes soon, off the command that made them.
pub fn request_sync(app: &AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        run_logged(&app).await;
    });
}

/// Poll the server for set changes while a server library is connected.
pub fn spawn_background(app: &AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(POLL_INTERVAL).await;
            run_logged(&app).await;
        }
    });
}

async fn run_logged(app: &AppHandle) {
    if RUNNING.swap(true, Ordering::SeqCst) {
        AGAIN.store(true, Ordering::SeqCst);
        return;
    }
    loop {
        AGAIN.store(false, Ordering::SeqCst);
        let state = app.state::<AppState>();
        match sync_sets(app, &state).await {
            Ok(Some(report)) => {
                if report.uploaded + report.downloaded + report.fetched_songs > 0
                    || !report.conflicts.is_empty()
                {
                    let _ = app.emit("setlists-changed", &report);
                }
            }
            Ok(None) => {}
            Err(error) => eprintln!("[server] set sync failed: {error}"),
        }
        if !AGAIN.load(Ordering::SeqCst) {
            break;
        }
    }
    RUNNING.store(false, Ordering::SeqCst);
}

/// Settings, Church server: synchronize sets now and report what happened.
#[tauri::command]
pub async fn sync_server_sets(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<SetSyncReport, String> {
    let report = sync_sets(&app, &state)
        .await?
        .ok_or_else(|| "No server library is connected".to_string())?;
    let _ = app.emit("setlists-changed", &report);
    Ok(report)
}

struct Context {
    url: String,
    token: String,
    folder: std::path::PathBuf,
}

/// Push dirty setlists, then mirror the server's sets. `None` when no server
/// library is connected (nothing to do).
/// One sync at a time, whoever starts it (timer, edit, library sync,
/// button): two at once could upload a new set twice.
static SYNC_LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

pub(crate) async fn sync_sets(
    app: &AppHandle,
    state: &AppState,
) -> Result<Option<SetSyncReport>, String> {
    let _guard = SYNC_LOCK.lock().await;
    let Some((url, folder)) = with_state(state, |runtime| {
        Ok(
            match (&runtime.config.server_library, &runtime.songs_folder) {
                (Some(server), Some(folder)) if runtime.setlists.is_some() => {
                    Some((server.url.clone(), folder.clone()))
                }
                _ => None,
            },
        )
    })?
    else {
        return Ok(None);
    };
    let Ok(token) = read_token(app) else {
        return Ok(None);
    };
    let context = Context { url, token, folder };
    let client = client()?;
    let mut report = SetSyncReport::default();

    let mut manifest = read_manifest(app, &context.url);
    push_dirty(state, &client, &context, &manifest, &mut report).await?;

    let Some(server_sets) = fetch_snapshot(&client, &context).await? else {
        report.unsupported = true;
        return Ok(Some(report));
    };

    // Songs added on another device since the last library download.
    let known: HashMap<String, String> = manifest
        .values()
        .map(|entry| (entry.id.clone(), entry.filename.clone()))
        .collect();
    let mut missing = server_sets
        .iter()
        .flat_map(|set| set.items.iter())
        .filter_map(|item| item.song_id.clone())
        .filter(|id| !known.contains_key(id))
        .collect::<Vec<_>>();
    missing.sort();
    missing.dedup();
    for song_id in missing {
        match fetch_song(app, state, &client, &context, &song_id).await {
            Ok(entry) => {
                manifest.insert(entry.filename.clone(), entry);
                report.fetched_songs += 1;
            }
            Err(error) => eprintln!("[server] could not fetch song {song_id}: {error}"),
        }
    }
    if report.fetched_songs > 0 {
        write_manifest(app, &context.url, &manifest)?;
    }

    let by_id: HashMap<&str, &str> = manifest
        .values()
        .map(|entry| (entry.id.as_str(), entry.filename.as_str()))
        .collect();
    report.downloaded = mirror(state, &server_sets, &by_id)?;
    Ok(Some(report))
}

async fn push_dirty(
    state: &AppState,
    client: &reqwest::Client,
    context: &Context,
    manifest: &HashMap<String, ServerSongRef>,
    report: &mut SetSyncReport,
) -> Result<(), String> {
    let dirty = with_state(state, |runtime| {
        let store = runtime.setlists.as_ref().ok_or("No library open")?;
        Ok(store
            .list()?
            .into_iter()
            // Setlists from before sets were shared have no server state yet;
            // in a server library every setlist belongs to the church.
            .filter(|setlist| setlist.server.as_ref().is_none_or(|server| server.dirty))
            .collect::<Vec<_>>())
    })?;

    for setlist in dirty {
        let (body, skipped) = upload_body(&setlist, manifest);
        report.skipped_items += skipped;
        let version = setlist.server.as_ref().and_then(|server| server.version);
        let response = match version {
            Some(version) => {
                let mut body = body;
                body["base_version"] = serde_json::json!(version);
                send_json(
                    client,
                    reqwest::Method::PUT,
                    &context.url,
                    &format!("api/v1/sets/{}", setlist.id),
                    &context.token,
                    &body,
                )
                .await?
            }
            None => {
                let mut body = body;
                body["id"] = serde_json::json!(setlist.id);
                send_json(
                    client,
                    reqwest::Method::POST,
                    &context.url,
                    "api/v1/sets",
                    &context.token,
                    &body,
                )
                .await?
            }
        };
        match response {
            Ok(saved) => {
                with_state(state, |runtime| {
                    let store = runtime.setlists.as_mut().ok_or("No library open")?;
                    store.update(&setlist.id, |local| {
                        // Edited again while the upload was on its way:
                        // keep it dirty so that edit goes up next.
                        let unchanged = local.name == setlist.name
                            && local.date == setlist.date
                            && serde_json::to_value(&local.items).ok()
                                == serde_json::to_value(&setlist.items).ok();
                        local.server = Some(ServerSetState {
                            version: Some(saved.version),
                            dirty: !unchanged,
                        });
                    })?;
                    Ok(())
                })?;
                report.uploaded += 1;
            }
            // Someone changed (or deleted) the set first: keep their version
            // under this id and this PC's edit as a copy.
            Err(status) if status == StatusCode::CONFLICT || status == StatusCode::NOT_FOUND => {
                let name = format!("{} (changes from {})", setlist.name, computer_name());
                with_state(state, |runtime| {
                    let store = runtime.setlists.as_mut().ok_or("No library open")?;
                    let mut copy = setlist.clone();
                    copy.id = uuid::Uuid::new_v4().to_string();
                    copy.name = name.clone();
                    for item in &mut copy.items {
                        item.id = Some(uuid::Uuid::new_v4().to_string());
                    }
                    copy.server = Some(ServerSetState {
                        version: None,
                        dirty: true,
                    });
                    store.save(&copy)?;
                    // The original is replaced by the server's copy below.
                    store.update(&setlist.id, |local| {
                        local.server = Some(ServerSetState {
                            version,
                            dirty: false,
                        });
                    })?;
                    Ok(())
                })?;
                report.conflicts.push(setlist.name.clone());
                AGAIN.store(true, Ordering::SeqCst);
            }
            Err(status) if status == StatusCode::FORBIDDEN => {
                return Err(
                    "The song server does not let this desktop change sets (update the server)"
                        .into(),
                );
            }
            // Try the others; this one stays dirty for the next run.
            Err(status) => eprintln!(
                "[server] the song server answered {status} to the upload of {}",
                setlist.name
            ),
        }
    }
    Ok(())
}

/// The JSON sent for a setlist, and how many items had to be left out.
fn upload_body(
    setlist: &Setlist,
    manifest: &HashMap<String, ServerSongRef>,
) -> (serde_json::Value, usize) {
    let mut skipped = 0;
    let items = setlist
        .items
        .iter()
        .filter_map(|item| {
            let id = item
                .id
                .as_deref()
                .and_then(|id| uuid::Uuid::parse_str(id).ok())
                .map(|id| id.to_string());
            let note = item.note.clone().unwrap_or_default();
            match item.item_type {
                SetlistItemType::Song => {
                    let song = item.file.as_deref().and_then(|file| manifest.get(file));
                    match song {
                        Some(song) => Some(SetItemInput {
                            id,
                            kind: "song",
                            song_id: Some(song.id.clone()),
                            transpose: item.transpose.unwrap_or(0).clamp(-11, 11),
                            note,
                        }),
                        None => {
                            skipped += 1;
                            None
                        }
                    }
                }
                SetlistItemType::Blank | SetlistItemType::Hold => Some(SetItemInput {
                    id,
                    kind: "blank",
                    song_id: None,
                    transpose: 0,
                    note,
                }),
            }
        })
        .collect::<Vec<_>>();
    let service_date = chrono::NaiveDate::parse_from_str(&setlist.date, "%Y-%m-%d")
        .ok()
        .map(|date| date.to_string());
    (
        serde_json::json!({
            "name": setlist.name,
            "service_date": service_date,
            "items": items,
        }),
        skipped,
    )
}

/// Replace clean local setlists with the server's; keep dirty ones (they are
/// uploaded next time) and ones not uploaded yet. Returns how many changed.
fn mirror(
    state: &AppState,
    server_sets: &[ServerSet],
    by_id: &HashMap<&str, &str>,
) -> Result<usize, String> {
    with_state(state, |runtime| {
        let store = runtime.setlists.as_mut().ok_or("No library open")?;
        let local = store
            .list()?
            .into_iter()
            .map(|setlist| (setlist.id.clone(), setlist))
            .collect::<HashMap<_, _>>();
        let mut changed = 0;

        for set in server_sets {
            // The id becomes a file name; ignore a set the server named oddly.
            if !valid_id(&set.id) {
                continue;
            }
            if local
                .get(&set.id)
                .and_then(|setlist| setlist.server.as_ref())
                .is_some_and(|server| server.dirty)
            {
                continue;
            }
            let mirrored = Setlist {
                id: set.id.clone(),
                name: set.name.clone(),
                date: set.service_date.clone().unwrap_or_default(),
                items: set
                    .items
                    .iter()
                    .filter_map(|item| {
                        let note = (!item.note.is_empty()).then(|| item.note.clone());
                        match item.kind.as_str() {
                            "song" => {
                                let file = item
                                    .song_id
                                    .as_deref()
                                    .and_then(|id| by_id.get(id))
                                    .map(|file| file.to_string())?;
                                Some(SetlistItem {
                                    item_type: SetlistItemType::Song,
                                    file: Some(file),
                                    transpose: (item.transpose != 0).then_some(item.transpose),
                                    arrangement: None,
                                    id: Some(item.id.clone()),
                                    note,
                                })
                            }
                            "blank" => Some(SetlistItem {
                                item_type: SetlistItemType::Blank,
                                file: None,
                                transpose: None,
                                arrangement: None,
                                id: Some(item.id.clone()),
                                note,
                            }),
                            _ => None,
                        }
                    })
                    .collect(),
                server: Some(ServerSetState {
                    version: Some(set.version),
                    dirty: false,
                }),
            };
            let same = local.get(&set.id).is_some_and(|existing| {
                serde_json::to_value(existing).ok() == serde_json::to_value(&mirrored).ok()
            });
            if !same {
                store.save(&mirrored)?;
                if store
                    .active()
                    .is_some_and(|active| active.id == mirrored.id)
                {
                    let _ = store.load(&mirrored.id);
                }
                changed += 1;
            }
        }

        // Uploaded before and no longer on the server: deleted elsewhere.
        let on_server = server_sets
            .iter()
            .map(|set| set.id.as_str())
            .collect::<std::collections::HashSet<_>>();
        for (id, setlist) in &local {
            let uploaded_clean = setlist
                .server
                .as_ref()
                .is_some_and(|server| server.version.is_some() && !server.dirty);
            if uploaded_clean && valid_id(id) && !on_server.contains(id.as_str()) {
                store.remove(id)?;
                changed += 1;
            }
        }
        Ok(changed)
    })
}

async fn fetch_snapshot(
    client: &reqwest::Client,
    context: &Context,
) -> Result<Option<Vec<ServerSet>>, String> {
    let response = client
        .get(endpoint(&context.url, "api/v1/sets/snapshot")?)
        .header(AUTHORIZATION, format!("Bearer {}", context.token))
        .send()
        .await
        .map_err(|error| format!("could not reach the song server: {error}"))?;
    match response.status() {
        // Servers from before sets answer 404 (or 405 through a proxy).
        StatusCode::NOT_FOUND | StatusCode::METHOD_NOT_ALLOWED => Ok(None),
        status if status.is_success() => response
            .json::<Vec<ServerSet>>()
            .await
            .map(Some)
            .map_err(|error| format!("the song server sent invalid sets: {error}")),
        status => Err(format!("the song server answered {status} for sets")),
    }
}

/// Download one song into the offline copy and index it.
async fn fetch_song(
    app: &AppHandle,
    state: &AppState,
    client: &reqwest::Client,
    context: &Context,
    song_id: &str,
) -> Result<ServerSongRef, String> {
    #[derive(Deserialize)]
    struct Song {
        id: String,
        revision_id: String,
        title: String,
        chordpro: String,
    }
    let id = uuid::Uuid::parse_str(song_id).map_err(|_| "invalid song id".to_string())?;
    let response = client
        .get(endpoint(&context.url, &format!("api/v1/songs/{id}"))?)
        .header(AUTHORIZATION, format!("Bearer {}", context.token))
        .send()
        .await
        .map_err(|error| error.to_string())?;
    if !response.status().is_success() {
        return Err(format!("the song server answered {}", response.status()));
    }
    let song: Song = response.json().await.map_err(|error| error.to_string())?;
    let filename = export_filename(&song.title, id);
    write_song(&context.folder, &filename, &song.chordpro)?;
    let parsed = crate::library::chordpro::parse_chordpro(&song.chordpro, &filename);
    with_state(state, |runtime| {
        if let Some(db) = runtime.db.as_ref() {
            db.upsert_song(&parsed)?;
        }
        Ok(())
    })?;
    let _ = app.emit("library-changed", ());
    Ok(ServerSongRef {
        filename,
        id: song.id,
        revision_id: song.revision_id,
    })
}

/// The offline file for a server song, downloading the song when this PC
/// does not have it yet (created on a phone since the last library sync).
pub(crate) async fn ensure_song(
    app: &AppHandle,
    state: &AppState,
    song_id: &str,
) -> Result<String, String> {
    let (url, folder) = with_state(state, |runtime| {
        match (&runtime.config.server_library, &runtime.songs_folder) {
            (Some(server), Some(folder)) => Ok((server.url.clone(), folder.clone())),
            _ => Err("No server library is connected".to_string()),
        }
    })?;
    let mut manifest = read_manifest(app, &url);
    if let Some(entry) = manifest.values().find(|entry| entry.id == song_id) {
        return Ok(entry.filename.clone());
    }
    let context = Context {
        token: read_token(app)?,
        url,
        folder,
    };
    let entry = fetch_song(app, state, &client()?, &context, song_id).await?;
    let filename = entry.filename.clone();
    manifest.insert(filename.clone(), entry);
    write_manifest(app, &context.url, &manifest)?;
    Ok(filename)
}

fn write_song(folder: &Path, filename: &str, content: &str) -> Result<(), String> {
    let path = crate::library::files::song_path(folder, filename)?;
    let temporary = folder.join(format!(".{filename}.{}.tmp", uuid::Uuid::new_v4()));
    fs::write(&temporary, content).map_err(|error| error.to_string())?;
    if path.exists() {
        fs::remove_file(&path).map_err(|error| error.to_string())?;
    }
    fs::rename(&temporary, &path).map_err(|error| error.to_string())
}

/// The file name the server's export gives a song; matching it means the
/// next full download replaces this file instead of adding a second one.
pub(crate) fn export_filename(title: &str, id: uuid::Uuid) -> String {
    let slug = title
        .chars()
        .map(|character| {
            if character.is_alphanumeric() {
                character.to_ascii_lowercase()
            } else {
                '-'
            }
        })
        .collect::<String>()
        .split('-')
        .filter(|part| !part.is_empty())
        .take(8)
        .collect::<Vec<_>>()
        .join("-");
    let slug = if slug.is_empty() { "song" } else { &slug };
    format!("{slug}-{}.pro", &id.simple().to_string()[..8])
}

fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|error| error.to_string())
}

fn endpoint(server_url: &str, path: &str) -> Result<url::Url, String> {
    url::Url::parse(server_url)
        .and_then(|base| base.join(path))
        .map_err(|error| error.to_string())
}

#[derive(Deserialize)]
struct Saved {
    version: i32,
}

/// Send JSON; `Err(status)` for a non-success answer the caller handles.
async fn send_json(
    client: &reqwest::Client,
    method: reqwest::Method,
    server_url: &str,
    path: &str,
    token: &str,
    body: &serde_json::Value,
) -> Result<Result<Saved, StatusCode>, String> {
    let response = client
        .request(method, endpoint(server_url, path)?)
        .header(AUTHORIZATION, format!("Bearer {token}"))
        .header(CONTENT_TYPE, "application/json")
        .body(body.to_string())
        .send()
        .await
        .map_err(|error| format!("could not reach the song server: {error}"))?;
    let status = response.status();
    if !status.is_success() {
        let message = response.text().await.unwrap_or_default();
        if status == StatusCode::BAD_REQUEST {
            return Err(format!("the song server refused a set: {}", message.trim()));
        }
        return Ok(Err(status));
    }
    response
        .json::<Saved>()
        .await
        .map(Ok)
        .map_err(|error| format!("the song server sent an invalid set: {error}"))
}

pub(crate) fn computer_name() -> String {
    std::env::var("COMPUTERNAME")
        .or_else(|_| std::env::var("HOSTNAME"))
        .ok()
        .filter(|name| !name.trim().is_empty())
        .unwrap_or_else(|| "this PC".into())
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use super::{export_filename, upload_body};
    use crate::setlist::{Setlist, SetlistItem, SetlistItemType};
    use crate::vsb_sync::ServerSongRef;

    fn item(kind: SetlistItemType, file: Option<&str>, transpose: Option<i32>) -> SetlistItem {
        SetlistItem {
            item_type: kind,
            file: file.map(str::to_string),
            transpose,
            arrangement: None,
            id: Some("4b0c1bc4-3f3f-4f8a-9d53-2b2a5b3b7c01".into()),
            note: Some("Capo 2".into()),
        }
    }

    #[test]
    fn matches_the_servers_export_filenames() {
        let id = uuid::Uuid::parse_str("1a2b3c4d-0000-4000-8000-000000000000").unwrap();
        assert_eq!(
            export_filename("Amazing Grace!", id),
            "amazing-grace-1a2b3c4d.pro"
        );
        assert_eq!(export_filename("   ", id), "song-1a2b3c4d.pro");
        // Like the server: only ASCII letters are lowercased.
        assert_eq!(export_filename("Å, Jesus", id), "Å-jesus-1a2b3c4d.pro");
    }

    #[test]
    fn uploads_songs_by_server_id_and_skips_songs_the_server_lacks() {
        let mut manifest = HashMap::new();
        manifest.insert(
            "grace.pro".to_string(),
            ServerSongRef {
                filename: "grace.pro".into(),
                id: "11111111-1111-4111-8111-111111111111".into(),
                revision_id: "r".into(),
            },
        );
        let setlist = Setlist {
            id: "s".into(),
            name: "Sunday".into(),
            date: "2026-10-04".into(),
            items: vec![
                item(SetlistItemType::Song, Some("grace.pro"), Some(14)),
                item(SetlistItemType::Song, Some("local-only.pro"), None),
                item(SetlistItemType::Blank, None, None),
            ],
            server: None,
        };
        let (body, skipped) = upload_body(&setlist, &manifest);
        assert_eq!(skipped, 1);
        assert_eq!(body["service_date"], "2026-10-04");
        let items = body["items"].as_array().unwrap();
        assert_eq!(items.len(), 2);
        assert_eq!(items[0]["song_id"], "11111111-1111-4111-8111-111111111111");
        assert_eq!(items[0]["transpose"], 11);
        assert_eq!(items[0]["note"], "Capo 2");
        assert_eq!(items[1]["kind"], "blank");
    }

    fn app_state(root: &std::path::Path) -> crate::AppState {
        let mut runtime = crate::state::RuntimeState::new(crate::config::AppConfig::default());
        runtime.setlists = Some(crate::setlist::SetlistStore::new(root.to_path_buf()));
        crate::AppState {
            inner: parking_lot::Mutex::new(runtime),
            remote_actions: parking_lot::Mutex::new(None),
            import_cancel: std::sync::atomic::AtomicBool::new(false),
            import_running: std::sync::atomic::AtomicBool::new(false),
        }
    }

    fn server_set(id: &str, version: i32, song_id: &str) -> super::ServerSet {
        serde_json::from_value(serde_json::json!({
            "id": id,
            "name": format!("Set {id}"),
            "service_date": "2026-10-04",
            "version": version,
            "items": [
                { "id": "i1", "kind": "song", "song_id": song_id, "transpose": 2, "note": "Capo 2" },
                { "id": "i2", "kind": "blank" },
                { "id": "i3", "kind": "song", "song_id": "not-on-this-pc" }
            ]
        }))
        .unwrap()
    }

    #[test]
    fn mirrors_server_sets_keeping_local_edits_and_dropping_deleted_sets() {
        use crate::setlist::ServerSetState;
        let dir = tempfile::tempdir().unwrap();
        let state = app_state(dir.path());
        let store = |f: &mut dyn FnMut(&mut crate::setlist::SetlistStore)| {
            let mut runtime = state.inner.lock();
            f(runtime.setlists.as_mut().unwrap());
        };
        let local = |id: &str, server: Option<ServerSetState>| Setlist {
            id: id.into(),
            name: format!("Local {id}"),
            date: "2026-10-04".into(),
            items: vec![],
            server,
        };
        store(&mut |s| {
            // Edited here, not uploaded yet: must survive.
            s.save(&local(
                "dirty",
                Some(ServerSetState {
                    version: Some(1),
                    dirty: true,
                }),
            ))
            .unwrap();
            // Uploaded before and gone from the server: deleted elsewhere.
            s.save(&local(
                "gone",
                Some(ServerSetState {
                    version: Some(3),
                    dirty: false,
                }),
            ))
            .unwrap();
            // Never uploaded: only on this PC.
            s.save(&local("mine", None)).unwrap();
        });
        let mut by_id = HashMap::new();
        by_id.insert("song-1", "grace.pro");
        let sets = vec![
            server_set("new", 4, "song-1"),
            server_set("dirty", 2, "song-1"),
        ];

        assert_eq!(super::mirror(&state, &sets, &by_id).unwrap(), 2);
        let mut ids = Vec::new();
        store(&mut |s| {
            let list = s.list().unwrap();
            ids = list.iter().map(|set| set.id.clone()).collect();
            let new = list.iter().find(|set| set.id == "new").unwrap();
            assert_eq!(
                new.server,
                Some(ServerSetState {
                    version: Some(4),
                    dirty: false
                })
            );
            assert_eq!(new.items.len(), 2, "songs this PC lacks are left out");
            assert_eq!(new.items[0].file.as_deref(), Some("grace.pro"));
            assert_eq!(new.items[0].transpose, Some(2));
            assert_eq!(new.items[0].note.as_deref(), Some("Capo 2"));
            assert!(matches!(new.items[1].item_type, SetlistItemType::Blank));
            let dirty = list.iter().find(|set| set.id == "dirty").unwrap();
            assert_eq!(dirty.name, "Local dirty");
        });
        ids.sort();
        assert_eq!(ids, vec!["dirty", "mine", "new"]);

        // A second pass with nothing new changes nothing.
        assert_eq!(super::mirror(&state, &sets, &by_id).unwrap(), 0);
    }

    #[test]
    fn sends_no_date_for_a_setlist_dated_in_another_format() {
        let setlist = Setlist {
            id: "s".into(),
            name: "Old".into(),
            date: "23.09.26".into(),
            items: vec![],
            server: None,
        };
        let (body, _) = upload_body(&setlist, &HashMap::new());
        assert!(body["service_date"].is_null());
    }
}
