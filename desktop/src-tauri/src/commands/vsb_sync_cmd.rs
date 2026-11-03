use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};

use parking_lot::Mutex;
use tauri::{AppHandle, Emitter, Manager, State};

use crate::config::{self, VsbSyncConfig};
use crate::vsb_sync::{self, LibraryTarget, ServerOp, SyncRun, VsbSyncProgress, VsbSyncReport};
use crate::{emit_library_changed, with_state, AppState};

static RUNNING: AtomicBool = AtomicBool::new(false);
/// Fingerprint of database and folder after the last completed run.
static LAST_FINGERPRINT: Mutex<Option<String>> = Mutex::new(None);

struct RunningGuard;

impl Drop for RunningGuard {
    fn drop(&mut self) {
        RUNNING.store(false, Ordering::SeqCst);
    }
}

/// Link a VSB database (or unlink with `None`). The file is read once to make
/// sure it is a VSB songbook before it is remembered.
#[tauri::command]
pub fn set_vsb_database(
    app: AppHandle,
    state: State<'_, AppState>,
    path: Option<String>,
) -> Result<Option<VsbSyncConfig>, String> {
    let config = match path {
        Some(path) => {
            let path = PathBuf::from(path);
            if !path.is_file() {
                return Err(format!("VSB database not found: {}", path.display()));
            }
            crate::import::mdb::read_vsb_mdb(&path)
                .map_err(|e| format!("This file is not a readable VSB songbook: {e}"))?;
            Some(VsbSyncConfig {
                mdb_path: path.to_string_lossy().into(),
                last_synced_at: None,
                last_summary: None,
                last_error: None,
            })
        }
        None => None,
    };
    *LAST_FINGERPRINT.lock() = None;
    with_state(&state, |runtime| {
        runtime.config.vsb_sync = config.clone();
        runtime.config.save(&app)
    })?;
    Ok(config)
}

/// Synchronise the linked VSB database with the active library. Returns
/// `None` when nothing is linked, a run is already going, or (unless `force`)
/// neither side changed since the last run. The work runs off the async
/// runtime and never holds the state lock while touching files.
#[tauri::command]
pub async fn sync_vsb_database(
    app: AppHandle,
    state: State<'_, AppState>,
    force: bool,
) -> Result<Option<VsbSyncReport>, String> {
    let Some(context) = sync_context(&state)? else {
        return Ok(None);
    };
    if state.import_running.load(Ordering::SeqCst) {
        return Ok(None);
    }
    if RUNNING
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_err()
    {
        return Ok(None);
    }
    let _guard = RunningGuard;

    if !force {
        let (mdb, folder) = (context.mdb_path.clone(), context.songs_folder.clone());
        let print =
            tauri::async_runtime::spawn_blocking(move || vsb_sync::fingerprint(&mdb, &folder))
                .await
                .map_err(|e| e.to_string())?;
        if LAST_FINGERPRINT.lock().as_deref() == Some(print.as_str()) {
            return Ok(None);
        }
    }

    let result = run_passes(&app, &state, context).await;
    let (summary, error) = match &result {
        Ok(report) => (Some(report.summary()), None),
        Err(error) => (None, Some(error.clone())),
    };
    let _ = with_state(&state, |runtime| {
        if let Some(sync) = runtime.config.vsb_sync.as_mut() {
            if summary.is_some() {
                sync.last_synced_at = Some(chrono::Utc::now().to_rfc3339());
                sync.last_summary = summary.clone();
            }
            sync.last_error = error.clone();
        }
        runtime.config.save(&app)
    });
    let _ = app.emit(
        "vsb-sync-finished",
        VsbSyncFinished {
            report: result.as_ref().ok().cloned(),
            error: error.clone(),
        },
    );
    result.map(Some)
}

#[derive(Clone, serde::Serialize)]
struct VsbSyncFinished {
    report: Option<VsbSyncReport>,
    error: Option<String>,
}

#[derive(Clone)]
struct SyncContext {
    mdb_path: PathBuf,
    songs_folder: PathBuf,
    folder_hash: String,
    read_only: bool,
    server_url: Option<String>,
}

fn sync_context(state: &State<'_, AppState>) -> Result<Option<SyncContext>, String> {
    with_state(state, |runtime| {
        let (Some(sync), Some(folder), Some(hash)) = (
            runtime.config.vsb_sync.as_ref(),
            runtime.songs_folder.clone(),
            runtime.folder_hash.clone(),
        ) else {
            return Ok(None);
        };
        Ok(Some(SyncContext {
            mdb_path: PathBuf::from(&sync.mdb_path),
            songs_folder: folder,
            folder_hash: hash,
            read_only: runtime.read_only,
            server_url: runtime
                .config
                .server_library
                .as_ref()
                .map(|server| server.url.clone()),
        }))
    })
}

async fn run_passes(
    app: &AppHandle,
    state: &State<'_, AppState>,
    context: SyncContext,
) -> Result<VsbSyncReport, String> {
    if !context.mdb_path.is_file() {
        return Err(format!(
            "The VSB database is not available: {}",
            context.mdb_path.display()
        ));
    }

    // With a song server, changes end in downloading the library again, which
    // reopens it and would close the projection windows mid-service. Wait for
    // a quiet moment; the next minute's run tries again.
    let projecting = with_state(state, |runtime| Ok(runtime.projection_session_id.is_some()))?;
    if context.server_url.is_some() && projecting {
        *LAST_FINGERPRINT.lock() = None;
        return Ok(VsbSyncReport {
            blocked: vec!["Waiting until nothing is projected".into()],
            finished_at: chrono::Utc::now().to_rfc3339(),
            ..VsbSyncReport::default()
        });
    }

    let (mut report, ops) = run_blocking(app, context.clone()).await?;

    // Changes for the server go out with the desktop token; the library is
    // downloaded again and a second pass links what came back.
    if let (Some(url), false) = (&context.server_url, ops.is_empty()) {
        let token = crate::commands::server_library::read_token(app)?;
        let failures = send_server_ops(app, url, &token, ops).await;
        report.errors.extend(failures);
        crate::commands::server_library::synchronize(app, state, url, &token, false).await?;
        let refreshed = sync_context(state)?.ok_or("The library closed during sync")?;
        let (second, _) = run_blocking(app, refreshed).await?;
        report.linked = second.linked;
        report.files_written += second.files_written;
        report.rows_written += second.rows_written;
        report.rows_inserted += second.rows_inserted;
        report.rows_deleted += second.rows_deleted;
        report.errors.extend(second.errors);
        report.renumbered.extend(second.renumbered);
    }

    if report.changed_library() {
        reindex(state, &context.songs_folder)?;
        emit_library_changed(app);
    }
    let (mdb, folder) = (context.mdb_path.clone(), context.songs_folder.clone());
    let print = tauri::async_runtime::spawn_blocking(move || vsb_sync::fingerprint(&mdb, &folder))
        .await
        .map_err(|e| e.to_string())?;
    *LAST_FINGERPRINT.lock() = Some(print);
    Ok(report)
}

/// Send VSB changes to the song server. Imports go in one batch; each update
/// and delete names its base revision, so a newer server edit is a conflict
/// (reported) rather than overwritten. Returns one message per failure.
async fn send_server_ops(
    app: &AppHandle,
    url: &str,
    token: &str,
    ops: Vec<ServerOp>,
) -> Vec<String> {
    use crate::commands::server_library as server;
    let mut failures = Vec::new();
    let mut imports = Vec::new();
    for op in ops {
        let result = match op {
            ServerOp::Import { filename, chordpro } => {
                imports.push((filename, chordpro));
                continue;
            }
            ServerOp::Update {
                song_id,
                base_revision_id,
                title,
                chordpro,
            } => server::update_song(url, token, &song_id, &base_revision_id, &chordpro)
                .await
                .map(|_| ())
                .map_err(|error| format!("{title}: {error}")),
            ServerOp::Delete {
                song_id,
                base_revision_id,
                title,
            } => server::delete_song(url, token, &song_id, &base_revision_id)
                .await
                .map_err(|error| format!("{title}: {error}")),
        };
        if let Err(error) = result {
            failures.push(error);
        }
    }
    if !imports.is_empty() {
        if let Err(error) = server::import_chordpro(app, url, token, imports).await {
            failures.push(error);
        }
    }
    failures
}

/// One planning-and-apply pass on a blocking thread. Returns the report and
/// any changes that still need to reach the song server.
async fn run_blocking(
    app: &AppHandle,
    context: SyncContext,
) -> Result<(VsbSyncReport, Vec<ServerOp>), String> {
    let app = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let library_root = config::library_root(&app, &context.folder_hash)?;
        let backup_dir = config::vsb_backup_dir(&app)?;
        let mut sync_state = vsb_sync::load_state(&library_root, &context.mdb_path);
        let progress_app = app.clone();
        let progress = move |progress: VsbSyncProgress| {
            let _ = progress_app.emit("vsb-sync-progress", progress);
        };
        let manifest = match &context.server_url {
            Some(url) => crate::commands::server_library::read_manifest(&app, url),
            None => Default::default(),
        };
        let target = if context.server_url.is_some() {
            LibraryTarget::Server {
                manifest: &manifest,
            }
        } else {
            LibraryTarget::Local {
                app: &app,
                folder_hash: &context.folder_hash,
                read_only: context.read_only,
            }
        };
        let outcome = vsb_sync::run(
            SyncRun {
                mdb_path: &context.mdb_path,
                songs_folder: &context.songs_folder,
                target,
                backup_dir: &backup_dir,
                progress: &progress,
                open_writer: &vsb_sync::writer::open_writer,
            },
            &sync_state.links,
        )?;
        sync_state.links = outcome.links;
        vsb_sync::save_state(&library_root, &sync_state)?;
        Ok((outcome.report, outcome.server_ops))
    })
    .await
    .map_err(|e| e.to_string())?
}

fn reindex(state: &State<'_, AppState>, folder: &std::path::Path) -> Result<(), String> {
    let songs = crate::library::scan_songs_folder(folder)?;
    with_state(state, |runtime| {
        if runtime.songs_folder.as_deref() != Some(folder) {
            return Ok(());
        }
        if let Some(db) = runtime.db.as_ref() {
            db.rebuild_from_songs(&songs)?;
        }
        Ok(())
    })
}

/// Start-up and periodic trigger: a full run shortly after launch, then a
/// cheap fingerprint check every minute decides whether to compare again.
pub fn spawn_background_sync(app: &AppHandle) {
    let app = app.clone();
    std::thread::spawn(move || {
        let mut force = true;
        std::thread::sleep(std::time::Duration::from_secs(5));
        loop {
            let state = app.state::<AppState>();
            let _ = tauri::async_runtime::block_on(sync_vsb_database(app.clone(), state, force));
            force = false;
            std::thread::sleep(std::time::Duration::from_secs(60));
        }
    });
}
