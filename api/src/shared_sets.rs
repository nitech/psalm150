//! Shared sets: a leader puts a set on a link, and anyone who has the link
//! reads the set and goes through its songs without an account.
//!
//! The link is `<server>/shared/{key}`. People with it never steer a desktop
//! and never change a song. When the leader makes the link editable, they may
//! also add songs of the church's library to the set and remove songs from
//! it; nothing else about the set changes through the link. Stopping the
//! share forgets the key, so the old link stops working at once.

use axum::{
    Json, Router,
    extract::{Path, Query, State},
    http::{HeaderMap, StatusCode},
    routing::{delete, get, post},
};
use chrono::{DateTime, NaiveDate, Utc};
use sqlx::{FromRow, PgPool, Postgres, Transaction};
use uuid::Uuid;

use crate::{
    AppState,
    api::{Library, fetch_song, search_songs},
    auth::authenticate,
    error::{AppError, ErrorBody},
    models::{
        AddSharedSetItemRequest, SetItemInput, SetItemKind, SetShare, ShareSetRequest, SharedSet,
        SongDetail, SongQuery, SongSummary,
    },
    sets::{MAX_SET_ITEMS, fetch_items, set_not_found, write_items},
};

pub fn router() -> Router<AppState> {
    Router::new()
        .route(
            "/sets/{set_id}/share",
            get(get_set_share).put(share_set).delete(stop_sharing_set),
        )
        .route("/public/sets/{share_key}", get(get_shared_set))
        .route("/public/sets/{share_key}/songs", get(list_shared_set_songs))
        .route(
            "/public/sets/{share_key}/songs/{song_id}",
            get(get_shared_set_song),
        )
        .route("/public/sets/{share_key}/items", post(add_shared_set_item))
        .route(
            "/public/sets/{share_key}/items/{item_id}",
            delete(remove_shared_set_item),
        )
}

/// A set's share link; 404 when the set is not shared.
#[utoipa::path(
    get,
    path = "/api/v1/sets/{set_id}/share",
    security(("bearer" = [])),
    params(("set_id" = Uuid, Path)),
    responses(
        (status = 200, body = SetShare),
        (status = 403, body = ErrorBody),
        (status = 404, body = ErrorBody)
    )
)]
pub async fn get_set_share(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(set_id): Path<Uuid>,
) -> Result<Json<SetShare>, AppError> {
    let auth = authenticate(&headers, &state).await?;
    auth.require_editor()?;
    sqlx::query_as::<_, SetShare>(
        "SELECT share_key AS key, share_editable AS editable, shared_at
         FROM song_sets
         WHERE id = $1 AND church_id = $2 AND deleted_at IS NULL
           AND share_key IS NOT NULL",
    )
    .bind(set_id)
    .bind(auth.church_id)
    .fetch_optional(&state.pool)
    .await?
    .map(Json)
    .ok_or_else(|| AppError::NotFound("set is not shared".into()))
}

/// Shares a set on a link, or changes whether the link may edit it.
///
/// A set already shared keeps its link. Leaders and owners only.
#[utoipa::path(
    put,
    path = "/api/v1/sets/{set_id}/share",
    security(("bearer" = [])),
    params(("set_id" = Uuid, Path)),
    request_body = ShareSetRequest,
    responses(
        (status = 200, body = SetShare),
        (status = 403, body = ErrorBody),
        (status = 404, body = ErrorBody)
    )
)]
pub async fn share_set(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(set_id): Path<Uuid>,
    Json(request): Json<ShareSetRequest>,
) -> Result<Json<SetShare>, AppError> {
    let auth = authenticate(&headers, &state).await?;
    auth.require_editor()?;
    sqlx::query_as::<_, SetShare>(
        "UPDATE song_sets
         SET share_key = coalesce(share_key, $3), share_editable = $4,
             shared_at = coalesce(shared_at, now())
         WHERE id = $1 AND church_id = $2 AND deleted_at IS NULL
         RETURNING share_key AS key, share_editable AS editable, shared_at",
    )
    .bind(set_id)
    .bind(auth.church_id)
    .bind(Uuid::new_v4().simple().to_string())
    .bind(request.editable)
    .fetch_optional(&state.pool)
    .await?
    .map(Json)
    .ok_or_else(set_not_found)
}

/// Stops sharing a set: its link stops working at once.
///
/// Sharing it again makes a new link. Leaders and owners only.
#[utoipa::path(
    delete,
    path = "/api/v1/sets/{set_id}/share",
    security(("bearer" = [])),
    params(("set_id" = Uuid, Path)),
    responses(
        (status = 204),
        (status = 403, body = ErrorBody),
        (status = 404, body = ErrorBody)
    )
)]
pub async fn stop_sharing_set(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(set_id): Path<Uuid>,
) -> Result<StatusCode, AppError> {
    let auth = authenticate(&headers, &state).await?;
    auth.require_editor()?;
    let stopped = sqlx::query(
        "UPDATE song_sets
         SET share_key = NULL, share_editable = false, shared_at = NULL
         WHERE id = $1 AND church_id = $2 AND deleted_at IS NULL",
    )
    .bind(set_id)
    .bind(auth.church_id)
    .execute(&state.pool)
    .await?;
    if stopped.rows_affected() == 0 {
        return Err(set_not_found());
    }
    Ok(StatusCode::NO_CONTENT)
}

/// Anyone with the link: the shared set with its items.
#[utoipa::path(
    get,
    path = "/api/v1/public/sets/{share_key}",
    params(("share_key" = String, Path)),
    responses((status = 200, body = SharedSet), (status = 404, body = ErrorBody))
)]
pub async fn get_shared_set(
    State(state): State<AppState>,
    Path(share_key): Path<String>,
) -> Result<Json<SharedSet>, AppError> {
    let link = find_link(&state.pool, &share_key).await?;
    Ok(Json(fetch_shared(&state.pool, &link).await?))
}

/// Anyone with the link: a song of the shared set, with its ChordPro text.
///
/// Through an editable link, any song of the church's library.
#[utoipa::path(
    get,
    path = "/api/v1/public/sets/{share_key}/songs/{song_id}",
    params(("share_key" = String, Path), ("song_id" = Uuid, Path)),
    responses((status = 200, body = SongDetail), (status = 404, body = ErrorBody))
)]
pub async fn get_shared_set_song(
    State(state): State<AppState>,
    Path((share_key, song_id)): Path<(String, Uuid)>,
) -> Result<Json<SongDetail>, AppError> {
    let link = find_link(&state.pool, &share_key).await?;
    let readable = link.editable
        || sqlx::query_scalar::<_, bool>(
            "SELECT EXISTS (SELECT 1 FROM song_set_items WHERE set_id = $1 AND song_id = $2)",
        )
        .bind(link.id)
        .bind(song_id)
        .fetch_one(&state.pool)
        .await?;
    let song = if readable {
        fetch_song(&state.pool, Library::Church(link.church_id), song_id).await?
    } else {
        None
    };
    song.map(Json)
        .ok_or_else(|| AppError::NotFound("song was not found".into()))
}

/// Anyone with an editable link: searches the church's songs, to add one.
///
/// Searching, paging and sorting work as in `GET /songs`. A link that may
/// not edit the set is 403.
#[utoipa::path(
    get,
    path = "/api/v1/public/sets/{share_key}/songs",
    params(
        ("share_key" = String, Path),
        ("q" = Option<String>, Query),
        ("limit" = Option<i64>, Query),
        ("offset" = Option<i64>, Query),
        ("sort" = Option<crate::models::SongSort>, Query),
        ("direction" = Option<crate::models::SortDirection>, Query)
    ),
    responses(
        (status = 200, body = [SongSummary]),
        (status = 403, body = ErrorBody),
        (status = 404, body = ErrorBody)
    )
)]
pub async fn list_shared_set_songs(
    State(state): State<AppState>,
    Path(share_key): Path<String>,
    Query(query): Query<SongQuery>,
) -> Result<Json<Vec<SongSummary>>, AppError> {
    let link = find_link(&state.pool, &share_key).await?;
    if !link.editable {
        return Err(read_only_link());
    }
    Ok(Json(
        search_songs(&state.pool, Library::Church(link.church_id), query, None).await?,
    ))
}

/// Anyone with an editable link: adds a song of the church's library.
///
/// The song goes at `position`, or at the end. Returns the set as it is now.
#[utoipa::path(
    post,
    path = "/api/v1/public/sets/{share_key}/items",
    params(("share_key" = String, Path)),
    request_body = AddSharedSetItemRequest,
    responses(
        (status = 200, body = SharedSet),
        (status = 400, body = ErrorBody),
        (status = 403, body = ErrorBody),
        (status = 404, body = ErrorBody)
    )
)]
pub async fn add_shared_set_item(
    State(state): State<AppState>,
    Path(share_key): Path<String>,
    Json(request): Json<AddSharedSetItemRequest>,
) -> Result<Json<SharedSet>, AppError> {
    let mut transaction = state.pool.begin().await?;
    let link = lock_editable_link(&mut transaction, &share_key).await?;
    let song_exists = sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS (
             SELECT 1 FROM songs WHERE id = $1 AND church_id = $2 AND deleted_at IS NULL
         )",
    )
    .bind(request.song_id)
    .bind(link.church_id)
    .fetch_one(&mut *transaction)
    .await?;
    if !song_exists {
        return Err(AppError::BadRequest(
            "a set can only contain songs from this library".into(),
        ));
    }
    let mut items = read_items(&mut transaction, link.id).await?;
    if items.len() >= MAX_SET_ITEMS {
        return Err(AppError::BadRequest(format!(
            "a set can hold at most {MAX_SET_ITEMS} items"
        )));
    }
    let position = request.position.unwrap_or(items.len()).min(items.len());
    items.insert(
        position,
        SetItemInput {
            id: None,
            kind: SetItemKind::Song,
            song_id: Some(request.song_id),
            transpose: 0,
            note: String::new(),
        },
    );
    replace_items(&mut transaction, link.id, &items).await?;
    transaction.commit().await?;
    Ok(Json(fetch_shared(&state.pool, &link).await?))
}

/// Anyone with an editable link: removes a song from the set.
///
/// Only songs; a blank screen stays (403). Returns the set as it is now.
#[utoipa::path(
    delete,
    path = "/api/v1/public/sets/{share_key}/items/{item_id}",
    params(("share_key" = String, Path), ("item_id" = Uuid, Path)),
    responses(
        (status = 200, body = SharedSet),
        (status = 403, body = ErrorBody),
        (status = 404, body = ErrorBody)
    )
)]
pub async fn remove_shared_set_item(
    State(state): State<AppState>,
    Path((share_key, item_id)): Path<(String, Uuid)>,
) -> Result<Json<SharedSet>, AppError> {
    let mut transaction = state.pool.begin().await?;
    let link = lock_editable_link(&mut transaction, &share_key).await?;
    let mut items = read_items(&mut transaction, link.id).await?;
    let index = items
        .iter()
        .position(|item| item.id == Some(item_id))
        .ok_or_else(|| AppError::NotFound("set item was not found".into()))?;
    if items[index].kind != SetItemKind::Song {
        return Err(AppError::Forbidden(
            "only songs can be removed through a shared link".into(),
        ));
    }
    items.remove(index);
    replace_items(&mut transaction, link.id, &items).await?;
    transaction.commit().await?;
    Ok(Json(fetch_shared(&state.pool, &link).await?))
}

/// The set a share key opens.
#[derive(FromRow)]
pub(crate) struct Link {
    pub(crate) id: Uuid,
    church_id: Uuid,
    editable: bool,
}

/// Keys are made by `share_set` (32 lowercase hex digits). Anything else is
/// turned away before the database is asked.
fn plausible_key(key: &str) -> bool {
    (16..=64).contains(&key.len()) && key.bytes().all(|byte| byte.is_ascii_alphanumeric())
}

fn link_not_found() -> AppError {
    AppError::NotFound("this shared set was not found; the link may have been stopped".into())
}

fn read_only_link() -> AppError {
    AppError::Forbidden("this link lets you read the set, not change it".into())
}

pub(crate) async fn find_link(pool: &PgPool, key: &str) -> Result<Link, AppError> {
    if !plausible_key(key) {
        return Err(link_not_found());
    }
    sqlx::query_as::<_, Link>(
        "SELECT id, church_id, share_editable AS editable
         FROM song_sets
         WHERE share_key = $1 AND deleted_at IS NULL",
    )
    .bind(key)
    .fetch_optional(pool)
    .await?
    .ok_or_else(link_not_found)
}

/// Locks the set like a church edit does (`FOR UPDATE`), so changes through
/// the link and from the church happen one at a time.
async fn lock_editable_link(
    transaction: &mut Transaction<'_, Postgres>,
    key: &str,
) -> Result<Link, AppError> {
    if !plausible_key(key) {
        return Err(link_not_found());
    }
    let link = sqlx::query_as::<_, Link>(
        "SELECT id, church_id, share_editable AS editable
         FROM song_sets
         WHERE share_key = $1 AND deleted_at IS NULL
         FOR UPDATE",
    )
    .bind(key)
    .fetch_optional(&mut **transaction)
    .await?
    .ok_or_else(link_not_found)?;
    if !link.editable {
        return Err(read_only_link());
    }
    Ok(link)
}

#[derive(FromRow)]
struct StoredItem {
    id: Uuid,
    kind: String,
    song_id: Option<Uuid>,
    transpose: i16,
    note: String,
}

/// The set's items in order, as they would be sent back unchanged.
async fn read_items(
    transaction: &mut Transaction<'_, Postgres>,
    set_id: Uuid,
) -> Result<Vec<SetItemInput>, AppError> {
    sqlx::query_as::<_, StoredItem>(
        "SELECT id, kind, song_id, transpose, note
         FROM song_set_items WHERE set_id = $1 ORDER BY position",
    )
    .bind(set_id)
    .fetch_all(&mut **transaction)
    .await?
    .into_iter()
    .map(|item| {
        Ok(SetItemInput {
            id: Some(item.id),
            kind: SetItemKind::from_db(&item.kind)
                .ok_or_else(|| AppError::Internal("unknown set item kind in database".into()))?,
            song_id: item.song_id,
            transpose: item.transpose,
            note: item.note,
        })
    })
    .collect()
}

/// Writes the items back and raises the version, so desktops and other
/// phones pick the change up. Nobody signed in made it, so no person or
/// device is recorded.
async fn replace_items(
    transaction: &mut Transaction<'_, Postgres>,
    set_id: Uuid,
    items: &[SetItemInput],
) -> Result<(), AppError> {
    sqlx::query("DELETE FROM song_set_items WHERE set_id = $1")
        .bind(set_id)
        .execute(&mut **transaction)
        .await?;
    write_items(transaction, set_id, items).await?;
    sqlx::query(
        "UPDATE song_sets
         SET version = version + 1, updated_at = now(),
             updated_by = NULL, updated_by_device = NULL
         WHERE id = $1",
    )
    .bind(set_id)
    .execute(&mut **transaction)
    .await?;
    Ok(())
}

#[derive(FromRow)]
struct SharedRow {
    name: String,
    service_date: Option<NaiveDate>,
    version: i32,
    updated_at: DateTime<Utc>,
    church_name: String,
    editable: bool,
}

async fn fetch_shared(pool: &PgPool, link: &Link) -> Result<SharedSet, AppError> {
    let row = sqlx::query_as::<_, SharedRow>(
        "SELECT s.name, s.service_date, s.version, s.updated_at,
                c.name AS church_name, s.share_editable AS editable
         FROM song_sets s
         JOIN churches c ON c.id = s.church_id
         WHERE s.id = $1",
    )
    .bind(link.id)
    .fetch_one(pool)
    .await?;
    let items = fetch_items(pool, link.church_id, &[link.id])
        .await?
        .remove(&link.id)
        .unwrap_or_default();
    Ok(SharedSet {
        name: row.name,
        service_date: row.service_date,
        version: row.version,
        updated_at: row.updated_at,
        church_name: row.church_name,
        editable: row.editable,
        items,
    })
}
