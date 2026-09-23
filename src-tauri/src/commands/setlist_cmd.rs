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

/// Append a song to a setlist unless it is already there.
#[tauri::command]
pub fn add_to_setlist(
    state: State<'_, AppState>,
    id: String,
    filename: String,
) -> Result<Setlist, String> {
    crate::library::files::validate_song_filename(&filename)?;
    with_state(&state, |runtime| {
        let store = runtime
            .setlists
            .as_mut()
            .ok_or_else(|| "No library open".to_string())?;
        store.update(&id, |setlist| {
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
                });
            }
        })
    })
}

#[tauri::command]
pub fn remove_from_setlist(
    state: State<'_, AppState>,
    id: String,
    filename: String,
) -> Result<Setlist, String> {
    with_state(&state, |runtime| {
        let store = runtime
            .setlists
            .as_mut()
            .ok_or_else(|| "No library open".to_string())?;
        store.update(&id, |setlist| {
            setlist
                .items
                .retain(|item| item.file.as_deref() != Some(filename.as_str()));
        })
    })
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
