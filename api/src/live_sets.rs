//! Leading a set live: a leader goes through a set on their phone, and
//! everyone who has the set open through its shared link moves to the same
//! item as they do. The leader sees how many shared-link pages are open.
//!
//! Like the remote relay, this lives in memory: a restart forgets who leads
//! and who watches until the leader's phone reports again (every few
//! seconds) and the pages reconnect.

use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};

use axum::{
    Json, Router,
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
    response::Response,
    routing::get,
};
use tokio::sync::watch;
use uuid::Uuid;

use crate::{
    AppState,
    auth::authenticate,
    error::{AppError, ErrorBody},
    models::{LeadSetRequest, SetLive, SharedSetLive},
    remote::{event_stream, live_events},
    sets::set_not_found,
    shared_sets::find_link,
};

/// Leading ends this long after the leader's last report, so a phone that
/// was locked or lost its connection does not lead for ever.
const LEAD_TIMEOUT: Duration = Duration::from_secs(60);
/// How often an open shared-link stream checks that its link still works.
const LINK_CHECK: Duration = Duration::from_secs(30);

pub fn router() -> Router<AppState> {
    Router::new()
        .route(
            "/sets/{set_id}/live",
            get(get_set_live).put(lead_set).delete(stop_leading_set),
        )
        .route("/public/sets/{share_key}/live/events", get(shared_set_live))
}

pub struct LiveSets {
    sets: Mutex<HashMap<Uuid, LiveSet>>,
    /// Bumped on every change; streams wait on it and then look again.
    changes: watch::Sender<u64>,
}

impl Default for LiveSets {
    fn default() -> Self {
        Self {
            sets: Mutex::default(),
            changes: watch::channel(0).0,
        }
    }
}

#[derive(Default)]
struct LiveSet {
    lead: Option<Lead>,
    viewers: usize,
}

struct Lead {
    item_id: Uuid,
    leader_name: String,
    at: Instant,
}

impl LiveSet {
    fn current_lead(&self) -> Option<&Lead> {
        self.lead
            .as_ref()
            .filter(|lead| lead.at.elapsed() < LEAD_TIMEOUT)
    }
}

impl LiveSets {
    fn with_sets<T>(&self, f: impl FnOnce(&mut HashMap<Uuid, LiveSet>) -> T) -> T {
        let mut sets = self
            .sets
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        f(&mut sets)
    }

    fn changed(&self) {
        self.changes
            .send_modify(|version| *version = version.wrapping_add(1));
    }

    /// The leader shows `item_id` now; also keeps leading alive.
    fn lead(&self, set_id: Uuid, item_id: Uuid, leader_name: String) {
        self.with_sets(|sets| {
            sets.entry(set_id).or_default().lead = Some(Lead {
                item_id,
                leader_name,
                at: Instant::now(),
            });
        });
        self.changed();
    }

    fn stop(&self, set_id: Uuid) {
        self.with_sets(|sets| {
            if let Some(set) = sets.get_mut(&set_id) {
                set.lead = None;
                if set.viewers == 0 {
                    sets.remove(&set_id);
                }
            }
        });
        self.changed();
    }

    pub fn view(&self, set_id: Uuid) -> SetLive {
        self.with_sets(|sets| {
            let set = sets.get(&set_id);
            let lead = set.and_then(LiveSet::current_lead);
            SetLive {
                leading: lead.is_some(),
                item_id: lead.map(|lead| lead.item_id),
                leader_name: lead.map(|lead| lead.leader_name.clone()),
                viewers: set.map_or(0, |set| set.viewers),
            }
        })
    }

    fn shared_view(&self, set_id: Uuid) -> SharedSetLive {
        let SetLive {
            item_id,
            leader_name,
            ..
        } = self.view(set_id);
        SharedSetLive {
            item_id,
            leader_name,
        }
    }

    /// A shared-link page opened the set; it counts until the guard drops.
    fn watch(self: &Arc<Self>, set_id: Uuid) -> Viewer {
        self.with_sets(|sets| sets.entry(set_id).or_default().viewers += 1);
        self.changed();
        Viewer {
            hub: self.clone(),
            set_id,
        }
    }
}

/// One open shared-link page.
struct Viewer {
    hub: Arc<LiveSets>,
    set_id: Uuid,
}

impl Drop for Viewer {
    fn drop(&mut self) {
        self.hub.with_sets(|sets| {
            if let Some(set) = sets.get_mut(&self.set_id) {
                set.viewers = set.viewers.saturating_sub(1);
                if set.viewers == 0 && set.current_lead().is_none() {
                    sets.remove(&self.set_id);
                }
            }
        });
        self.hub.changed();
    }
}

/// Checks the set is the caller's church's and not deleted.
async fn church_set(state: &AppState, church_id: Uuid, set_id: Uuid) -> Result<(), AppError> {
    let found = sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS (
             SELECT 1 FROM song_sets WHERE id = $1 AND church_id = $2 AND deleted_at IS NULL
         )",
    )
    .bind(set_id)
    .bind(church_id)
    .fetch_one(&state.pool)
    .await?;
    if found { Ok(()) } else { Err(set_not_found()) }
}

/// Who leads the set and how many shared-link pages have it open.
#[utoipa::path(
    get,
    path = "/api/v1/sets/{set_id}/live",
    security(("bearer" = [])),
    params(("set_id" = Uuid, Path)),
    responses(
        (status = 200, body = SetLive),
        (status = 401, body = ErrorBody),
        (status = 404, body = ErrorBody)
    )
)]
pub async fn get_set_live(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(set_id): Path<Uuid>,
) -> Result<Json<SetLive>, AppError> {
    let auth = authenticate(&headers, &state).await?;
    church_set(&state, auth.church_id, set_id).await?;
    Ok(Json(state.live_sets.view(set_id)))
}

/// Leads the set: everyone with its shared link moves to this item.
///
/// Send it again on every move and at least every 30 seconds while leading;
/// leading ends a minute after the last one. Leaders and owners only.
#[utoipa::path(
    put,
    path = "/api/v1/sets/{set_id}/live",
    security(("bearer" = [])),
    params(("set_id" = Uuid, Path)),
    request_body = LeadSetRequest,
    responses(
        (status = 200, body = SetLive),
        (status = 400, body = ErrorBody),
        (status = 403, body = ErrorBody),
        (status = 404, body = ErrorBody)
    )
)]
pub async fn lead_set(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(set_id): Path<Uuid>,
    Json(request): Json<LeadSetRequest>,
) -> Result<Json<SetLive>, AppError> {
    let auth = authenticate(&headers, &state).await?;
    let user_id = auth.require_editor()?;
    church_set(&state, auth.church_id, set_id).await?;
    let item = sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS (SELECT 1 FROM song_set_items WHERE id = $1 AND set_id = $2)",
    )
    .bind(request.item_id)
    .bind(set_id)
    .fetch_one(&state.pool)
    .await?;
    if !item {
        return Err(AppError::BadRequest("the item is not in this set".into()));
    }
    let leader_name =
        sqlx::query_scalar::<_, String>("SELECT display_name FROM users WHERE id = $1")
            .bind(user_id)
            .fetch_one(&state.pool)
            .await?;
    state.live_sets.lead(set_id, request.item_id, leader_name);
    Ok(Json(state.live_sets.view(set_id)))
}

/// Stops leading the set; shared-link pages stay where they are.
#[utoipa::path(
    delete,
    path = "/api/v1/sets/{set_id}/live",
    security(("bearer" = [])),
    params(("set_id" = Uuid, Path)),
    responses(
        (status = 204),
        (status = 403, body = ErrorBody),
        (status = 404, body = ErrorBody)
    )
)]
pub async fn stop_leading_set(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(set_id): Path<Uuid>,
) -> Result<StatusCode, AppError> {
    let auth = authenticate(&headers, &state).await?;
    auth.require_editor()?;
    church_set(&state, auth.church_id, set_id).await?;
    state.live_sets.stop(set_id);
    Ok(StatusCode::NO_CONTENT)
}

/// Anyone with the link: the item to show, as server-sent events.
///
/// For `EventSource`. Each `live` event says which item the leader shows (or
/// null), straight away and whenever it changes. While open, the page counts
/// as one of the set's viewers. The stream ends when the link stops working.
#[utoipa::path(
    get,
    path = "/api/v1/public/sets/{share_key}/live/events",
    params(("share_key" = String, Path)),
    responses(
        (status = 200, content_type = "text/event-stream", body = SharedSetLive),
        (status = 404, body = ErrorBody)
    )
)]
pub async fn shared_set_live(
    State(state): State<AppState>,
    Path(share_key): Path<String>,
) -> Result<Response, AppError> {
    let link = find_link(&state.pool, &share_key).await?;
    let set_id = link.id;
    let hub = state.live_sets.clone();
    let viewer = hub.watch(set_id);
    let pool = state.pool.clone();
    let mut checked = Instant::now();
    let events = live_events(hub.changes.subscribe(), "live", move || {
        // Owned by the stream: dropping it (the page went) stops the count.
        let _viewer = &viewer;
        let view = hub.shared_view(set_id);
        let recheck = checked.elapsed() >= LINK_CHECK;
        if recheck {
            checked = Instant::now();
        }
        let pool = pool.clone();
        let share_key = share_key.clone();
        async move {
            if recheck && find_link(&pool, &share_key).await.ok()?.id != set_id {
                return None;
            }
            serde_json::to_string(&view).ok()
        }
    });
    Ok(event_stream(events))
}
