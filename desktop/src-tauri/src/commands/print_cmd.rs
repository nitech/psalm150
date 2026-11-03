use tauri::State;

use crate::print::{render_indexes_html, render_songbook_html};
use crate::{with_state, AppState};

#[tauri::command]
pub fn print_songbook_html(
    state: State<'_, AppState>,
    title: String,
    include_indexes: bool,
) -> Result<String, String> {
    with_state(&state, |runtime| {
        let db = runtime
            .db
            .as_ref()
            .ok_or_else(|| "No library open".to_string())?;
        let songs = db.list_all(false)?;
        let mut html = render_songbook_html(&songs, &title);
        if include_indexes {
            html.push_str(&render_indexes_html(&songs));
        }
        Ok(html)
    })
}
