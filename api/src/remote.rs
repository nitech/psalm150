//! Remote control through the song server.
//!
//! A desktop that allows it reports its projection state here and waits for
//! commands (long polling with its device token). A signed-in leader's phone
//! lists the church's desktops and sends commands: next, previous, blank,
//! jump to a slide, or project a song or a set item.
//!
//! Everything is kept in memory: a restart forgets desktops until they report
//! again (within seconds), and queued commands expire after
//! [`COMMAND_TTL_SECONDS`]. The desktop stays in charge: it can ignore a
//! command, and a service keeps running when the server is gone.

use std::{
    collections::{HashMap, VecDeque},
    sync::{Arc, Mutex},
    time::Duration,
};

use axum::{
    Json, Router,
    extract::{Path, Query, State},
    http::{HeaderMap, StatusCode},
    response::IntoResponse,
    routing::{get, post, put},
};
use chrono::{DateTime, Utc};
use tokio::sync::Notify;
use uuid::Uuid;

use crate::{
    AppState,
    auth::{AuthContext, authenticate},
    error::{AppError, ErrorBody},
    models::{
        CommandsQuery, DesktopState, RemoteAction, RemoteCommand, RemoteCommandRequest,
        RemoteDesktop,
    },
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
const MAX_SLIDE_LABELS: usize = 200;

#[derive(Default)]
pub struct RemoteHub {
    desktops: Mutex<HashMap<Uuid, DesktopEntry>>,
}

struct DesktopEntry {
    church_id: Uuid,
    name: String,
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

    fn touch(&self, device_id: Uuid, church_id: Uuid, name: &str) -> Arc<Notify> {
        self.with_desktops(|desktops| {
            let entry = desktops.entry(device_id).or_insert_with(|| DesktopEntry {
                church_id,
                name: name.to_string(),
                last_seen: Utc::now(),
                state: DesktopState::default(),
                commands: VecDeque::new(),
                notify: Arc::new(Notify::new()),
            });
            entry.name = name.to_string();
            entry.last_seen = Utc::now();
            entry.notify.clone()
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
            put(report_desktop_state).delete(leave_remote),
        )
        .route("/remote/desktop/commands", get(wait_for_commands))
        .route("/remote/desktops", get(list_desktops))
        .route("/remote/desktops/{device_id}/commands", post(send_command))
}

fn require_device(auth: &AuthContext) -> Result<Uuid, AppError> {
    auth.device_id
        .filter(|_| auth.is_device)
        .ok_or_else(|| AppError::Forbidden("a desktop token is required".into()))
}

async fn device_name(state: &AppState, device_id: Uuid) -> Result<String, AppError> {
    Ok(
        sqlx::query_scalar::<_, String>("SELECT name FROM device_tokens WHERE id = $1")
            .bind(device_id)
            .fetch_one(&state.pool)
            .await?,
    )
}

#[utoipa::path(
    put,
    path = "/api/v1/remote/desktop",
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
    let name = device_name(&state, device_id).await?;
    report.slide_labels.truncate(MAX_SLIDE_LABELS);
    for label in &mut report.slide_labels {
        if label.chars().count() > 60 {
            *label = label.chars().take(60).collect();
        }
    }
    if let Some(title) = &mut report.song_title
        && title.chars().count() > 200
    {
        *title = title.chars().take(200).collect();
    }
    state.remote.touch(device_id, auth.church_id, &name);
    state.remote.with_desktops(|desktops| {
        if let Some(entry) = desktops.get_mut(&device_id) {
            if !report.accepts_commands {
                entry.commands.clear();
            }
            entry.state = report;
        }
        let forget = Utc::now() - chrono::Duration::seconds(FORGET_SECONDS);
        desktops.retain(|_, entry| entry.last_seen >= forget);
    });
    Ok(StatusCode::NO_CONTENT)
}

#[utoipa::path(
    delete,
    path = "/api/v1/remote/desktop",
    responses((status = 204), (status = 403, body = ErrorBody))
)]
pub async fn leave_remote(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<StatusCode, AppError> {
    let auth = authenticate(&headers, &state).await?;
    let device_id = require_device(&auth)?;
    state.remote.with_desktops(|desktops| {
        if let Some(entry) = desktops.remove(&device_id) {
            // Wake a pending long poll so it returns promptly.
            entry.notify.notify_waiters();
        }
    });
    Ok(StatusCode::NO_CONTENT)
}

#[utoipa::path(
    get,
    path = "/api/v1/remote/desktop/commands",
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
    let name = device_name(&state, device_id).await?;
    let notify = state.remote.touch(device_id, auth.church_id, &name);

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
                state.remote.touch(device_id, auth.church_id, &name);
            }
            return Ok(Json(commands));
        }
    }
}

#[utoipa::path(
    get,
    path = "/api/v1/remote/desktops",
    responses((status = 200, body = [RemoteDesktop]), (status = 401, body = ErrorBody))
)]
pub async fn list_desktops(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Vec<RemoteDesktop>>, AppError> {
    let auth = authenticate(&headers, &state).await?;
    let online_since = Utc::now() - chrono::Duration::seconds(ONLINE_SECONDS);
    let mut desktops = state.remote.with_desktops(|desktops| {
        desktops
            .iter()
            .filter(|(_, entry)| entry.church_id == auth.church_id)
            .map(|(device_id, entry)| RemoteDesktop {
                device_id: *device_id,
                name: entry.name.clone(),
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
    .bind(auth.church_id)
    .fetch_all(&state.pool)
    .await?;
    desktops.retain(|desktop| active.contains(&desktop.device_id));
    desktops.sort_by(|a, b| {
        b.online
            .cmp(&a.online)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
    Ok(Json(desktops))
}

#[utoipa::path(
    post,
    path = "/api/v1/remote/desktops/{device_id}/commands",
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
