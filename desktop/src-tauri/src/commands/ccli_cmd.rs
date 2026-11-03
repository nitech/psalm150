use tauri::{AppHandle, State};

use crate::{with_state, AppState};

#[tauri::command]
pub fn export_ccli_report(
    app: AppHandle,
    state: State<'_, AppState>,
    from: String,
    to: String,
) -> Result<String, String> {
    with_state(&state, |runtime| {
        let hash = runtime
            .folder_hash
            .as_ref()
            .ok_or_else(|| "No library open".to_string())?;
        let path = crate::config::library_root(&app, hash)?.join("ccli_log.sqlite");
        let log = crate::ccli::CcliLog::open(path)?;
        log.export_csv(&from, &to)
    })
}
