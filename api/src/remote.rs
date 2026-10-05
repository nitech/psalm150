//! Remote control through the song server.
//!
//! A desktop reports its projection state here and waits for commands (long
//! polling with its device token). A signed-in leader's phone lists the
//! church's desktops, by their room names, and sends commands: next,
//! previous, blank, jump to a slide, or project a song or a set item. Phones
//! follow the list live through `GET /remote/desktops/events`; people
//! following a room get the same push from `rooms.rs`.
//!
//! Everything is kept in memory: a restart forgets desktops until they report
//! again (within seconds), and queued commands expire after
//! [`COMMAND_TTL_SECONDS`]. The desktop stays in charge: it can ignore a
//! command, and a service keeps running when the server is gone.

use std::{
    collections::{HashMap, VecDeque},
    convert::Infallible,
    future::Future,
    sync::{Arc, Mutex},
    time::Duration,
};

use axum::{
    Json, Router,
    extract::{Path, Query, State},
    http::{HeaderMap, HeaderName, HeaderValue, StatusCode},
    response::{
        IntoResponse, Response,
        sse::{Event, KeepAlive, Sse},
    },
    routing::{get, post},
};
use chrono::{DateTime, Utc};
use futures_util::{Stream, stream};
use tokio::sync::{Notify, watch};
use uuid::Uuid;

use crate::{
    AppState,
    auth::{AuthContext, authenticate},
    error::{AppError, ErrorBody},
    models::{
        CommandsQuery, DesktopState, RemoteAction, RemoteCommand, RemoteCommandRequest,
        RemoteDesktop, RoomSlide, RoomStatus, RoomView,
    },
    rooms::{self, DesktopIdentity},
};

/// A desktop counts as online when it reported within this many seconds.
pub const ONLINE_SECONDS: i64 = 45;
/// A queued command older than this is dropped instead of executed.
pub const COMMAND_TTL_SECONDS: i64 = 30;
/// Desktops silent for longer than this are forgotten.
const FORGET_SECONDS: i64 = 24 * 60 * 60;
/// Longest long-poll wait a desktop may ask for.
const MAX_WAIT_SECONDS: u64 = 30;
/// Most commands kept per desktop; older ones are dropped first.
const MAX_QUEUED: usize = 20;
const MAX_SLIDES: usize = 200;
const MAX_LINES_PER_SLIDE: usize = 40;
const MAX_LINE_CHARS: usize = 300;
/// Live streams look again this often even when nothing changed, so a
/// desktop that went quiet shows as offline.
const LIVE_REFRESH: Duration = Duration::from_secs(10);

pub struct RemoteHub {
    desktops: Mutex<HashMap<Uuid, DesktopEntry>>,
    /// Bumped whenever a desktop's state, names or presence changes; live
    /// streams wait on it and then work out whether their view changed.
    changes: watch::Sender<u64>,
}

impl Default for RemoteHub {
    fn default() -> Self {
        Self {
            desktops: Mutex::default(),
            changes: watch::channel(0).0,
        }
    }
}

struct DesktopEntry {
    church_id: Uuid,
    name: String,
    room_name: String,
    /// The church shares its projections in rooms.
    rooms_open: bool,
    last_seen: DateTime<Utc>,
    state: DesktopState,
    commands: VecDeque<RemoteCommand>,
    notify: Arc<Notify>,
}

impl RemoteHub {
    fn with_desktops<T>(&self, f: impl FnOnce(&mut HashMap<Uuid, DesktopEntry>) -> T) -> T {
        let mut desktops = self
            .desktops
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        f(&mut desktops)
    }

    fn changed(&self) {
        self.changes
            .send_modify(|version| *version = version.wrapping_add(1));
    }

    pub fn subscribe(&self) -> watch::Receiver<u64> {
        self.changes.subscribe()
    }

    fn touch(&self, device_id: Uuid, identity: &DesktopIdentity) -> Arc<Notify> {
        let online_since = Utc::now() - chrono::Duration::seconds(ONLINE_SECONDS);
        let (notify, changed) = self.with_desktops(|desktops| {
            let mut changed = false;
            let entry = desktops.entry(device_id).or_insert_with(|| {
                changed = true;
                DesktopEntry {
                    church_id: identity.church_id,
                    name: identity.name.clone(),
                    room_name: identity.room_name.clone(),
                    rooms_open: identity.rooms_open,
                    last_seen: Utc::now(),
                    state: DesktopState::default(),
                    commands: VecDeque::new(),
                    notify: Arc::new(Notify::new()),
                }
            });
            // Back after going quiet: it shows as online again.
            changed |= entry.last_seen < online_since
                || entry.name != identity.name
                || entry.room_name != identity.room_name
                || entry.rooms_open != identity.rooms_open;
            entry.name.clone_from(&identity.name);
            entry.room_name.clone_from(&identity.room_name);
            entry.rooms_open = identity.rooms_open;
            entry.last_seen = Utc::now();
            (entry.notify.clone(), changed)
        });
        if changed {
            self.changed();
        }
        notify
    }

    /// A desktop's room was renamed.
    pub fn rename_room(&self, device_id: Uuid, room_name: &str) {
        self.with_desktops(|desktops| {
            if let Some(entry) = desktops.get_mut(&device_id) {
                entry.room_name = room_name.to_string();
            }
        });
        self.changed();
    }

    /// A desktop was revoked: it leaves the list and its room at once.
    pub fn forget(&self, device_id: Uuid) {
        let removed = self.with_desktops(|desktops| desktops.remove(&device_id));
        if let Some(entry) = removed {
            entry.notify.notify_waiters();
            self.changed();
        }
    }

    /// An owner opened or closed the church's rooms.
    pub fn set_rooms_open(&self, church_id: Uuid, open: bool) {
        self.with_desktops(|desktops| {
            for entry in desktops.values_mut() {
                if entry.church_id == church_id {
                    entry.rooms_open = open;
                }
            }
        });
        self.changed();
    }

    /// What someone following the desktop's room sees now. `room_name` is
    /// used while the desktop has not reported since the server started.
    pub fn room_view(&self, device_id: Uuid, room_name: &str) -> RoomView {
        let online_since = Utc::now() - chrono::Duration::seconds(ONLINE_SECONDS);
        self.with_desktops(|desktops| {
            let mut view = RoomView {
                room_name: room_name.to_string(),
                status: RoomStatus::Offline,
                song_title: None,
                slide_index: None,
                slides: Vec::new(),
            };
            let Some(entry) = desktops.get(&device_id) else {
                return view;
            };
            view.room_name.clone_from(&entry.room_name);
            if entry.last_seen < online_since {
                return view;
            }
            let state = &entry.state;
            if !entry.rooms_open
                || !state.shares_room
                || !state.projecting
                || state.slides.is_empty()
            {
                view.status = RoomStatus::Idle;
                return view;
            }
            view.status = if state.blanked {
                RoomStatus::Blank
            } else {
                RoomStatus::Live
            };
            view.song_title.clone_from(&state.song_title);
            view.slide_index = state.slide_index;
            view.slides.clone_from(&state.slides);
            view
        })
    }

    fn take_commands(&self, device_id: Uuid) -> Vec<RemoteCommand> {
        let cutoff = Utc::now() - chrono::Duration::seconds(COMMAND_TTL_SECONDS);
        self.with_desktops(|desktops| {
            desktops
                .get_mut(&device_id)
                .map(|entry| {
                    entry
                        .commands
                        .drain(..)
                        .filter(|command| command.issued_at >= cutoff)
                        .collect()
                })
                .unwrap_or_default()
        })
    }
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route(
            "/remote/desktop",
            get(rooms::own_room)
                .put(report_desktop_state)
                .delete(leave_remote),
        )
        .route("/remote/desktop/commands", get(wait_for_commands))
        .route("/remote/desktops", get(list_desktops))
        .route("/remote/desktops/events", get(desktop_events))
        .route("/remote/desktops/{device_id}/commands", post(send_command))
}

pub(crate) fn require_device(auth: &AuthContext) -> Result<Uuid, AppError> {
    auth.device_id
        .filter(|_| auth.is_device())
        .ok_or_else(|| AppError::Forbidden("a desktop token is required".into()))
}

/// Keeps what a desktop reports to a sensible size.
fn trim_report(report: &mut DesktopState) {
    fn trim(text: &mut String, chars: usize) {
        if text.chars().count() > chars {
            *text = text.chars().take(chars).collect();
        }
    }
    report.slide_labels.truncate(MAX_SLIDES);
    for label in &mut report.slide_labels {
        trim(label, 60);
    }
    if let Some(title) = &mut report.song_title {
        trim(title, 200);
    }
    report.slides.truncate(MAX_SLIDES);
    for RoomSlide { label, lines } in &mut report.slides {
        trim(label, 60);
        lines.truncate(MAX_LINES_PER_SLIDE);
        for line in lines {
            trim(line, MAX_LINE_CHARS);
        }
    }
}

/// Server-sent events from `compute`, which gives the event's JSON: sent
/// once straight away, then again whenever the hub changes (or every
/// [`LIVE_REFRESH`]) and the JSON differs from the last sent. `None` ends
/// the stream.
pub(crate) fn live_events<F, Fut>(
    changes: watch::Receiver<u64>,
    event: &'static str,
    compute: F,
) -> impl Stream<Item = Result<Event, Infallible>> + Send + 'static
where
    F: FnMut() -> Fut + Send + 'static,
    Fut: Future<Output = Option<String>> + Send,
{
    let start = (changes, compute, None::<String>, true);
    stream::unfold(
        start,
        move |(mut changes, mut compute, mut last, mut first)| async move {
            loop {
                if !first {
                    tokio::select! {
                        changed = changes.changed() => changed.ok()?,
                        () = tokio::time::sleep(LIVE_REFRESH) => {}
                    }
                }
                first = false;
                let json = compute().await?;
                if last.as_deref() != Some(json.as_str()) {
                    last = Some(json.clone());
                    let sent = Event::default().event(event).data(json);
                    return Some((Ok(sent), (changes, compute, last, first)));
                }
            }
        },
    )
}

/// An event stream that proxies pass on as it comes, with keep-alive
/// comments so idle connections are not cut.
pub(crate) fn event_stream(
    events: impl Stream<Item = Result<Event, Infallible>> + Send + 'static,
) -> Response {
    let mut response = Sse::new(events)
        .keep_alive(KeepAlive::default())
        .into_response();
    response.headers_mut().insert(
        HeaderName::from_static("x-accel-buffering"),
        HeaderValue::from_static("no"),
    );
    response
}

#[utoipa::path(
    put,
    path = "/api/v1/remote/desktop",
    security(("bearer" = [])),
    request_body = DesktopState,
    responses((status = 204), (status = 403, body = ErrorBody))
)]
pub async fn report_desktop_state(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(mut report): Json<DesktopState>,
) -> Result<StatusCode, AppError> {
    let auth = authenticate(&headers, &state).await?;
    let device_id = require_device(&auth)?;
    let identity = rooms::desktop_identity(&state, device_id).await?;
    trim_report(&mut report);
    state.remote.touch(device_id, &identity);
    let changed = state.remote.with_desktops(|desktops| {
        let mut changed = false;
        if let Some(entry) = desktops.get_mut(&device_id) {
            if !report.accepts_commands {
                entry.commands.clear();
            }
            changed = entry.state != report;
            entry.state = report;
        }
        let forget = Utc::now() - chrono::Duration::seconds(FORGET_SECONDS);
        let before = desktops.len();
        desktops.retain(|_, entry| entry.last_seen >= forget);
        changed || desktops.len() != before
    });
    if changed {
        state.remote.changed();
    }
    Ok(StatusCode::NO_CONTENT)
}

#[utoipa::path(
    delete,
    path = "/api/v1/remote/desktop",
    security(("bearer" = [])),
    responses((status = 204), (status = 403, body = ErrorBody))
)]
pub async fn leave_remote(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<StatusCode, AppError> {
    let auth = authenticate(&headers, &state).await?;
    let device_id = require_device(&auth)?;
    // Also wakes a pending long poll so it returns promptly.
    state.remote.forget(device_id);
    Ok(StatusCode::NO_CONTENT)
}

#[utoipa::path(
    get,
    path = "/api/v1/remote/desktop/commands",
    security(("bearer" = [])),
    params(CommandsQuery),
    responses((status = 200, body = [RemoteCommand]), (status = 403, body = ErrorBody))
)]
pub async fn wait_for_commands(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<CommandsQuery>,
) -> Result<Json<Vec<RemoteCommand>>, AppError> {
    let auth = authenticate(&headers, &state).await?;
    let device_id = require_device(&auth)?;
    let identity = rooms::desktop_identity(&state, device_id).await?;
    let notify = state.remote.touch(device_id, &identity);

    let commands = state.remote.take_commands(device_id);
    let wait = query.wait.unwrap_or(0).min(MAX_WAIT_SECONDS);
    if !commands.is_empty() || wait == 0 {
        return Ok(Json(commands));
    }
    // `notify_one` stores a permit when nobody waits, so a command queued
    // between the check above and this await is not missed. A permit left
    // over from commands already taken wakes us early with nothing to do,
    // so keep waiting until the deadline.
    let deadline = tokio::time::Instant::now() + Duration::from_secs(wait);
    loop {
        let woke = tokio::time::timeout_at(deadline, notify.notified()).await;
        let commands = state.remote.take_commands(device_id);
        let left = state
            .remote
            .with_desktops(|desktops| desktops.contains_key(&device_id));
        if !commands.is_empty() || woke.is_err() || !left {
            if left {
                state.remote.touch(device_id, &identity);
            }
            return Ok(Json(commands));
        }
    }
}

#[utoipa::path(
    get,
    path = "/api/v1/remote/desktops",
    security(("bearer" = [])),
    responses((status = 200, body = [RemoteDesktop]), (status = 401, body = ErrorBody))
)]
pub async fn list_desktops(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Vec<RemoteDesktop>>, AppError> {
    let auth = authenticate(&headers, &state).await?;
    Ok(Json(church_desktops(&state, auth.church_id).await?))
}

async fn church_desktops(
    state: &AppState,
    church_id: Uuid,
) -> Result<Vec<RemoteDesktop>, AppError> {
    let online_since = Utc::now() - chrono::Duration::seconds(ONLINE_SECONDS);
    let mut desktops = state.remote.with_desktops(|desktops| {
        desktops
            .iter()
            .filter(|(_, entry)| entry.church_id == church_id)
            .map(|(device_id, entry)| RemoteDesktop {
                device_id: *device_id,
                name: entry.name.clone(),
                room_name: entry.room_name.clone(),
                online: entry.last_seen >= online_since,
                last_seen: entry.last_seen,
                state: entry.state.clone(),
            })
            .collect::<Vec<_>>()
    });
    // A revoked token must not keep showing up.
    let active = sqlx::query_scalar::<_, Uuid>(
        "SELECT id FROM device_tokens WHERE church_id = $1 AND revoked_at IS NULL",
    )
    .bind(church_id)
    .fetch_all(&state.pool)
    .await?;
    desktops.retain(|desktop| active.contains(&desktop.device_id));
    desktops.sort_by(|a, b| {
        b.online
            .cmp(&a.online)
            .then_with(|| a.room_name.to_lowercase().cmp(&b.room_name.to_lowercase()))
    });
    Ok(desktops)
}

/// The church's desktops as server-sent events: a `desktops` event with the
/// same list as `GET /remote/desktops` straight away and whenever it
/// changes. A browser's `EventSource` cannot send the bearer token, so read
/// the stream with `fetch`. The stream ends when the token stops working.
#[utoipa::path(
    get,
    path = "/api/v1/remote/desktops/events",
    security(("bearer" = [])),
    responses(
        (status = 200, content_type = "text/event-stream", body = [RemoteDesktop]),
        (status = 401, body = ErrorBody)
    )
)]
pub async fn desktop_events(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Response, AppError> {
    let auth = authenticate(&headers, &state).await?;
    let church_id = auth.church_id;
    let changes = state.remote.subscribe();
    let events = live_events(changes, "desktops", move || {
        let state = state.clone();
        let headers = headers.clone();
        async move {
            // A session that ended stops getting updates.
            authenticate(&headers, &state)
                .await
                .ok()
                .filter(|auth| auth.church_id == church_id)?;
            let desktops = church_desktops(&state, church_id).await.ok()?;
            serde_json::to_string(&desktops).ok()
        }
    });
    Ok(event_stream(events))
}

#[utoipa::path(
    post,
    path = "/api/v1/remote/desktops/{device_id}/commands",
    security(("bearer" = [])),
    params(("device_id" = Uuid, Path)),
    request_body = RemoteCommandRequest,
    responses(
        (status = 202, body = RemoteCommand),
        (status = 400, body = ErrorBody),
        (status = 403, body = ErrorBody),
        (status = 404, body = ErrorBody),
        (status = 409, body = ErrorBody)
    )
)]
pub async fn send_command(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(device_id): Path<Uuid>,
    Json(request): Json<RemoteCommandRequest>,
) -> Result<impl IntoResponse, AppError> {
    let auth = authenticate(&headers, &state).await?;
    let user_id = auth.require_editor()?;
    validate_command(&state, auth.church_id, &request).await?;
    let issued_by = sqlx::query_scalar::<_, String>("SELECT display_name FROM users WHERE id = $1")
        .bind(user_id)
        .fetch_one(&state.pool)
        .await?;

    let command = RemoteCommand {
        id: Uuid::new_v4(),
        action: request.action,
        slide_index: request.slide_index,
        song_id: request.song_id,
        set_id: request.set_id,
        item_index: request.item_index,
        issued_by,
        issued_at: Utc::now(),
    };
    let online_since = Utc::now() - chrono::Duration::seconds(ONLINE_SECONDS);
    state.remote.with_desktops(|desktops| {
        let entry = desktops
            .get_mut(&device_id)
            .filter(|entry| entry.church_id == auth.church_id && entry.last_seen >= online_since)
            .ok_or_else(|| AppError::NotFound("that desktop is not online".into()))?;
        if !entry.state.accepts_commands {
            return Err(AppError::Conflict(
                "that desktop does not accept remote control".into(),
            ));
        }
        if entry.commands.len() >= MAX_QUEUED {
            entry.commands.pop_front();
        }
        entry.commands.push_back(command.clone());
        entry.notify.notify_one();
        Ok(())
    })?;
    Ok((StatusCode::ACCEPTED, Json(command)))
}

async fn validate_command(
    state: &AppState,
    church_id: Uuid,
    request: &RemoteCommandRequest,
) -> Result<(), AppError> {
    match request.action {
        RemoteAction::Next | RemoteAction::Previous | RemoteAction::Blank => Ok(()),
        RemoteAction::ShowSlide => request
            .slide_index
            .map(|_| ())
            .ok_or_else(|| AppError::BadRequest("show_slide needs slide_index".into())),
        RemoteAction::ProjectSong => {
            let song_id = request
                .song_id
                .ok_or_else(|| AppError::BadRequest("project_song needs song_id".into()))?;
            let exists = sqlx::query_scalar::<_, bool>(
                "SELECT EXISTS (SELECT 1 FROM songs
                 WHERE id = $1 AND church_id = $2 AND deleted_at IS NULL)",
            )
            .bind(song_id)
            .bind(church_id)
            .fetch_one(&state.pool)
            .await?;
            if exists {
                Ok(())
            } else {
                Err(AppError::NotFound("song was not found".into()))
            }
        }
        RemoteAction::ProjectSetItem => {
            let (Some(set_id), Some(item_index)) = (request.set_id, request.item_index) else {
                return Err(AppError::BadRequest(
                    "project_set_item needs set_id and item_index".into(),
                ));
            };
            let items = sqlx::query_scalar::<_, i64>(
                "SELECT (SELECT count(*) FROM song_set_items i WHERE i.set_id = s.id)
                 FROM song_sets s
                 WHERE s.id = $1 AND s.church_id = $2 AND s.deleted_at IS NULL",
            )
            .bind(set_id)
            .bind(church_id)
            .fetch_optional(&state.pool)
            .await?
            .ok_or_else(|| AppError::NotFound("set was not found".into()))?;
            if i64::from(item_index) < items {
                Ok(())
            } else {
                Err(AppError::BadRequest("item_index is outside the set".into()))
            }
        }
    }
}
