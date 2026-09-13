use std::fs;

use tauri::{AppHandle, Emitter, State};

use crate::duplicates::{
    find_duplicate_groups, load_reviews, mark_reviewed, review_pair_id, DuplicateGroup,
};
use crate::library::chordpro::parse_chordpro;
use crate::library::files::{list_recovery, restore_recovery, song_path, RecoveryItem};
use crate::library::scan_songs_folder;
use crate::{with_state, AppState};

fn library_location(state: &AppState) -> Result<(std::path::PathBuf, String), String> {
    with_state(state, |runtime| {
        Ok((
            runtime
                .songs_folder
                .clone()
                .ok_or_else(|| "No songs folder selected".to_string())?,
            runtime
                .folder_hash
                .clone()
                .ok_or_else(|| "No library open".to_string())?,
        ))
    })
}

#[tauri::command]
pub fn list_duplicate_groups(
    app: AppHandle,
    state: State<'_, AppState>,
    include_reviewed: bool,
) -> Result<Vec<DuplicateGroup>, String> {
    let (folder, folder_hash) = library_location(&state)?;
    let reviewed = load_reviews(&app, &folder_hash)?;
    let mut groups = find_duplicate_groups(&scan_songs_folder(&folder)?, &reviewed);
    if !include_reviewed {
        groups.retain(|group| !group.reviewed);
    }
    Ok(groups)
}

#[tauri::command]
pub fn mark_duplicate_keep_both(
    app: AppHandle,
    state: State<'_, AppState>,
    left_hash: String,
    right_hash: String,
) -> Result<(), String> {
    let valid_hash =
        |value: &str| value.len() == 64 && value.bytes().all(|byte| byte.is_ascii_hexdigit());
    if !valid_hash(&left_hash) || !valid_hash(&right_hash) || left_hash == right_hash {
        return Err("Invalid duplicate file pair".into());
    }
    let (_, folder_hash) = library_location(&state)?;
    mark_reviewed(&app, &folder_hash, &review_pair_id(&left_hash, &right_hash))
}

#[tauri::command]
pub fn list_recovery_items(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<Vec<RecoveryItem>, String> {
    let (_, folder_hash) = library_location(&state)?;
    list_recovery(&app, &folder_hash)
}

#[tauri::command]
pub fn restore_recovery_item(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
) -> Result<String, String> {
    let (folder, folder_hash) = with_state(&state, |runtime| {
        if runtime.read_only {
            return Err("Library is in read-only mode".into());
        }
        Ok((
            runtime
                .songs_folder
                .clone()
                .ok_or_else(|| "No songs folder selected".to_string())?,
            runtime
                .folder_hash
                .clone()
                .ok_or_else(|| "No library open".to_string())?,
        ))
    })?;
    let filename = restore_recovery(&app, &folder_hash, &folder, &id)?;
    let content = fs::read_to_string(song_path(&folder, &filename)?).map_err(|e| e.to_string())?;
    let parsed = parse_chordpro(&content, &filename);
    with_state(&state, |runtime| {
        if let Some(db) = runtime.db.as_ref() {
            db.upsert_song(&parsed)?;
        }
        Ok(())
    })?;
    let _ = app.emit("library-changed", ());
    Ok(filename)
}
