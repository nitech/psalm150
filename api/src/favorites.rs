//! Each person's favourite songs in the church. Anyone signed in keeps their
//! own; a desktop reads and changes those of the person who connected it, so
//! the star in the desktop app and in the web client is the same one.

use axum::{
    Json, Router,
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
    routing::put,
};
use sqlx::PgPool;
use uuid::Uuid;

use crate::{
    AppState,
    auth::{AuthContext, authenticate},
    error::{AppError, ErrorBody},
    models::FavoriteSongs,
};

/// The most favourites one list may set at once.
const MAX_FAVORITES: usize = 5000;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/favorites", put(replace_favorites).get(list_favorites))
        .route(
            "/favorites/{song_id}",
            put(add_favorite).delete(remove_favorite),
        )
}

/// Whose favourites: the person, or for a desktop the person who connected it.
pub(crate) async fn favorites_owner(pool: &PgPool, auth: &AuthContext) -> Result<Uuid, AppError> {
    if !auth.is_device()
        && let Some(user_id) = auth.user_id
    {
        return Ok(user_id);
    }
    let Some(device_id) = auth.device_id else {
        return Err(AppError::Forbidden(
            "a person or a desktop is required".into(),
        ));
    };
    sqlx::query_scalar::<_, Uuid>(
        "SELECT created_by FROM device_tokens WHERE id = $1 AND church_id = $2",
    )
    .bind(device_id)
    .bind(auth.church_id)
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| AppError::Forbidden("this desktop has no person".into()))
}

async fn current(pool: &PgPool, user_id: Uuid, church_id: Uuid) -> Result<FavoriteSongs, AppError> {
    let song_ids = sqlx::query_scalar::<_, Uuid>(
        "SELECT f.song_id
         FROM song_favorites f
         JOIN songs s ON s.id = f.song_id AND s.church_id = f.church_id
         WHERE f.user_id = $1 AND f.church_id = $2 AND s.deleted_at IS NULL
         ORDER BY f.created_at, f.song_id",
    )
    .bind(user_id)
    .bind(church_id)
    .fetch_all(pool)
    .await?;
    Ok(FavoriteSongs { song_ids })
}

/// Your favourite songs (a desktop: its person's), oldest first.
#[utoipa::path(
    get,
    path = "/api/v1/favorites",
    security(("bearer" = [])),
    responses((status = 200, body = FavoriteSongs), (status = 401, body = ErrorBody))
)]
pub async fn list_favorites(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<FavoriteSongs>, AppError> {
    let auth = authenticate(&headers, &state).await?;
    let owner = favorites_owner(&state.pool, &auth).await?;
    Ok(Json(current(&state.pool, owner, auth.church_id).await?))
}

/// Sets all your favourite songs at once. Songs that are not in the church
/// (or are deleted) are left out; the answer is the list as it is now.
#[utoipa::path(
    put,
    path = "/api/v1/favorites",
    security(("bearer" = [])),
    request_body = FavoriteSongs,
    responses(
        (status = 200, body = FavoriteSongs),
        (status = 400, body = ErrorBody),
        (status = 401, body = ErrorBody)
    )
)]
pub async fn replace_favorites(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<FavoriteSongs>,
) -> Result<Json<FavoriteSongs>, AppError> {
    let auth = authenticate(&headers, &state).await?;
    let owner = favorites_owner(&state.pool, &auth).await?;
    if body.song_ids.len() > MAX_FAVORITES {
        return Err(AppError::BadRequest(format!(
            "at most {MAX_FAVORITES} favourites"
        )));
    }
    let mut tx = state.pool.begin().await?;
    sqlx::query("DELETE FROM song_favorites WHERE user_id = $1 AND church_id = $2")
        .bind(owner)
        .bind(auth.church_id)
        .execute(&mut *tx)
        .await?;
    // In the order given, so the list keeps it.
    sqlx::query(
        "INSERT INTO song_favorites (user_id, church_id, song_id, created_at)
         SELECT $1, s.church_id, s.id, now() + make_interval(secs => given.n / 1000000.0)
         FROM unnest($3::uuid[]) WITH ORDINALITY AS given(id, n)
         JOIN songs s ON s.id = given.id AND s.church_id = $2 AND s.deleted_at IS NULL
         ON CONFLICT DO NOTHING",
    )
    .bind(owner)
    .bind(auth.church_id)
    .bind(&body.song_ids)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(Json(current(&state.pool, owner, auth.church_id).await?))
}

/// Marks a song as one of your favourites (again is fine).
#[utoipa::path(
    put,
    path = "/api/v1/favorites/{song_id}",
    security(("bearer" = [])),
    params(("song_id" = Uuid, Path)),
    responses(
        (status = 204, description = "A favourite"),
        (status = 401, body = ErrorBody),
        (status = 404, body = ErrorBody)
    )
)]
pub async fn add_favorite(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(song_id): Path<Uuid>,
) -> Result<StatusCode, AppError> {
    let auth = authenticate(&headers, &state).await?;
    let owner = favorites_owner(&state.pool, &auth).await?;
    let added = sqlx::query(
        "INSERT INTO song_favorites (user_id, church_id, song_id)
         SELECT $1, s.church_id, s.id FROM songs s
         WHERE s.id = $3 AND s.church_id = $2 AND s.deleted_at IS NULL
         ON CONFLICT DO NOTHING",
    )
    .bind(owner)
    .bind(auth.church_id)
    .bind(song_id)
    .execute(&state.pool)
    .await?;
    if added.rows_affected() == 0 {
        let exists = sqlx::query_scalar::<_, bool>(
            "SELECT EXISTS (SELECT 1 FROM songs WHERE id = $1 AND church_id = $2 AND deleted_at IS NULL)",
        )
        .bind(song_id)
        .bind(auth.church_id)
        .fetch_one(&state.pool)
        .await?;
        if !exists {
            return Err(AppError::NotFound("song was not found".into()));
        }
    }
    Ok(StatusCode::NO_CONTENT)
}

/// No longer one of your favourites (also when it was not one).
#[utoipa::path(
    delete,
    path = "/api/v1/favorites/{song_id}",
    security(("bearer" = [])),
    params(("song_id" = Uuid, Path)),
    responses((status = 204, description = "Not a favourite"), (status = 401, body = ErrorBody))
)]
pub async fn remove_favorite(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(song_id): Path<Uuid>,
) -> Result<StatusCode, AppError> {
    let auth = authenticate(&headers, &state).await?;
    let owner = favorites_owner(&state.pool, &auth).await?;
    sqlx::query(
        "DELETE FROM song_favorites WHERE user_id = $1 AND church_id = $2 AND song_id = $3",
    )
    .bind(owner)
    .bind(auth.church_id)
    .bind(song_id)
    .execute(&state.pool)
    .await?;
    Ok(StatusCode::NO_CONTENT)
}
