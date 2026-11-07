//! Each person's unsaved changes to songs. The web client keeps what you
//! type here while you edit, so leaving the editor (Back, a closed tab, a
//! phone that drops the page) never loses it: open the song again to carry
//! on and save it as a new revision, or discard it. One draft per song and
//! person, and one for a new song that is not in the library yet (`new`).
//! Saving the song (`PUT /songs/{id}`) removes your draft of it.

use axum::{
    Json, Router,
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
    routing::get,
};
use sqlx::PgPool;
use uuid::Uuid;

use crate::{
    AppState,
    auth::authenticate,
    chordpro,
    error::{AppError, ErrorBody},
    models::{SaveSongDraftRequest, SongDraft, SongDraftSummary},
};

/// A draft may be as long as a song.
const MAX_DRAFT_BYTES: usize = 1_000_000;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/drafts", get(list_drafts))
        .route(
            "/drafts/new",
            get(get_new_draft)
                .put(save_new_draft)
                .delete(discard_new_draft),
        )
        .route(
            "/drafts/{song_id}",
            get(get_draft).put(save_draft).delete(discard_draft),
        )
}

/// Your drafts, newest first: songs you changed and did not save, and a new
/// song you started (`song_id` null).
#[utoipa::path(
    get,
    path = "/api/v1/drafts",
    security(("bearer" = [])),
    responses(
        (status = 200, body = Vec<SongDraftSummary>),
        (status = 401, body = ErrorBody),
        (status = 403, body = ErrorBody)
    )
)]
pub async fn list_drafts(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Vec<SongDraftSummary>>, AppError> {
    let auth = authenticate(&headers, &state).await?;
    let user_id = auth.require_editor()?;
    let drafts = sqlx::query_as::<_, SongDraftSummary>(
        "SELECT d.song_id, d.base_revision_id, d.title, d.updated_at
         FROM song_drafts d
         LEFT JOIN songs s ON s.id = d.song_id AND s.church_id = d.church_id
         WHERE d.user_id = $1 AND d.church_id = $2
           AND (d.song_id IS NULL OR s.deleted_at IS NULL)
         ORDER BY d.updated_at DESC",
    )
    .bind(user_id)
    .bind(auth.church_id)
    .fetch_all(&state.pool)
    .await?;
    Ok(Json(drafts))
}

/// Your unsaved changes to a song; 404 when there are none.
#[utoipa::path(
    get,
    path = "/api/v1/drafts/{song_id}",
    security(("bearer" = [])),
    params(("song_id" = Uuid, Path)),
    responses(
        (status = 200, body = SongDraft),
        (status = 401, body = ErrorBody),
        (status = 404, body = ErrorBody)
    )
)]
pub async fn get_draft(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(song_id): Path<Uuid>,
) -> Result<Json<SongDraft>, AppError> {
    let auth = authenticate(&headers, &state).await?;
    let user_id = auth.require_editor()?;
    find(&state.pool, user_id, auth.church_id, Some(song_id)).await
}

/// The new song you started and did not add yet; 404 when there is none.
#[utoipa::path(
    get,
    path = "/api/v1/drafts/new",
    security(("bearer" = [])),
    responses(
        (status = 200, body = SongDraft),
        (status = 401, body = ErrorBody),
        (status = 404, body = ErrorBody)
    )
)]
pub async fn get_new_draft(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<SongDraft>, AppError> {
    let auth = authenticate(&headers, &state).await?;
    let user_id = auth.require_editor()?;
    find(&state.pool, user_id, auth.church_id, None).await
}

/// Keeps your changes to a song (again replaces them). `base_revision_id`
/// is the revision you are changing.
#[utoipa::path(
    put,
    path = "/api/v1/drafts/{song_id}",
    security(("bearer" = [])),
    params(("song_id" = Uuid, Path)),
    request_body = SaveSongDraftRequest,
    responses(
        (status = 204, description = "Kept"),
        (status = 400, body = ErrorBody),
        (status = 401, body = ErrorBody),
        (status = 404, body = ErrorBody)
    )
)]
pub async fn save_draft(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(song_id): Path<Uuid>,
    Json(body): Json<SaveSongDraftRequest>,
) -> Result<StatusCode, AppError> {
    let auth = authenticate(&headers, &state).await?;
    let user_id = auth.require_editor()?;
    let Some(base) = body.base_revision_id else {
        return Err(AppError::BadRequest(
            "base_revision_id is required for a song in the library".into(),
        ));
    };
    check_size(&body.chordpro)?;
    let saved = sqlx::query(
        "INSERT INTO song_drafts (user_id, church_id, song_id, base_revision_id, title, chordpro)
         SELECT $1, s.church_id, s.id, $4, $5, $6 FROM songs s
         WHERE s.id = $3 AND s.church_id = $2 AND s.deleted_at IS NULL
         ON CONFLICT ON CONSTRAINT song_drafts_one_per_song DO UPDATE
         SET base_revision_id = EXCLUDED.base_revision_id, title = EXCLUDED.title,
             chordpro = EXCLUDED.chordpro, updated_at = now()",
    )
    .bind(user_id)
    .bind(auth.church_id)
    .bind(song_id)
    .bind(base)
    .bind(chordpro::metadata(&body.chordpro).title)
    .bind(&body.chordpro)
    .execute(&state.pool)
    .await?;
    if saved.rows_affected() == 0 {
        return Err(AppError::NotFound("song was not found".into()));
    }
    Ok(StatusCode::NO_CONTENT)
}

/// Keeps the new song you are writing (again replaces it).
#[utoipa::path(
    put,
    path = "/api/v1/drafts/new",
    security(("bearer" = [])),
    request_body = SaveSongDraftRequest,
    responses(
        (status = 204, description = "Kept"),
        (status = 400, body = ErrorBody),
        (status = 401, body = ErrorBody)
    )
)]
pub async fn save_new_draft(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<SaveSongDraftRequest>,
) -> Result<StatusCode, AppError> {
    let auth = authenticate(&headers, &state).await?;
    let user_id = auth.require_editor()?;
    check_size(&body.chordpro)?;
    sqlx::query(
        "INSERT INTO song_drafts (user_id, church_id, song_id, base_revision_id, title, chordpro)
         VALUES ($1, $2, NULL, NULL, $3, $4)
         ON CONFLICT ON CONSTRAINT song_drafts_one_per_song DO UPDATE
         SET title = EXCLUDED.title, chordpro = EXCLUDED.chordpro, updated_at = now()",
    )
    .bind(user_id)
    .bind(auth.church_id)
    .bind(chordpro::metadata(&body.chordpro).title)
    .bind(&body.chordpro)
    .execute(&state.pool)
    .await?;
    Ok(StatusCode::NO_CONTENT)
}

/// Discards your changes to a song (also when there were none).
#[utoipa::path(
    delete,
    path = "/api/v1/drafts/{song_id}",
    security(("bearer" = [])),
    params(("song_id" = Uuid, Path)),
    responses((status = 204, description = "No draft"), (status = 401, body = ErrorBody))
)]
pub async fn discard_draft(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(song_id): Path<Uuid>,
) -> Result<StatusCode, AppError> {
    let auth = authenticate(&headers, &state).await?;
    let user_id = auth.require_editor()?;
    sqlx::query("DELETE FROM song_drafts WHERE user_id = $1 AND church_id = $2 AND song_id = $3")
        .bind(user_id)
        .bind(auth.church_id)
        .bind(song_id)
        .execute(&state.pool)
        .await?;
    Ok(StatusCode::NO_CONTENT)
}

/// Discards the new song you started (also when there was none).
#[utoipa::path(
    delete,
    path = "/api/v1/drafts/new",
    security(("bearer" = [])),
    responses((status = 204, description = "No draft"), (status = 401, body = ErrorBody))
)]
pub async fn discard_new_draft(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<StatusCode, AppError> {
    let auth = authenticate(&headers, &state).await?;
    let user_id = auth.require_editor()?;
    sqlx::query(
        "DELETE FROM song_drafts WHERE user_id = $1 AND church_id = $2 AND song_id IS NULL",
    )
    .bind(user_id)
    .bind(auth.church_id)
    .execute(&state.pool)
    .await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn find(
    pool: &PgPool,
    user_id: Uuid,
    church_id: Uuid,
    song_id: Option<Uuid>,
) -> Result<Json<SongDraft>, AppError> {
    sqlx::query_as::<_, SongDraft>(
        "SELECT d.song_id, d.base_revision_id, d.title, d.chordpro, d.updated_at
         FROM song_drafts d
         LEFT JOIN songs s ON s.id = d.song_id AND s.church_id = d.church_id
         WHERE d.user_id = $1 AND d.church_id = $2
           AND d.song_id IS NOT DISTINCT FROM $3
           AND (d.song_id IS NULL OR s.deleted_at IS NULL)",
    )
    .bind(user_id)
    .bind(church_id)
    .bind(song_id)
    .fetch_optional(pool)
    .await?
    .map(Json)
    .ok_or_else(|| AppError::NotFound("no draft".into()))
}

fn check_size(source: &str) -> Result<(), AppError> {
    if source.len() > MAX_DRAFT_BYTES {
        return Err(AppError::BadRequest(
            "a draft cannot exceed 1 MB of ChordPro source".into(),
        ));
    }
    Ok(())
}
