use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, State};
use tauri_plugin_dialog::DialogExt;

use crate::config::{self, ensure_library_layout, hash_folder};
use crate::db::{Database, SongRow};
use crate::library::{
    list_conflicts as scan_conflicts, list_foreign_files as scan_foreign_files, scan_songs_folder,
    LibraryWatcher,
};
use crate::setlist::SetlistStore;
use crate::{emit_library_changed, with_state, AppState};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LibraryStatus {
    pub songs_folder: Option<String>,
    pub song_count: usize,
    pub library_dirty: bool,
    pub foreign_files: Vec<String>,
    pub conflicts: Vec<String>,
}

pub fn activate_songs_folder(
    app: &AppHandle,
    state: &State<'_, AppState>,
    path: PathBuf,
    persist: bool,
) -> Result<LibraryStatus, String> {
    crate::library::chordpro::validate_songs_folder(&path)?;
    let folder_hash = hash_folder(&path);
    ensure_library_layout(app, &folder_hash)?;

    let index_path = config::library_root(app, &folder_hash)?.join("index.sqlite");
    let db = Database::open(index_path)?;
    let songs = scan_songs_folder(&path)?;
    let count = songs.len();
    db.rebuild_from_songs(&songs)?;

    let setlist_root = config::library_root(app, &folder_hash)?.join("setlists");
    let watcher = LibraryWatcher::new(&path).ok();

    with_state(state, |runtime| {
        runtime.songs_folder = Some(path.clone());
        runtime.folder_hash = Some(folder_hash);
        runtime.db = Some(db);
        runtime.setlists = Some(SetlistStore::new(setlist_root));
        runtime.watcher = watcher;
        runtime.library_dirty = false;
        if persist {
            runtime.config.last_songs_folder = Some(path.to_string_lossy().into());
            runtime.config.first_run_complete = true;
            runtime.config.save(app)?;
        }
        Ok(())
    })?;

    emit_library_changed(app);
    build_status(&path, false, count)
}

fn build_status(path: &PathBuf, dirty: bool, count: usize) -> Result<LibraryStatus, String> {
    Ok(LibraryStatus {
        songs_folder: Some(path.to_string_lossy().into()),
        song_count: count,
        library_dirty: dirty,
        foreign_files: scan_foreign_files(path)?,
        conflicts: scan_conflicts(path)?,
    })
}

fn require_db(state: &State<'_, AppState>) -> Result<(), String> {
    with_state(state, |runtime| {
        if runtime.db.is_none() {
            Err("Open a songs folder first".into())
        } else {
            Ok(())
        }
    })
}

#[tauri::command]
pub fn get_songs_folder(state: State<'_, AppState>) -> Result<Option<String>, String> {
    with_state(&state, |runtime| {
        Ok(runtime
            .songs_folder
            .as_ref()
            .map(|p| p.to_string_lossy().into()))
    })
}

#[tauri::command]
pub async fn pick_songs_folder(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<LibraryStatus, String> {
    let folder = app
        .dialog()
        .file()
        .set_title("Select Songs Folder")
        .blocking_pick_folder();
    let Some(folder) = folder else {
        return get_library_status(state);
    };
    let path = folder.into_path().map_err(|e| e.to_string())?;
    activate_songs_folder(&app, &state, path, true)
}

#[tauri::command]
pub fn rescan_songs(state: State<'_, AppState>) -> Result<LibraryStatus, String> {
    with_state(&state, |runtime| {
        let folder = runtime
            .songs_folder
            .clone()
            .ok_or_else(|| "No songs folder selected".to_string())?;
        let db = runtime
            .db
            .as_ref()
            .ok_or_else(|| "Database not open".to_string())?;
        let songs = scan_songs_folder(&folder)?;
        let count = songs.len();
        db.rebuild_from_songs(&songs)?;
        runtime.library_dirty = false;
        build_status(&folder, false, count)
    })
}

#[tauri::command]
pub fn get_library_status(state: State<'_, AppState>) -> Result<LibraryStatus, String> {
    with_state(&state, |runtime| {
        let Some(folder) = runtime.songs_folder.clone() else {
            return Ok(LibraryStatus {
                songs_folder: None,
                song_count: 0,
                library_dirty: runtime.library_dirty,
                foreign_files: vec![],
                conflicts: vec![],
            });
        };
        let count = runtime
            .db
            .as_ref()
            .map(|db| db.list_all(false).map(|s| s.len()).unwrap_or(0))
            .unwrap_or(0);
        build_status(&folder, runtime.library_dirty, count)
    })
}

#[tauri::command]
pub fn list_foreign_files(state: State<'_, AppState>) -> Result<Vec<String>, String> {
    with_state(&state, |runtime| {
        let folder = runtime
            .songs_folder
            .as_ref()
            .ok_or_else(|| "No songs folder selected".to_string())?;
        scan_foreign_files(folder)
    })
}

#[tauri::command]
pub fn list_conflicts(state: State<'_, AppState>) -> Result<Vec<String>, String> {
    with_state(&state, |runtime| {
        let folder = runtime
            .songs_folder
            .as_ref()
            .ok_or_else(|| "No songs folder selected".to_string())?;
        scan_conflicts(folder)
    })
}

#[tauri::command]
pub fn search_songs(
    state: State<'_, AppState>,
    query: String,
    favorites_only: bool,
) -> Result<Vec<SongRow>, String> {
    require_db(&state)?;
    with_state(&state, |runtime| {
        runtime
            .db
            .as_ref()
            .unwrap()
            .search(&query, favorites_only)
    })
}

#[tauri::command]
pub fn list_by_key(state: State<'_, AppState>, key: String) -> Result<Vec<SongRow>, String> {
    require_db(&state)?;
    with_state(&state, |runtime| runtime.db.as_ref().unwrap().list_by_key(&key))
}

#[tauri::command]
pub fn list_categories(state: State<'_, AppState>) -> Result<Vec<String>, String> {
    require_db(&state)?;
    with_state(&state, |runtime| runtime.db.as_ref().unwrap().list_categories())
}

#[tauri::command]
pub fn get_history(state: State<'_, AppState>, limit: i64) -> Result<Vec<(String, String, String)>, String> {
    require_db(&state)?;
    with_state(&state, |runtime| runtime.db.as_ref().unwrap().get_history(limit))
}

#[tauri::command]
pub fn toggle_favorite(state: State<'_, AppState>, filename: String) -> Result<bool, String> {
    require_db(&state)?;
    with_state(&state, |runtime| runtime.db.as_ref().unwrap().toggle_favorite(&filename))
}

#[tauri::command]
pub fn list_favorites(state: State<'_, AppState>) -> Result<Vec<String>, String> {
    require_db(&state)?;
    with_state(&state, |runtime| runtime.db.as_ref().unwrap().list_favorites())
}
