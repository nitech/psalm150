//! Remote control and rooms through the song server.
//!
//! With a server library connected, this PC tells the server what it
//! projects (song, slides and their words, blank, active set) while remote
//! control or room sharing is on; both are on unless the operator turns
//! them off.
//!
//! - Remote control: it waits for commands from leaders' phones with a long
//!   poll. Next, previous, blank and show-slide run here; "project a song"
//!   and "project a set item" go to the console (`remote-project`), which
//!   projects through its normal path so the windows open safely and the
//!   console shows what is on screen.
//! - Rooms: the server gives this PC a room name (a flower) that leaders pick
//!   it by and that anyone may type at `<server>/join` to follow the words on
//!   their phone. The words (no chords) are only shown to them while sharing
//!   is on. The console shows the name (`server-room` event) and may rename it.
//!
//! Everything keeps working without the server: this is only another way to
//! press the same buttons.

use std::sync::Mutex;
use std::time::{Duration, Instant};

use reqwest::header::{AUTHORIZATION, CONTENT_TYPE};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};

use crate::commands::projection_cmd::{
    blank_screen_inner, next_slide_inner, previous_slide_inner, show_slide_inner,
};
use crate::commands::server_library::{read_manifest, read_token};
use crate::commands::server_sets;
use crate::setlist::SetlistItemType;
use crate::{with_state, AppState};

/// Resend the state at least this often so the server keeps us online.
const HEARTBEAT: Duration = Duration::from_secs(15);
/// Look up the room name this often, in case a leader renamed it.
const ROOM_REFRESH: Duration = Duration::from_secs(60);
/// Seconds the server may hold a command poll open.
const LONG_POLL_SECONDS: u64 = 25;
const RETRY: Duration = Duration::from_secs(5);

#[tauri::command]
pub fn set_server_remote_enabled(
    app: AppHandle,
    state: State<'_, AppState>,
    enabled: bool,
) -> Result<(), String> {
    with_state(&state, |runtime| {
        runtime.config.server_remote_enabled = enabled;
        runtime.config.save(&app)
    })
}

#[tauri::command]
pub fn set_server_room_sharing(
    app: AppHandle,
    state: State<'_, AppState>,
    enabled: bool,
) -> Result<(), String> {
    with_state(&state, |runtime| {
        runtime.config.server_room_sharing = enabled;
        runtime.config.save(&app)
    })
}

/// This PC's room, as the server last told it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct DesktopRoom {
    pub room_name: String,
    /// The church shares its projections in rooms (an owner's setting).
    pub public_rooms: bool,
    /// Where people follow it: `<server>/join/<room>`.
    #[serde(default)]
    pub join_url: String,
}

static ROOM: Mutex<Option<DesktopRoom>> = Mutex::new(None);

fn remember_room(app: &AppHandle, url: &str, mut room: DesktopRoom) -> DesktopRoom {
    room.join_url = join_url(url, &room.room_name);
    let mut current = ROOM.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    if current.as_ref() != Some(&room) {
        *current = Some(room.clone());
        let _ = app.emit("server-room", Some(room.clone()));
    }
    room
}

fn forget_room(app: &AppHandle) {
    let mut current = ROOM.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    if current.take().is_some() {
        let _ = app.emit("server-room", None::<DesktopRoom>);
    }
}

fn join_url(server_url: &str, room_name: &str) -> String {
    let mut url = match url::Url::parse(server_url) {
        Ok(url) => url,
        Err(_) => return String::new(),
    };
    match url.path_segments_mut() {
        Ok(mut segments) => {
            segments.pop_if_empty().push("join").push(room_name);
        }
        Err(()) => return String::new(),
    }
    url.to_string()
}

/// The server library's URL, whatever the remote settings say.
fn server_url(state: &AppState) -> Option<String> {
    with_state(state, |runtime| {
        Ok(runtime
            .config
            .server_library
            .as_ref()
            .filter(|_| runtime.songs_folder.is_some())
            .map(|server| server.url.clone()))
    })
    .ok()
    .flatten()
}

/// This PC's room: asked from the server, or as last known when it cannot be
/// reached. None without a server library.
#[tauri::command]
pub async fn get_server_room(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<Option<DesktopRoom>, String> {
    let Some(url) = server_url(&state) else {
        forget_room(&app);
        return Ok(None);
    };
    let token = read_token(&app)?;
    let client = client(Duration::from_secs(10))?;
    match fetch_room(&client, &url, &token).await {
        Ok(room) => Ok(Some(remember_room(&app, &url, room))),
        Err(error) => {
            let known = ROOM
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner())
                .clone();
            known.map(Some).ok_or(error)
        }
    }
}

/// Renames this PC's room; None picks a new random flower. Another desktop
/// with the same name is refused by the server.
#[tauri::command]
pub async fn rename_server_room(
    app: AppHandle,
    state: State<'_, AppState>,
    room_name: Option<String>,
) -> Result<DesktopRoom, String> {
    let url = server_url(&state).ok_or("connect a song server first")?;
    let token = read_token(&app)?;
    let client = client(Duration::from_secs(10))?;
    let response = client
        .put(endpoint(&url, "api/v1/remote/desktop/room")?)
        .header(AUTHORIZATION, format!("Bearer {token}"))
        .header(CONTENT_TYPE, "application/json")
        .body(serde_json::json!({ "room_name": room_name }).to_string())
        .send()
        .await
        .map_err(|error| format!("could not reach the song server: {error}"))?;
    if !response.status().is_success() {
        return Err(server_error(response).await);
    }
    let room = response
        .json::<DesktopRoom>()
        .await
        .map_err(|error| format!("invalid answer from the song server: {error}"))?;
    Ok(remember_room(&app, &url, room))
}

async fn fetch_room(
    client: &reqwest::Client,
    url: &str,
    token: &str,
) -> Result<DesktopRoom, String> {
    let response = client
        .get(endpoint(url, "api/v1/remote/desktop")?)
        .header(AUTHORIZATION, format!("Bearer {token}"))
        .send()
        .await
        .map_err(|error| format!("could not reach the song server: {error}"))?;
    if !response.status().is_success() {
        return Err(server_error(response).await);
    }
    response
        .json::<DesktopRoom>()
        .await
        .map_err(|error| format!("invalid answer from the song server: {error}"))
}

/// The server's own message (`{"error": "..."}`) when it gave one.
async fn server_error(response: reqwest::Response) -> String {
    let status = response.status();
    #[derive(Deserialize)]
    struct ErrorBody {
        error: String,
    }
    match response.json::<ErrorBody>().await {
        Ok(body) => body.error,
        Err(_) if status == reqwest::StatusCode::NOT_FOUND => {
            "this song server does not have rooms yet; update it".into()
        }
        Err(_) => format!("the song server answered {status}"),
    }
}

#[derive(Debug, Clone, PartialEq, Serialize)]
struct DesktopState {
    accepts_commands: bool,
    projecting: bool,
    blanked: bool,
    song_id: Option<String>,
    song_title: Option<String>,
    slide_index: Option<usize>,
    slide_labels: Vec<String>,
    set_id: Option<String>,
    set_item_index: Option<usize>,
    shares_room: bool,
    /// The words of every slide (no chords), for the room and the remote.
    slides: Vec<RoomSlide>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
struct RoomSlide {
    label: String,
    lines: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
struct RemoteCommand {
    action: String,
    slide_index: Option<usize>,
    song_id: Option<String>,
    set_id: Option<String>,
    item_index: Option<usize>,
    #[serde(default)]
    issued_by: String,
}

/// Sent to the console to project a song through its normal path.
#[derive(Debug, Clone, Serialize)]
pub struct RemoteProject {
    pub filename: String,
    pub transpose: i32,
    pub set_id: Option<String>,
    pub item_index: Option<usize>,
    pub issued_by: String,
}

/// What this PC does through the server now.
#[derive(Debug, Clone, Copy, PartialEq)]
struct Sharing {
    commands: bool,
    room: bool,
}

/// The server URL and what to share, while a server library is open and
/// remote control or room sharing is on.
fn connection(state: &AppState) -> Option<(String, Sharing)> {
    with_state(state, |runtime| {
        let sharing = Sharing {
            commands: runtime.config.server_remote_enabled,
            room: runtime.config.server_room_sharing,
        };
        Ok(runtime
            .config
            .server_library
            .as_ref()
            .filter(|_| (sharing.commands || sharing.room) && runtime.songs_folder.is_some())
            .map(|server| (server.url.clone(), sharing)))
    })
    .ok()
    .flatten()
}

/// The server URL while remote control is on.
fn command_connection(state: &AppState) -> Option<String> {
    connection(state)
        .filter(|(_, sharing)| sharing.commands)
        .map(|(url, _)| url)
}

pub fn spawn_background(app: &AppHandle) {
    let reporter = app.clone();
    tauri::async_runtime::spawn(async move { report_loop(reporter).await });
    let poller = app.clone();
    tauri::async_runtime::spawn(async move { command_loop(poller).await });
}

async fn report_loop(app: AppHandle) {
    let client = match client(Duration::from_secs(10)) {
        Ok(client) => client,
        Err(error) => return eprintln!("[server remote] {error}"),
    };
    let mut last: Option<(String, DesktopState)> = None;
    let mut last_sent = Instant::now();
    let mut room_checked: Option<(String, Instant)> = None;
    let mut song_ids = SongIdCache::default();
    loop {
        tokio::time::sleep(Duration::from_millis(700)).await;
        let state = app.state::<AppState>();
        let Some((url, sharing)) = connection(&state) else {
            // Turned off or disconnected: say goodbye once.
            if let Some((url, _)) = last.take() {
                if let Ok(token) = read_token(&app) {
                    let _ = send(&client, reqwest::Method::DELETE, &url, &token, None).await;
                }
            }
            if server_url(&state).is_none() {
                room_checked = None;
                forget_room(&app);
            }
            continue;
        };
        let Ok(token) = read_token(&app) else {
            continue;
        };
        // Learn the room name on connecting, and now and then after, so a
        // name a leader changed on the web shows here.
        let check_room = room_checked
            .as_ref()
            .is_none_or(|(checked_url, at)| checked_url != &url || at.elapsed() >= ROOM_REFRESH);
        if check_room {
            room_checked = Some((url.clone(), Instant::now()));
            match fetch_room(&client, &url, &token).await {
                Ok(room) => {
                    remember_room(&app, &url, room);
                }
                Err(error) => eprintln!("[server remote] could not read the room: {error}"),
            }
        }
        let current = desktop_state(&app, &state, &url, sharing, &mut song_ids);
        let changed = last
            .as_ref()
            .is_none_or(|(sent_url, sent)| sent_url != &url || sent != &current);
        if !changed && last_sent.elapsed() < HEARTBEAT {
            continue;
        }
        let body = serde_json::to_value(&current).unwrap_or_default();
        match send(&client, reqwest::Method::PUT, &url, &token, Some(&body)).await {
            Ok(()) => {
                last = Some((url, current));
                last_sent = Instant::now();
            }
            Err(error) => {
                eprintln!("[server remote] could not report state: {error}");
                last = None;
                tokio::time::sleep(RETRY).await;
            }
        }
    }
}

/// Server song id of the projected file; the manifest is read only when the
/// projected file changes.
#[derive(Default)]
struct SongIdCache {
    filename: Option<String>,
    song_id: Option<String>,
}

impl SongIdCache {
    fn lookup(&mut self, app: &AppHandle, url: &str, filename: Option<&String>) -> Option<String> {
        if self.filename.as_ref() != filename {
            self.filename = filename.cloned();
            self.song_id = filename.and_then(|filename| {
                read_manifest(app, url)
                    .get(filename)
                    .map(|entry| entry.id.clone())
            });
        }
        self.song_id.clone()
    }
}

fn desktop_state(
    app: &AppHandle,
    state: &AppState,
    url: &str,
    sharing: Sharing,
    song_ids: &mut SongIdCache,
) -> DesktopState {
    let projecting = ["audience", "stage"].iter().any(|label| {
        app.get_webview_window(label)
            .and_then(|window| window.is_visible().ok())
            .unwrap_or(false)
    });
    let (projection, setlist_id, setlist) = with_state(state, |runtime| {
        let setlist = runtime
            .current_setlist_id
            .as_ref()
            .and_then(|id| runtime.setlists.as_ref()?.get(id).ok());
        Ok((
            runtime.projection.clone(),
            runtime.current_setlist_id.clone(),
            setlist,
        ))
    })
    .unwrap_or_default();

    let filename = projection.filename.clone();
    let song_id = song_ids.lookup(app, url, filename.as_ref());
    // Only sets the server knows are worth naming to a phone.
    let setlist = setlist.filter(|setlist| {
        setlist
            .server
            .as_ref()
            .is_some_and(|server| server.version.is_some())
    });
    let set_item_index = setlist.as_ref().and_then(|setlist| {
        setlist
            .items
            .iter()
            .position(|item| item.file.is_some() && item.file == filename)
    });
    let has_slides = !projection.slides.is_empty();
    DesktopState {
        accepts_commands: sharing.commands,
        projecting: projecting && has_slides,
        blanked: projection.blank,
        song_id,
        song_title: projection.title.clone(),
        slide_index: has_slides.then_some(projection.current_index),
        slide_labels: projection
            .slides
            .iter()
            .map(|slide| slide.section_label.clone())
            .collect(),
        set_id: setlist.as_ref().and(setlist_id),
        set_item_index,
        shares_room: sharing.room,
        slides: projection
            .slides
            .iter()
            .map(|slide| RoomSlide {
                label: slide.section_label.clone(),
                lines: slide
                    .lines
                    .iter()
                    .map(|line| line.text.trim_end().to_string())
                    .collect(),
            })
            .collect(),
    }
}

async fn command_loop(app: AppHandle) {
    let client = match client(Duration::from_secs(LONG_POLL_SECONDS + 15)) {
        Ok(client) => client,
        Err(error) => return eprintln!("[server remote] {error}"),
    };
    loop {
        let state = app.state::<AppState>();
        let Some(url) = command_connection(&state) else {
            tokio::time::sleep(Duration::from_secs(2)).await;
            continue;
        };
        let Ok(token) = read_token(&app) else {
            tokio::time::sleep(RETRY).await;
            continue;
        };
        let commands = match poll(&client, &url, &token).await {
            Ok(commands) => commands,
            Err(error) => {
                eprintln!("[server remote] {error}");
                tokio::time::sleep(RETRY).await;
                continue;
            }
        };
        // Turned off while the poll was open: ignore what arrived.
        if command_connection(&state).is_none() {
            continue;
        }
        for command in commands {
            if let Err(error) = execute(&app, &state, command).await {
                eprintln!("[server remote] command failed: {error}");
            }
        }
    }
}

async fn poll(
    client: &reqwest::Client,
    url: &str,
    token: &str,
) -> Result<Vec<RemoteCommand>, String> {
    let endpoint = endpoint(
        url,
        &format!("api/v1/remote/desktop/commands?wait={LONG_POLL_SECONDS}"),
    )?;
    let response = client
        .get(endpoint)
        .header(AUTHORIZATION, format!("Bearer {token}"))
        .send()
        .await
        .map_err(|error| format!("could not reach the song server: {error}"))?;
    match response.status() {
        status if status.is_success() => response
            .json()
            .await
            .map_err(|error| format!("invalid commands from the song server: {error}")),
        reqwest::StatusCode::NOT_FOUND => {
            // A server without remote control; check again much later.
            tokio::time::sleep(Duration::from_secs(300)).await;
            Ok(vec![])
        }
        status => Err(format!(
            "the song server answered {status} to a command poll"
        )),
    }
}

async fn execute(app: &AppHandle, state: &AppState, command: RemoteCommand) -> Result<(), String> {
    match command.action.as_str() {
        "next" => next_slide_inner(app, state).map(drop),
        "previous" => previous_slide_inner(app, state).map(drop),
        "blank" => {
            let (blank, index) = with_state(state, |runtime| {
                Ok((runtime.projection.blank, runtime.projection.current_index))
            })?;
            if blank {
                show_slide_inner(app, state, index).map(drop)
            } else {
                blank_screen_inner(app, state).map(drop)
            }
        }
        "show_slide" => {
            let index = command
                .slide_index
                .ok_or("show_slide without slide_index")?;
            show_slide_inner(app, state, index).map(drop)
        }
        "project_song" => {
            let song_id = command
                .song_id
                .as_deref()
                .ok_or("project_song without song_id")?;
            let filename = server_sets::ensure_song(app, state, song_id).await?;
            project(
                app,
                RemoteProject {
                    filename,
                    transpose: 0,
                    set_id: None,
                    item_index: None,
                    issued_by: command.issued_by,
                },
            )
        }
        "project_set_item" => {
            let set_id = command
                .set_id
                .clone()
                .ok_or("project_set_item without set_id")?;
            let index = command
                .item_index
                .ok_or("project_set_item without item_index")?;
            let mut item = set_item(state, &set_id, index)?;
            if item.is_none() {
                // Made or changed on a phone moments ago.
                server_sets::sync_sets(app, state).await?;
                item = set_item(state, &set_id, index)?;
            }
            let item = item.ok_or("that set item is not on this PC")?;
            match (item.item_type, item.file) {
                (SetlistItemType::Song, Some(filename)) => project(
                    app,
                    RemoteProject {
                        filename,
                        transpose: item.transpose.unwrap_or(0),
                        set_id: Some(set_id),
                        item_index: Some(index),
                        issued_by: command.issued_by,
                    },
                ),
                _ => blank_screen_inner(app, state).map(drop),
            }
        }
        other => Err(format!("unknown remote action {other}")),
    }
}

fn set_item(
    state: &AppState,
    set_id: &str,
    index: usize,
) -> Result<Option<crate::setlist::SetlistItem>, String> {
    with_state(state, |runtime| {
        Ok(runtime
            .setlists
            .as_ref()
            .and_then(|store| store.get(set_id).ok())
            .and_then(|setlist| setlist.items.get(index).cloned()))
    })
}

fn project(app: &AppHandle, request: RemoteProject) -> Result<(), String> {
    app.emit("remote-project", request)
        .map_err(|error| error.to_string())
}

fn client(timeout: Duration) -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(10))
        .timeout(timeout)
        .build()
        .map_err(|error| error.to_string())
}

fn endpoint(server_url: &str, path: &str) -> Result<url::Url, String> {
    url::Url::parse(server_url)
        .and_then(|base| base.join(path))
        .map_err(|error| error.to_string())
}

async fn send(
    client: &reqwest::Client,
    method: reqwest::Method,
    url: &str,
    token: &str,
    body: Option<&serde_json::Value>,
) -> Result<(), String> {
    let mut request = client
        .request(method, endpoint(url, "api/v1/remote/desktop")?)
        .header(AUTHORIZATION, format!("Bearer {token}"));
    if let Some(body) = body {
        request = request
            .header(CONTENT_TYPE, "application/json")
            .body(body.to_string());
    }
    let response = request.send().await.map_err(|error| error.to_string())?;
    if response.status().is_success() {
        Ok(())
    } else {
        Err(format!("the song server answered {}", response.status()))
    }
}

#[cfg(test)]
mod tests {
    use super::join_url;

    #[test]
    fn join_urls_follow_the_server_address() {
        assert_eq!(
            join_url("https://songs.example.org", "Lily"),
            "https://songs.example.org/join/Lily"
        );
        assert_eq!(
            join_url("https://example.org/psalm150/", "Main Hall"),
            "https://example.org/psalm150/join/Main%20Hall"
        );
    }
}
