use tauri::State;

use crate::web_search;
use crate::{with_state, AppState};

#[tauri::command]
pub fn search_web_songs(
    state: State<'_, AppState>,
    query: String,
) -> Result<Vec<web_search::WebSearchCandidate>, String> {
    // Search without the state lock: it can take many seconds and would
    // stall projection meanwhile.
    let enabled = with_state(&state, |runtime| Ok(runtime.config.web_search_enabled))?;
    if !enabled {
        return Ok(vec![]);
    }
    web_search::search_songs(&query)
}
