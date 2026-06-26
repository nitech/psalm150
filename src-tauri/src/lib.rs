pub mod ccli;
pub mod commands;
pub mod config;
pub mod display;
pub mod db;
pub mod duplicates;
pub mod import;
pub mod library;
pub mod print;
pub mod projection;
pub mod remote;
pub mod setlist;
pub mod stage;

use std::path::PathBuf;
use std::sync::mpsc::Receiver;
use std::time::Duration;

use parking_lot::Mutex;
use std::sync::atomic::AtomicBool;
use tauri::{Emitter, Manager};

pub struct AppState {
    pub inner: Mutex<state::RuntimeState>,
    pub remote_actions: Mutex<Option<Receiver<remote::RemoteAction>>>,
    pub import_cancel: AtomicBool,
}

pub mod state {
    use super::config::AppConfig;
    use super::db::Database;
    use super::library::LibraryWatcher;
    use super::remote::RemoteServer;
    use super::setlist::SetlistStore;
    use std::path::PathBuf;

    pub struct RuntimeState {
        pub config: AppConfig,
        pub songs_folder: Option<PathBuf>,
        pub folder_hash: Option<String>,
        pub db: Option<Database>,
        pub setlists: Option<SetlistStore>,
        pub watcher: Option<LibraryWatcher>,
        pub library_dirty: bool,
        pub read_only: bool,
        pub remote: Option<RemoteServer>,
        pub current_setlist_id: Option<String>,
        pub projection: super::projection::ProjectionState,
    }

    impl RuntimeState {
        pub fn new(config: AppConfig) -> Self {
            Self {
                read_only: config.read_only,
                config,
                songs_folder: None,
                folder_hash: None,
                db: None,
                setlists: None,
                watcher: None,
                library_dirty: false,
                remote: None,
                current_setlist_id: None,
                projection: super::projection::ProjectionState::default(),
            }
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .setup(|app| {
            use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

            app.handle()
                .global_shortcut()
                .on_shortcut("Escape", |app, _shortcut, event| {
                    if event.state == ShortcutState::Pressed {
                        let projecting = app.get_webview_window("audience").is_some()
                            || app.get_webview_window("stage").is_some();
                        if projecting {
                            let _ = commands::projection_cmd::close_projection_windows(app.clone());
                        }
                    }
                })
                .expect("failed to register Escape projection shortcut");

            let config = config::AppConfig::load(app.handle())?;
            let runtime = state::RuntimeState::new(config.clone());
            app.manage(AppState {
                inner: Mutex::new(runtime),
                remote_actions: Mutex::new(None),
                import_cancel: AtomicBool::new(false),
            });

            commands::projection_cmd::create_projection_windows(app.handle());

            if let Some(main) = app.get_webview_window("main") {
                let _ = main.set_focus();
            }

            let poll_handle = app.handle().clone();
            std::thread::spawn(move || loop {
                std::thread::sleep(Duration::from_secs(1));
                let app_state = poll_handle.state::<AppState>();
                let mut dirty = false;
                {
                    let mut guard = app_state.inner.lock();
                    let changed = guard
                        .watcher
                        .as_ref()
                        .map(|watcher| {
                            let mut changed = false;
                            while watcher.receiver.try_recv().is_ok() {
                                changed = true;
                            }
                            changed
                        })
                        .unwrap_or(false);
                    if changed {
                        guard.library_dirty = true;
                        dirty = true;
                    }
                }
                if dirty {
                    emit_library_changed(&poll_handle);
                }
                let remote_actions: Vec<remote::RemoteAction> = {
                    let guard = app_state.remote_actions.lock();
                    if let Some(rx) = guard.as_ref() {
                        let mut actions = Vec::new();
                        while let Ok(action) = rx.try_recv() {
                            actions.push(action);
                        }
                        actions
                    } else {
                        Vec::new()
                    }
                };
                for action in remote_actions {
                    let _ = handle_remote_action(&poll_handle, &app_state, action);
                }
            });

            if let Some(ref folder) = config.last_songs_folder {
                let path = PathBuf::from(folder);
                if path.is_dir() {
                    let handle = app.handle().clone();
                    let state = app.state::<AppState>();
                    if let Err(err) =
                        commands::library::stage_songs_folder(&handle, &state, path.clone())
                    {
                        eprintln!("Failed to stage songs folder: {err}");
                    } else {
                        emit_library_changed(&handle);
                    }
                    std::thread::spawn(move || {
                        let state = handle.state::<AppState>();
                        if let Err(err) = commands::library::activate_songs_folder(
                            &handle,
                            &state,
                            path,
                            false,
                        ) {
                            eprintln!("Failed to restore songs folder: {err}");
                        }
                    });
                } else {
                    eprintln!(
                        "Configured songs folder is unavailable: {}",
                        path.display()
                    );
                }
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::library::get_songs_folder,
            commands::library::pick_songs_folder,
            commands::library::set_songs_folder,
            commands::library::rescan_songs,
            commands::library::get_library_status,
            commands::library::list_foreign_files,
            commands::library::list_conflicts,
            commands::library::search_songs,
            commands::library::list_by_key,
            commands::library::list_keys,
            commands::library::list_categories,
            commands::library::get_history,
            commands::library::toggle_favorite,
            commands::library::list_favorites,
            commands::import_cmd::import_mdb_path,
            commands::import_cmd::cancel_import,
            commands::import_cmd::check_duplicates,
            commands::song::load_song,
            commands::song::save_song,
            commands::song::delete_song,
            commands::song::renumber_songs,
            commands::song::compact_library,
            commands::song::quick_project,
            commands::projection_cmd::open_audience_window,
            commands::projection_cmd::close_audience_window,
            commands::projection_cmd::open_stage_window,
            commands::projection_cmd::close_stage_window,
            commands::projection_cmd::close_projection_windows,
            commands::projection_cmd::show_slide,
            commands::projection_cmd::next_slide,
            commands::projection_cmd::previous_slide,
            commands::projection_cmd::blank_screen,
            commands::projection_cmd::get_projection_state,
            commands::projection_cmd::get_next_slide_preview,
            commands::projection_cmd::set_transpose,
            commands::projection_cmd::set_nashville,
            commands::projection_cmd::log_projection,
            commands::setlist_cmd::list_setlists,
            commands::setlist_cmd::create_setlist,
            commands::setlist_cmd::load_setlist,
            commands::setlist_cmd::save_setlist,
            commands::setlist_cmd::setlist_advance,
            commands::setlist_cmd::setlist_previous,
            commands::setlist_cmd::list_hold_slides,
            commands::config_cmd::get_config,
            commands::config_cmd::set_read_only,
            commands::config_cmd::set_project_to_stage,
            commands::config_cmd::save_theme,
            commands::config_cmd::get_theme,
            commands::config_cmd::save_shortcuts,
            commands::config_cmd::get_shortcuts,
            commands::config_cmd::list_displays,
            commands::config_cmd::set_audience_monitor,
            commands::config_cmd::set_stage_monitor,
            commands::ccli_cmd::export_ccli_report,
            commands::print_cmd::print_songbook_html,
            commands::remote_cmd::start_remote,
            commands::remote_cmd::stop_remote,
            commands::remote_cmd::get_remote_status,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

pub fn emit_library_changed(app: &tauri::AppHandle) {
    let _ = app.emit("library-changed", ());
}

fn handle_remote_action(
    app: &tauri::AppHandle,
    state: &AppState,
    action: remote::RemoteAction,
) -> Result<(), String> {
    match action {
        remote::RemoteAction::Next => {
            commands::projection_cmd::next_slide_inner(app, state)?;
        }
        remote::RemoteAction::Prev => {
            commands::projection_cmd::previous_slide_inner(app, state)?;
        }
        remote::RemoteAction::Blank => {
            commands::projection_cmd::blank_screen_inner(app, state)?;
        }
    }
    Ok(())
}

pub fn with_state<F, T>(state: &AppState, f: F) -> Result<T, String>
where
    F: FnOnce(&mut state::RuntimeState) -> Result<T, String>,
{
    let mut guard = state.inner.lock();
    f(&mut guard)
}
