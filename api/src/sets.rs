//! Sets: ordered song lists for a service, shared by the whole church.
//!
//! Anyone signed in to the church (including viewers and desktops) reads
//! sets; leaders, owners and desktop tokens change them. Every change is
//! based on the `version` the caller last saw, so two people editing the same
//! set never overwrite each other silently: the second one gets a 409.

use std::collections::{HashMap, HashSet};

use axum::{
    Json, Router,
    extract::{Path, Query, State},
    http::{HeaderMap, StatusCode},
    response::IntoResponse,
    routing::get,
};
use chrono::{DateTime, NaiveDate, Utc};
use sqlx::{FromRow, PgPool, Postgres, Transaction};
use uuid::Uuid;

use crate::{
    AppState,
    auth::{Actor, authenticate},
    error::{AppError, ErrorBody},
    models::{
        CreateSetRequest, DeleteSetQuery, SetDetail, SetItem, SetItemInput, SetItemKind, SetQuery,
        SetSongRef, SetSummary, UpdateSetRequest,
    },
};

/// Most items one set may hold.
pub const MAX_SET_ITEMS: usize = 200;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/sets", get(list_sets).post(create_set))
        .route("/sets/snapshot", get(sets_snapshot))
        .route(
            "/sets/{set_id}",
            get(get_set).put(update_set).delete(delete_set),
        )
}

#[utoipa::path(
    get,
    path = "/api/v1/sets",
    params(SetQuery),
    responses((status = 200, body = [SetSummary]), (status = 401, body = ErrorBody))
)]
pub async fn list_sets(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<SetQuery>,
) -> Result<Json<Vec<SetSummary>>, AppError> {
    let auth = authenticate(&headers, &state).await?;
    let limit = query.limit.unwrap_or(100).clamp(1, 500);
    let sets = sqlx::query_as::<_, SetSummary>(
        "SELECT s.id, s.name, s.service_date, s.version, s.updated_at,
                (SELECT count(*) FROM song_set_items i WHERE i.set_id = s.id) AS item_count
         FROM song_sets s
         WHERE s.church_id = $1 AND s.deleted_at IS NULL
           AND ($2::date IS NULL OR s.service_date IS NULL OR s.service_date >= $2)
         ORDER BY s.service_date DESC NULLS LAST, s.updated_at DESC
         LIMIT $3",
    )
    .bind(auth.church_id)
    .bind(query.from)
    .bind(limit)
    .fetch_all(&state.pool)
    .await?;
    Ok(Json(sets))
}

/// Every set of the church with its items: what a desktop keeps offline.
#[utoipa::path(
    get,
    path = "/api/v1/sets/snapshot",
    responses((status = 200, body = [SetDetail]), (status = 401, body = ErrorBody))
)]
pub async fn sets_snapshot(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Vec<SetDetail>>, AppError> {
    let auth = authenticate(&headers, &state).await?;
    let rows = sqlx::query_as::<_, SetRow>(
        "SELECT id, name, service_date, version, updated_at
         FROM song_sets
         WHERE church_id = $1 AND deleted_at IS NULL
         ORDER BY service_date DESC NULLS LAST, updated_at DESC",
    )
    .bind(auth.church_id)
    .fetch_all(&state.pool)
    .await?;
    let ids = rows.iter().map(|row| row.id).collect::<Vec<_>>();
    let mut items = fetch_items(&state.pool, auth.church_id, &ids).await?;
    Ok(Json(
        rows.into_iter()
            .map(|row| {
                let set_items = items.remove(&row.id).unwrap_or_default();
                row.into_detail(set_items)
            })
            .collect(),
    ))
}

#[utoipa::path(
    post,
    path = "/api/v1/sets",
    request_body = CreateSetRequest,
    responses(
        (status = 201, body = SetDetail),
        (status = 400, body = ErrorBody),
        (status = 403, body = ErrorBody),
        (status = 409, body = ErrorBody)
    )
)]
pub async fn create_set(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(request): Json<CreateSetRequest>,
) -> Result<impl IntoResponse, AppError> {
    let auth = authenticate(&headers, &state).await?;
    let actor = auth.require_song_editor()?;
    let name = validate_name(&request.name)?;
    let set_id = request.id.unwrap_or_else(Uuid::new_v4);

    let mut transaction = state.pool.begin().await?;
    validate_items(&mut transaction, auth.church_id, &request.items).await?;
    let inserted = sqlx::query(
        "INSERT INTO song_sets
         (id, church_id, name, service_date, created_by, created_by_device,
          updated_by, updated_by_device)
         VALUES ($1, $2, $3, $4, $5, $6, $5, $6)
         ON CONFLICT (id) DO NOTHING",
    )
    .bind(set_id)
    .bind(auth.church_id)
    .bind(name)
    .bind(request.service_date)
    .bind(actor.user_id)
    .bind(actor.device_id)
    .execute(&mut *transaction)
    .await?;
    if inserted.rows_affected() == 0 {
        return Err(AppError::Conflict(
            "a set with this id already exists".into(),
        ));
    }
    write_items(&mut transaction, set_id, &request.items).await?;
    transaction.commit().await?;

    let set = fetch_set(&state.pool, auth.church_id, set_id)
        .await?
        .ok_or_else(|| AppError::Internal("created set disappeared".into()))?;
    Ok((StatusCode::CREATED, Json(set)))
}

#[utoipa::path(
    get,
    path = "/api/v1/sets/{set_id}",
    params(("set_id" = Uuid, Path)),
    responses((status = 200, body = SetDetail), (status = 404, body = ErrorBody))
)]
pub async fn get_set(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(set_id): Path<Uuid>,
) -> Result<Json<SetDetail>, AppError> {
    let auth = authenticate(&headers, &state).await?;
    fetch_set(&state.pool, auth.church_id, set_id)
        .await?
        .map(Json)
        .ok_or_else(set_not_found)
}

#[utoipa::path(
    put,
    path = "/api/v1/sets/{set_id}",
    params(("set_id" = Uuid, Path)),
    request_body = UpdateSetRequest,
    responses(
        (status = 200, body = SetDetail),
        (status = 400, body = ErrorBody),
        (status = 404, body = ErrorBody),
        (status = 409, body = ErrorBody)
    )
)]
pub async fn update_set(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(set_id): Path<Uuid>,
    Json(request): Json<UpdateSetRequest>,
) -> Result<Json<SetDetail>, AppError> {
    let auth = authenticate(&headers, &state).await?;
    let actor = auth.require_song_editor()?;
    let name = validate_name(&request.name)?;

    let mut transaction = state.pool.begin().await?;
    let version = lock_set(&mut transaction, auth.church_id, set_id).await?;
    if version != request.base_version {
        return Err(stale(request.base_version, version));
    }
    validate_items(&mut transaction, auth.church_id, &request.items).await?;
    update_row(&mut transaction, set_id, name, request.service_date, actor).await?;
    sqlx::query("DELETE FROM song_set_items WHERE set_id = $1")
        .bind(set_id)
        .execute(&mut *transaction)
        .await?;
    write_items(&mut transaction, set_id, &request.items).await?;
    transaction.commit().await?;

    fetch_set(&state.pool, auth.church_id, set_id)
        .await?
        .map(Json)
        .ok_or_else(set_not_found)
}

#[utoipa::path(
    delete,
    path = "/api/v1/sets/{set_id}",
    params(("set_id" = Uuid, Path), DeleteSetQuery),
    responses(
        (status = 204),
        (status = 404, body = ErrorBody),
        (status = 409, body = ErrorBody)
    )
)]
pub async fn delete_set(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(set_id): Path<Uuid>,
    Query(query): Query<DeleteSetQuery>,
) -> Result<StatusCode, AppError> {
    let auth = authenticate(&headers, &state).await?;
    let actor = auth.require_song_editor()?;
    let mut transaction = state.pool.begin().await?;
    let version = lock_set(&mut transaction, auth.church_id, set_id).await?;
    if let Some(base) = query.base_version
        && base != version
    {
        return Err(stale(base, version));
    }
    sqlx::query(
        "UPDATE song_sets
         SET deleted_at = now(), updated_at = now(), version = version + 1,
             updated_by = $2, updated_by_device = $3
         WHERE id = $1",
    )
    .bind(set_id)
    .bind(actor.user_id)
    .bind(actor.device_id)
    .execute(&mut *transaction)
    .await?;
    transaction.commit().await?;
    Ok(StatusCode::NO_CONTENT)
}

fn validate_name(name: &str) -> Result<&str, AppError> {
    let name = name.trim();
    if name.is_empty() || name.chars().count() > 200 {
        return Err(AppError::BadRequest(
            "set name must contain 1 to 200 characters".into(),
        ));
    }
    Ok(name)
}

/// Checks shape and limits, and that every song belongs to the church.
async fn validate_items(
    transaction: &mut Transaction<'_, Postgres>,
    church_id: Uuid,
    items: &[SetItemInput],
) -> Result<(), AppError> {
    if items.len() > MAX_SET_ITEMS {
        return Err(AppError::BadRequest(format!(
            "a set can hold at most {MAX_SET_ITEMS} items"
        )));
    }
    let mut ids = HashSet::new();
    let mut song_ids = HashSet::new();
    for item in items {
        if let Some(id) = item.id
            && !ids.insert(id)
        {
            return Err(AppError::BadRequest("set item ids must be unique".into()));
        }
        if !(-11..=11).contains(&item.transpose) {
            return Err(AppError::BadRequest(
                "transpose must be between -11 and 11".into(),
            ));
        }
        if item.note.chars().count() > 500 {
            return Err(AppError::BadRequest(
                "an item note can hold at most 500 characters".into(),
            ));
        }
        match (item.kind, item.song_id) {
            (SetItemKind::Song, Some(song_id)) => {
                song_ids.insert(song_id);
            }
            (SetItemKind::Song, None) => {
                return Err(AppError::BadRequest("a song item needs a song_id".into()));
            }
            (SetItemKind::Blank, Some(_)) => {
                return Err(AppError::BadRequest(
                    "a blank item cannot have a song_id".into(),
                ));
            }
            (SetItemKind::Blank, None) => {}
        }
    }
    if song_ids.is_empty() {
        return Ok(());
    }
    let wanted = song_ids.into_iter().collect::<Vec<_>>();
    let found = sqlx::query_scalar::<_, i64>(
        "SELECT count(*) FROM songs
         WHERE church_id = $1 AND deleted_at IS NULL AND id = ANY($2)",
    )
    .bind(church_id)
    .bind(&wanted)
    .fetch_one(&mut **transaction)
    .await?;
    if found != wanted.len() as i64 {
        return Err(AppError::BadRequest(
            "a set can only contain songs from this library".into(),
        ));
    }
    Ok(())
}

async fn write_items(
    transaction: &mut Transaction<'_, Postgres>,
    set_id: Uuid,
    items: &[SetItemInput],
) -> Result<(), AppError> {
    for (position, item) in items.iter().enumerate() {
        sqlx::query(
            "INSERT INTO song_set_items (id, set_id, position, kind, song_id, transpose, note)
             VALUES ($1, $2, $3, $4, $5, $6, $7)",
        )
        .bind(item.id.unwrap_or_else(Uuid::new_v4))
        .bind(set_id)
        .bind(position as i32)
        .bind(item.kind.as_db())
        .bind(item.song_id)
        .bind(item.transpose)
        .bind(item.note.trim())
        .execute(&mut **transaction)
        .await
        .map_err(|error| match &error {
            // Another set already uses this item id.
            sqlx::Error::Database(database) if database.is_unique_violation() => {
                AppError::BadRequest("set item ids must be unique".into())
            }
            _ => AppError::Database(error),
        })?;
    }
    Ok(())
}

async fn update_row(
    transaction: &mut Transaction<'_, Postgres>,
    set_id: Uuid,
    name: &str,
    service_date: Option<NaiveDate>,
    actor: Actor,
) -> Result<(), AppError> {
    sqlx::query(
        "UPDATE song_sets
         SET name = $2, service_date = $3, version = version + 1, updated_at = now(),
             updated_by = $4, updated_by_device = $5
         WHERE id = $1",
    )
    .bind(set_id)
    .bind(name)
    .bind(service_date)
    .bind(actor.user_id)
    .bind(actor.device_id)
    .execute(&mut **transaction)
    .await?;
    Ok(())
}

async fn lock_set(
    transaction: &mut Transaction<'_, Postgres>,
    church_id: Uuid,
    set_id: Uuid,
) -> Result<i32, AppError> {
    sqlx::query_scalar::<_, i32>(
        "SELECT version FROM song_sets
         WHERE id = $1 AND church_id = $2 AND deleted_at IS NULL FOR UPDATE",
    )
    .bind(set_id)
    .bind(church_id)
    .fetch_optional(&mut **transaction)
    .await?
    .ok_or_else(set_not_found)
}

fn stale(base: i32, current: i32) -> AppError {
    AppError::Conflict(format!(
        "set changed since version {base}; current version is {current}"
    ))
}

fn set_not_found() -> AppError {
    AppError::NotFound("set was not found".into())
}

#[derive(FromRow)]
struct SetRow {
    id: Uuid,
    name: String,
    service_date: Option<NaiveDate>,
    version: i32,
    updated_at: DateTime<Utc>,
}

impl SetRow {
    fn into_detail(self, items: Vec<SetItem>) -> SetDetail {
        SetDetail {
            id: self.id,
            name: self.name,
            service_date: self.service_date,
            version: self.version,
            updated_at: self.updated_at,
            items,
        }
    }
}

#[derive(FromRow)]
struct ItemRow {
    set_id: Uuid,
    id: Uuid,
    kind: String,
    song_id: Option<Uuid>,
    transpose: i16,
    note: String,
    revision_id: Option<Uuid>,
    title: Option<String>,
    song_number: Option<String>,
    authors: Option<String>,
}

pub async fn fetch_set(
    pool: &PgPool,
    church_id: Uuid,
    set_id: Uuid,
) -> Result<Option<SetDetail>, AppError> {
    let Some(row) = sqlx::query_as::<_, SetRow>(
        "SELECT id, name, service_date, version, updated_at
         FROM song_sets
         WHERE id = $1 AND church_id = $2 AND deleted_at IS NULL",
    )
    .bind(set_id)
    .bind(church_id)
    .fetch_optional(pool)
    .await?
    else {
        return Ok(None);
    };
    let items = fetch_items(pool, church_id, &[set_id])
        .await?
        .remove(&set_id)
        .unwrap_or_default();
    Ok(Some(row.into_detail(items)))
}

/// Items of the given sets in order, keyed by set, with their songs'
/// current revisions. Deleted songs appear without `song`.
async fn fetch_items(
    pool: &PgPool,
    church_id: Uuid,
    set_ids: &[Uuid],
) -> Result<HashMap<Uuid, Vec<SetItem>>, AppError> {
    let rows = sqlx::query_as::<_, ItemRow>(
        "SELECT i.set_id, i.id, i.kind, i.song_id, i.transpose, i.note,
                r.id AS revision_id, r.title, r.song_number, r.authors
         FROM song_set_items i
         LEFT JOIN songs s
           ON s.id = i.song_id AND s.church_id = $1 AND s.deleted_at IS NULL
         LEFT JOIN song_revisions r ON r.id = s.current_revision_id
         WHERE i.set_id = ANY($2)
         ORDER BY i.set_id, i.position",
    )
    .bind(church_id)
    .bind(set_ids)
    .fetch_all(pool)
    .await?;

    let mut items: HashMap<Uuid, Vec<SetItem>> = HashMap::new();
    for row in rows {
        let kind = SetItemKind::from_db(&row.kind)
            .ok_or_else(|| AppError::Internal("unknown set item kind in database".into()))?;
        let song = match (row.revision_id, row.title) {
            (Some(revision_id), Some(title)) => Some(SetSongRef {
                revision_id,
                title,
                song_number: row.song_number,
                authors: row.authors.unwrap_or_default(),
            }),
            _ => None,
        };
        items.entry(row.set_id).or_default().push(SetItem {
            id: row.id,
            kind,
            song_id: row.song_id,
            transpose: row.transpose,
            note: row.note,
            song,
        });
    }
    Ok(items)
}
