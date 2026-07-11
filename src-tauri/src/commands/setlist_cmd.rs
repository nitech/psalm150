use tauri::State;

use crate::setlist::{Setlist, SetlistItem, SetlistItemType};
use crate::{with_state, AppState};

#[tauri::command]
pub fn list_setlists(state: State<'_, AppState>) -> Result<Vec<Setlist>, String> {
    with_state(&state, |runtime| {
        runtime
            .setlists
            .as_ref()
            .ok_or_else(|| "No library open".to_string())?
            .list()
    })
}

#[tauri::command]
pub fn create_setlist(
    state: State<'_, AppState>,
    name: String,
    date: String,
) -> Result<Setlist, String> {
    with_state(&state, |runtime| {
        runtime
            .setlists
            .as_mut()
            .ok_or_else(|| "No library open".to_string())?
            .create(&name, &date)
    })
}

#[tauri::command]
pub fn load_setlist(state: State<'_, AppState>, id: String) -> Result<Setlist, String> {
    with_state(&state, |runtime| {
        runtime
            .setlists
            .as_mut()
            .ok_or_else(|| "No library open".to_string())?
            .load(&id)
    })
}

#[tauri::command]
pub fn save_setlist(state: State<'_, AppState>, setlist: Setlist) -> Result<(), String> {
    with_state(&state, |runtime| {
        let store = runtime
            .setlists
            .as_ref()
            .ok_or_else(|| "No library open".to_string())?;
        store.save(&setlist)
    })
}

#[tauri::command]
pub fn setlist_advance(state: State<'_, AppState>) -> Result<Option<SetlistItem>, String> {
    with_state(&state, |runtime| {
        let store = runtime
            .setlists
            .as_mut()
            .ok_or_else(|| "No library open".to_string())?;
        if store.advance_item() {
            Ok(store
                .active()
                .and_then(|s| s.items.get(store.item_index()))
                .cloned())
        } else {
            Ok(None)
        }
    })
}

#[tauri::command]
pub fn setlist_previous(state: State<'_, AppState>) -> Result<Option<SetlistItem>, String> {
    with_state(&state, |runtime| {
        let store = runtime
            .setlists
            .as_mut()
            .ok_or_else(|| "No library open".to_string())?;
        if store.previous_item() {
            Ok(store
                .active()
                .and_then(|s| s.items.get(store.item_index()))
                .cloned())
        } else {
            Ok(None)
        }
    })
}

#[tauri::command]
pub fn list_hold_slides(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<Vec<String>, String> {
    with_state(&state, |runtime| {
        let hash = runtime
            .folder_hash
            .as_ref()
            .ok_or_else(|| "No library open".to_string())?;
        let root = crate::config::library_root(&app, hash)?;
        crate::setlist::list_hold_slides(&root)
    })
}
