use tauri::State;

use crate::web_search;
use crate::{with_state, AppState};

#[tauri::command]
pub fn search_web_songs(
    state: State<'_, AppState>,
    query: String,
) -> Result<Vec<web_search::WebSearchCandidate>, String> {
    with_state(&state, |runtime| {
        if !runtime.config.web_search_enabled {
            return Ok(vec![]);
        }
        web_search::search_songs(&query)
    })
}
