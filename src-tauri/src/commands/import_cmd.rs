use std::path::PathBuf;
use std::sync::atomic::Ordering;

use tauri::{AppHandle, Emitter, State};

use crate::config::save_theme;
use crate::duplicates::find_duplicates;
use crate::import::mdb::{read_page_setup, read_vsb_categories};
use crate::import::{
    import_mdb_to_folder_with_callbacks, ImportCallbacks, ImportProgress, ImportReport,
};
use crate::library::scan_songs_folder;
use crate::{with_state, AppState};

#[tauri::command]
pub fn cancel_import(state: State<'_, AppState>) {
    state.import_cancel.store(true, Ordering::SeqCst);
}

#[tauri::command]
pub fn import_mdb_path(
    app: AppHandle,
    state: State<'_, AppState>,
    mdb_path: String,
) -> Result<ImportReport, String> {
    let mdb_path = PathBuf::from(mdb_path);
    if !mdb_path.is_file() {
        return Err(format!("MDB file not found: {}", mdb_path.display()));
    }

    let songs_folder = with_state(&state, |runtime| {
        runtime
            .songs_folder
            .clone()
            .ok_or_else(|| "Select a songs folder before importing".to_string())
    })?;

    state.import_cancel.store(false, Ordering::SeqCst);

    let categories = read_vsb_categories(&mdb_path)?;
    let cancel_flag = &state.import_cancel;
    let app_handle = app.clone();
    let report = import_mdb_to_folder_with_callbacks(
        &mdb_path,
        &songs_folder,
        &categories,
        ImportCallbacks {
            on_progress: Some(&|progress: ImportProgress| {
                let _ = app_handle.emit("import-progress", &progress);
            }),
            should_cancel: Some(&|| cancel_flag.load(Ordering::SeqCst)),
        },
    )?;

    if let Ok(theme) = read_page_setup(&mdb_path) {
        let hash = with_state(&state, |runtime| {
            runtime
                .folder_hash
                .clone()
                .ok_or_else(|| "Missing folder hash".to_string())
        })?;
        let _ = save_theme(&app, &hash, &theme);
    }

    let songs = scan_songs_folder(&songs_folder)?;
    with_state(&state, |runtime| {
        runtime.library_dirty = false;
        if let Some(db) = runtime.db.as_ref() {
            db.rebuild_from_songs(&songs)?;
        }
        Ok(())
    })?;

    let _ = app.emit("import-complete", &report);
    Ok(report)
}

#[tauri::command]
pub fn check_duplicates(
    state: State<'_, AppState>,
) -> Result<Vec<crate::duplicates::DuplicateWarning>, String> {
    with_state(&state, |runtime| {
        let folder = runtime
            .songs_folder
            .as_ref()
            .ok_or_else(|| "No songs folder selected".to_string())?;
        let songs = scan_songs_folder(folder)?;
        Ok(find_duplicates(&songs))
    })
}
