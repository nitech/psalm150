pub mod ccli;
pub mod commands;
pub mod config;
pub mod db;
pub mod display;
pub mod duplicates;
pub mod import;
pub mod library;
pub mod print;
pub mod projection;
pub mod remote;
pub mod search;
pub mod setlist;
pub mod stage;
pub mod updater;
pub mod vsb_sync;

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
    pub import_running: AtomicBool,
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
        pub active_song: Option<super::library::chordpro::ParsedSong>,
        pub projection_revision: u64,
        pub projection_session_id: Option<String>,
        pub active_theme: super::projection::SlideTheme,
    }

    impl RuntimeState {
        pub fn new(config: AppConfig) -> Self {
            let read_only = config.read_only || config.server_library.is_some();
            Self {
                read_only,
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
                active_song: None,
                projection_revision: 0,
                projection_session_id: None,
                active_theme: super::projection::SlideTheme::default(),
            }
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .manage(updater::UpdateState::default())
        .on_window_event(|window, event| {
            // The hidden projection windows would otherwise keep the app alive.
            if window.label() == "main" && matches!(event, tauri::WindowEvent::Destroyed) {
                let app = window.app_handle();
                updater::install_on_quit(app);
                app.exit(0);
            }
        })
        .setup(|app| {
            use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

            app.handle()
                .global_shortcut()
                .on_shortcut("Escape", |app, _shortcut, event| {
                    if event.state == ShortcutState::Pressed {
                        let projecting = ["audience", "stage"].iter().any(|label| {
                            app.get_webview_window(label)
                                .and_then(|window| window.is_visible().ok())
                                .unwrap_or(false)
                        });
                        if projecting {
                            let _ = commands::projection_cmd::close_projection_windows(app.clone());
                            // The console clears and focuses its search field.
                            let _ = app.emit("projection-escaped", ());
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
                import_running: AtomicBool::new(false),
            });

            commands::projection_cmd::create_projection_windows(app.handle());

            if config.remote_enabled {
                let state = app.state::<AppState>();
                match commands::remote_cmd::start_remote_inner(app.handle(), &state, None) {
                    Ok(status) => eprintln!("[remote] listening on port {}", status.port),
                    Err(err) => eprintln!("[remote] not started: {err}"),
                }
            }

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
                    let _ = poll_handle.emit("library-external-changed", ());
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

            commands::vsb_sync_cmd::spawn_background_sync(app.handle());
            commands::server_sets::spawn_background(app.handle());
            commands::server_remote::spawn_background(app.handle());
            updater::spawn_background(app.handle());

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
                        if let Err(err) =
                            commands::library::activate_songs_folder(&handle, &state, path, false)
                        {
                            eprintln!("Failed to restore songs folder: {err}");
                        }
                    });
                } else {
                    eprintln!("Configured songs folder is unavailable: {}", path.display());
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
            commands::duplicates_cmd::list_duplicate_groups,
            commands::duplicates_cmd::mark_duplicate_keep_both,
            commands::duplicates_cmd::list_recovery_items,
            commands::duplicates_cmd::restore_recovery_item,
            commands::song_v2::load_song,
            commands::song_v2::preview_web_song,
            commands::song_v2::project_song,
            commands::song_v2::save_song,
            commands::song_v2::save_song_lines,
            commands::song_v2::save_web_song,
            commands::song_v2::delete_song,
            commands::song::renumber_songs,
            commands::song::compact_library,
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
            commands::projection_cmd::get_projection_snapshot,
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
            commands::config_cmd::set_web_search_enabled,
            commands::config_cmd::set_show_song_numbers,
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
            commands::server_library::connect_server_library,
            commands::server_sign_in::probe_song_server,
            commands::server_sign_in::sign_in_server_library,
            commands::server_sign_in::cancel_server_sign_in,
            commands::server_library::sync_server_library,
            commands::server_library::disconnect_server_library,
            commands::web_search_cmd::search_web_songs,
            commands::vsb_sync_cmd::set_vsb_database,
            commands::vsb_sync_cmd::sync_vsb_database,
            commands::setlist_cmd::add_to_setlist,
            commands::setlist_cmd::remove_from_setlist,
            commands::setlist_cmd::format_short_date,
            commands::setlist_cmd::set_active_setlist,
            commands::server_sets::sync_server_sets,
            commands::server_remote::set_server_remote_enabled,
            commands::server_remote::set_server_room_sharing,
            commands::server_remote::get_server_room,
            commands::server_remote::rename_server_room,
            updater::get_ready_update,
            updater::restart_to_update,
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
