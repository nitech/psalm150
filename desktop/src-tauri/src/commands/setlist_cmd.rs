use tauri::{AppHandle, State};

use crate::commands::server_sets;
use crate::setlist::{ServerSetState, Setlist, SetlistItem, SetlistItemType};
use crate::state::RuntimeState;
use crate::{with_state, AppState};

/// In a server library a change must reach the song server: mark it and
/// upload it in the background.
fn mark_for_upload(runtime: &RuntimeState, setlist: &mut Setlist) {
    if runtime.config.server_library.is_some() {
        let version = setlist.server.as_ref().and_then(|server| server.version);
        setlist.server = Some(ServerSetState {
            version,
            dirty: true,
        });
    }
}

fn is_server_library(state: &AppState) -> bool {
    with_state(state, |runtime| Ok(runtime.config.server_library.is_some())).unwrap_or(false)
}

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
    app: AppHandle,
    state: State<'_, AppState>,
    name: String,
    date: String,
) -> Result<Setlist, String> {
    let created = with_state(&state, |runtime| {
        let mut created = runtime
            .setlists
            .as_mut()
            .ok_or_else(|| "No library open".to_string())?
            .create(&name, &date)?;
        mark_for_upload(runtime, &mut created);
        if created.server.is_some() {
            let store = runtime.setlists.as_mut().ok_or("No library open")?;
            store.save(&created)?;
            store.load(&created.id)?;
        }
        Ok(created)
    })?;
    if is_server_library(&state) {
        server_sets::request_sync(&app);
    }
    Ok(created)
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
pub fn save_setlist(
    app: AppHandle,
    state: State<'_, AppState>,
    mut setlist: Setlist,
) -> Result<(), String> {
    with_state(&state, |runtime| {
        mark_for_upload(runtime, &mut setlist);
        let store = runtime
            .setlists
            .as_ref()
            .ok_or_else(|| "No library open".to_string())?;
        store.save(&setlist)
    })?;
    if is_server_library(&state) {
        server_sets::request_sync(&app);
    }
    Ok(())
}

/// The setlist the console works from (remembered per PC by the console).
/// The song server's remote control reports it, with the item on screen.
#[tauri::command]
pub fn set_active_setlist(state: State<'_, AppState>, id: Option<String>) -> Result<(), String> {
    with_state(&state, |runtime| {
        runtime.current_setlist_id = id;
        Ok(())
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

/// Append a song to a setlist unless it is already there.
#[tauri::command]
pub fn add_to_setlist(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
    filename: String,
) -> Result<Setlist, String> {
    crate::library::files::validate_song_filename(&filename)?;
    let updated = with_state(&state, |runtime| {
        let server = runtime.config.server_library.is_some();
        let store = runtime
            .setlists
            .as_mut()
            .ok_or_else(|| "No library open".to_string())?;
        store.update(&id, |setlist| {
            if server {
                let version = setlist.server.as_ref().and_then(|server| server.version);
                setlist.server = Some(ServerSetState {
                    version,
                    dirty: true,
                });
            }
            if !setlist
                .items
                .iter()
                .any(|item| item.file.as_deref() == Some(filename.as_str()))
            {
                setlist.items.push(SetlistItem {
                    item_type: SetlistItemType::Song,
                    file: Some(filename.clone()),
                    transpose: None,
                    arrangement: None,
                    id: Some(uuid::Uuid::new_v4().to_string()),
                    note: None,
                });
            }
        })
    })?;
    if is_server_library(&state) {
        server_sets::request_sync(&app);
    }
    Ok(updated)
}

#[tauri::command]
pub fn remove_from_setlist(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
    filename: String,
) -> Result<Setlist, String> {
    let updated = with_state(&state, |runtime| {
        let server = runtime.config.server_library.is_some();
        let store = runtime
            .setlists
            .as_mut()
            .ok_or_else(|| "No library open".to_string())?;
        store.update(&id, |setlist| {
            setlist
                .items
                .retain(|item| item.file.as_deref() != Some(filename.as_str()));
            if server {
                let version = setlist.server.as_ref().and_then(|server| server.version);
                setlist.server = Some(ServerSetState {
                    version,
                    dirty: true,
                });
            }
        })
    })?;
    if is_server_library(&state) {
        server_sets::request_sync(&app);
    }
    Ok(updated)
}

/// Today's date in the operator's regional short date format (Windows
/// "Short date", such as 23.09.26 with Norwegian settings). `None` lets the
/// console fall back to the browser locale.
#[tauri::command]
pub fn format_short_date() -> Option<String> {
    #[cfg(windows)]
    {
        use windows_sys::Win32::Globalization::{GetDateFormatEx, DATE_SHORTDATE};
        let mut buffer = [0u16; 128];
        // A null locale name and date mean the user's locale and today.
        let written = unsafe {
            GetDateFormatEx(
                std::ptr::null(),
                DATE_SHORTDATE,
                std::ptr::null(),
                std::ptr::null(),
                buffer.as_mut_ptr(),
                buffer.len() as i32,
                std::ptr::null(),
            )
        };
        if written > 1 {
            return Some(String::from_utf16_lossy(&buffer[..written as usize - 1]));
        }
        None
    }
    #[cfg(not(windows))]
    {
        None
    }
}
