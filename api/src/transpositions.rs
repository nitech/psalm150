//! Each person's own key for a song: how many semitones they move it when
//! they read it, so it opens in that key on every phone and computer they
//! sign in on. Anyone signed in keeps their own; a desktop reads and changes
//! those of the person who connected it, as with favourites.

use axum::{
    Json, Router,
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
    routing::{get, put},
};
use uuid::Uuid;

use crate::{
    AppState,
    auth::authenticate,
    error::{AppError, ErrorBody},
    favorites::favorites_owner,
    models::{SongTransposition, SongTranspositions, TranspositionRequest},
};

/// The furthest a song moves either way; 12 is the same key again.
const MAX_SEMITONES: i16 = 11;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/transpositions", get(list_transpositions))
        .route("/transpositions/{song_id}", put(set_transposition))
}

/// The songs you read transposed (a desktop: its person's), and how far.
#[utoipa::path(
    get,
    path = "/api/v1/transpositions",
    security(("bearer" = [])),
    responses((status = 200, body = SongTranspositions), (status = 401, body = ErrorBody))
)]
pub async fn list_transpositions(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<SongTranspositions>, AppError> {
    let auth = authenticate(&headers, &state).await?;
    let owner = favorites_owner(&state.pool, &auth).await?;
    let transpositions = sqlx::query_as::<_, SongTransposition>(
        "SELECT t.song_id, t.semitones
         FROM song_transpositions t
         JOIN songs s ON s.id = t.song_id AND s.church_id = t.church_id
         WHERE t.user_id = $1 AND t.church_id = $2 AND s.deleted_at IS NULL
         ORDER BY t.song_id",
    )
    .bind(owner)
    .bind(auth.church_id)
    .fetch_all(&state.pool)
    .await?;
    Ok(Json(SongTranspositions { transpositions }))
}

/// Reads a song this many semitones up (positive) or down from now on;
/// 0 reads it as written again.
#[utoipa::path(
    put,
    path = "/api/v1/transpositions/{song_id}",
    security(("bearer" = [])),
    params(("song_id" = Uuid, Path)),
    request_body = TranspositionRequest,
    responses(
        (status = 204, description = "Remembered"),
        (status = 400, body = ErrorBody),
        (status = 401, body = ErrorBody),
        (status = 404, body = ErrorBody)
    )
)]
pub async fn set_transposition(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(song_id): Path<Uuid>,
    Json(body): Json<TranspositionRequest>,
) -> Result<StatusCode, AppError> {
    let auth = authenticate(&headers, &state).await?;
    let owner = favorites_owner(&state.pool, &auth).await?;
    if !(-MAX_SEMITONES..=MAX_SEMITONES).contains(&body.semitones) {
        return Err(AppError::BadRequest(format!(
            "semitones must be between -{MAX_SEMITONES} and {MAX_SEMITONES}"
        )));
    }
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
    if body.semitones == 0 {
        sqlx::query(
            "DELETE FROM song_transpositions WHERE user_id = $1 AND church_id = $2 AND song_id = $3",
        )
        .bind(owner)
        .bind(auth.church_id)
        .bind(song_id)
        .execute(&state.pool)
        .await?;
    } else {
        sqlx::query(
            "INSERT INTO song_transpositions (user_id, church_id, song_id, semitones)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (user_id, song_id)
             DO UPDATE SET semitones = EXCLUDED.semitones, updated_at = now()",
        )
        .bind(owner)
        .bind(auth.church_id)
        .bind(song_id)
        .bind(body.semitones)
        .execute(&state.pool)
        .await?;
    }
    Ok(StatusCode::NO_CONTENT)
}
