//! Recordings of a song: how it is played, for whoever leads or plays it
//! next. (A YouTube video of it is song metadata, `{meta: youtube …}`.)
//!
//! Anyone signed in to the church (desktops too) lists and plays them;
//! leaders and owners record and remove them. A recording is the audio as
//! the browser made it, kept as a file under the media directory
//! (`PSA150_MEDIA_DIR`) with its details in PostgreSQL.
//!
//! An `<audio>` element cannot send a bearer token, so a client asks for a
//! play link (`POST …/recordings/{id}/link`): a token-free URL to that one
//! recording that lasts six hours, kept in memory like the remote relay.
//! Both ways of reading the audio answer `Range` requests, so a player can
//! start at once and seek without reading the whole file.

use std::{
    collections::HashMap,
    path::{Path as FilePath, PathBuf},
    sync::Mutex,
    time::{Duration, Instant},
};

use axum::{
    Json, Router,
    body::Body,
    extract::{Path, Query, Request, State},
    http::{HeaderMap, HeaderValue, StatusCode, header},
    response::{IntoResponse, Response},
    routing::{delete, get, post},
};
use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use chrono::Utc;
use futures_util::StreamExt;
use sha2::{Digest, Sha256};
use sqlx::PgPool;
use tokio::io::AsyncWriteExt;
use tower::ServiceExt;
use tower_http::services::ServeFile;
use uuid::Uuid;

use crate::{
    AppState,
    auth::authenticate,
    error::{AppError, ErrorBody},
    models::{RecordingLink, RecordingQuery, SongRecording},
};

/// Largest recording accepted: about 40 minutes at the bitrates phones record.
pub const MAX_RECORDING_BYTES: usize = 40 * 1024 * 1024;
/// Most recordings one song may have.
pub const MAX_PER_SONG: i64 = 20;
const MAX_TITLE_CHARS: usize = 120;
/// How long a play link works.
const LINK_LIFETIME: Duration = Duration::from_secs(6 * 60 * 60);

/// Where recordings are kept, and the play links handed out.
pub struct MediaStore {
    dir: PathBuf,
    /// Play links by the SHA-256 of their key: which recording, until when.
    links: Mutex<HashMap<String, (Uuid, Instant)>>,
}

impl MediaStore {
    pub fn new(dir: PathBuf) -> Self {
        Self {
            dir,
            links: Mutex::default(),
        }
    }

    /// `{dir}/recordings/{church_id}/{recording_id}`.
    fn recording_path(&self, church_id: Uuid, recording_id: Uuid) -> PathBuf {
        self.dir
            .join("recordings")
            .join(church_id.to_string())
            .join(recording_id.to_string())
    }

    fn make_link(&self, recording_id: Uuid) -> String {
        let mut bytes = Uuid::new_v4().into_bytes().to_vec();
        bytes.extend(Uuid::new_v4().into_bytes());
        let key = URL_SAFE_NO_PAD.encode(bytes);
        let mut links = self.links.lock().unwrap_or_else(|e| e.into_inner());
        links.retain(|_, (_, until)| *until > Instant::now());
        links.insert(hash(&key), (recording_id, Instant::now() + LINK_LIFETIME));
        key
    }

    fn follow_link(&self, key: &str) -> Option<Uuid> {
        let links = self.links.lock().unwrap_or_else(|e| e.into_inner());
        links
            .get(&hash(key))
            .filter(|(_, until)| *until > Instant::now())
            .map(|(recording_id, _)| *recording_id)
    }
}

fn hash(key: &str) -> String {
    hex::encode(Sha256::digest(key.as_bytes()))
}

/// At startup: makes the media directory, removes uploads a stop cut short,
/// and moves recordings saved in the database (before recordings went to
/// disk) out to files. Returns how many it moved.
pub async fn prepare_media(pool: &PgPool, media: &MediaStore) -> Result<u64, String> {
    let recordings = media.dir.join("recordings");
    tokio::fs::create_dir_all(&recordings)
        .await
        .map_err(|error| {
            format!(
                "media directory {} is not writable: {error}",
                media.dir.display()
            )
        })?;
    if let Ok(mut churches) = tokio::fs::read_dir(&recordings).await {
        while let Ok(Some(church)) = churches.next_entry().await {
            let Ok(mut files) = tokio::fs::read_dir(church.path()).await else {
                continue;
            };
            while let Ok(Some(file)) = files.next_entry().await {
                if file.path().extension().is_some_and(|ext| ext == "part") {
                    let _ = tokio::fs::remove_file(file.path()).await;
                }
            }
        }
    }

    let waiting = sqlx::query_as::<_, (Uuid, Uuid)>(
        "SELECT id, church_id FROM song_recordings WHERE audio IS NOT NULL",
    )
    .fetch_all(pool)
    .await
    .map_err(|error| error.to_string())?;
    let mut moved = 0;
    // One at a time: each may be tens of megabytes.
    for (id, church_id) in waiting {
        let audio =
            sqlx::query_scalar::<_, Vec<u8>>("SELECT audio FROM song_recordings WHERE id = $1")
                .bind(id)
                .fetch_one(pool)
                .await
                .map_err(|error| error.to_string())?;
        let path = media.recording_path(church_id, id);
        write_whole(&path, &audio)
            .await
            .map_err(|error| format!("could not write {}: {error}", path.display()))?;
        sqlx::query("UPDATE song_recordings SET audio = NULL WHERE id = $1")
            .bind(id)
            .execute(pool)
            .await
            .map_err(|error| error.to_string())?;
        moved += 1;
    }
    Ok(moved)
}

/// Writes beside `path` and renames, so a file is never seen half written.
async fn write_whole(path: &FilePath, bytes: &[u8]) -> std::io::Result<()> {
    if let Some(parent) = path.parent() {
        tokio::fs::create_dir_all(parent).await?;
    }
    let part = path.with_extension("part");
    tokio::fs::write(&part, bytes).await?;
    tokio::fs::rename(&part, path).await
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route(
            "/songs/{song_id}/recordings",
            get(list_recordings).post(add_recording),
        )
        .route(
            "/songs/{song_id}/recordings/{recording_id}",
            delete(delete_recording),
        )
        .route(
            "/songs/{song_id}/recordings/{recording_id}/audio",
            get(get_recording_audio),
        )
        .route(
            "/songs/{song_id}/recordings/{recording_id}/link",
            post(link_recording),
        )
        .route("/public/recordings/{key}", get(play_recording))
}

/// A song's recordings, oldest first, without their audio.
#[utoipa::path(
    get,
    path = "/api/v1/songs/{song_id}/recordings",
    security(("bearer" = [])),
    params(("song_id" = Uuid, Path)),
    responses(
        (status = 200, body = [SongRecording]),
        (status = 401, body = ErrorBody),
        (status = 404, body = ErrorBody)
    )
)]
pub async fn list_recordings(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(song_id): Path<Uuid>,
) -> Result<Json<Vec<SongRecording>>, AppError> {
    let auth = authenticate(&headers, &state).await?;
    ensure_song(&state.pool, auth.church_id, song_id).await?;
    let recordings = sqlx::query_as::<_, SongRecording>(
        "SELECT r.id, r.song_id, r.title, r.content_type, r.duration_ms, r.byte_size,
                COALESCE(u.display_name, d.name) AS created_by_name, r.created_at
         FROM song_recordings r
         LEFT JOIN users u ON u.id = r.created_by
         LEFT JOIN device_tokens d ON d.id = r.created_by_device
         WHERE r.song_id = $1 AND r.church_id = $2
         ORDER BY r.created_at, r.id",
    )
    .bind(song_id)
    .bind(auth.church_id)
    .fetch_all(&state.pool)
    .await?;
    Ok(Json(recordings))
}

/// Leaders, owners and desktops: saves a recording of how the song is played.
///
/// The body is the audio itself, up to 40 MB, with its type as
/// `Content-Type` (`audio/webm`, `audio/mp4`, `audio/ogg`, `audio/mpeg`, …).
/// A song keeps at most 20 recordings.
#[utoipa::path(
    post,
    path = "/api/v1/songs/{song_id}/recordings",
    security(("bearer" = [])),
    params(("song_id" = Uuid, Path), RecordingQuery),
    request_body(content = Vec<u8>, content_type = "audio/*"),
    responses(
        (status = 201, body = SongRecording),
        (status = 400, body = ErrorBody),
        (status = 403, body = ErrorBody),
        (status = 404, body = ErrorBody),
        (status = 409, body = ErrorBody),
        (status = 413, body = ErrorBody)
    )
)]
pub async fn add_recording(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(song_id): Path<Uuid>,
    Query(query): Query<RecordingQuery>,
    body: Body,
) -> Result<impl IntoResponse, AppError> {
    let auth = authenticate(&headers, &state).await?;
    let actor = auth.require_song_editor()?;
    let content_type = audio_type(&headers)?;
    let title = title(query.title.as_deref())?.unwrap_or_else(|| "Recording".into());
    let duration_ms = query.duration_ms.filter(|ms| *ms >= 0);
    ensure_song(&state.pool, auth.church_id, song_id).await?;
    ensure_room(&state.pool, song_id).await?;

    let id = Uuid::new_v4();
    let path = state.media.recording_path(auth.church_id, id);
    let size = receive(body, &path).await?;
    let recording = sqlx::query_as::<_, SongRecording>(
        "WITH saved AS (
            INSERT INTO song_recordings
                (id, church_id, song_id, title, content_type, duration_ms, byte_size,
                 created_by, created_by_device)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            RETURNING id, song_id, title, content_type, duration_ms, byte_size, created_by,
                      created_by_device, created_at
         )
         SELECT s.id, s.song_id, s.title, s.content_type, s.duration_ms, s.byte_size,
                COALESCE(u.display_name, d.name) AS created_by_name, s.created_at
         FROM saved s
         LEFT JOIN users u ON u.id = s.created_by
         LEFT JOIN device_tokens d ON d.id = s.created_by_device",
    )
    .bind(id)
    .bind(auth.church_id)
    .bind(song_id)
    .bind(title)
    .bind(content_type)
    .bind(duration_ms)
    .bind(size as i32)
    // A desktop's recording names the desktop, not the person who approved it.
    .bind(actor.user_id.filter(|_| actor.device_id.is_none()))
    .bind(actor.device_id)
    .fetch_one(&state.pool)
    .await;
    match recording {
        Ok(recording) => Ok((StatusCode::CREATED, Json(recording))),
        Err(error) => {
            let _ = tokio::fs::remove_file(&path).await;
            Err(error.into())
        }
    }
}

/// Streams an upload to `path` (through a `.part` file beside it), at most
/// `MAX_RECORDING_BYTES`, and returns its size.
async fn receive(body: Body, path: &FilePath) -> Result<usize, AppError> {
    let failed = |error: std::io::Error| AppError::Internal(format!("saving a recording: {error}"));
    if let Some(parent) = path.parent() {
        tokio::fs::create_dir_all(parent).await.map_err(failed)?;
    }
    let part = path.with_extension("part");
    let mut file = tokio::fs::File::create(&part).await.map_err(failed)?;
    let mut stream = body.into_data_stream();
    let mut size = 0;
    let outcome: Result<(), AppError> = async {
        while let Some(chunk) = stream.next().await {
            let chunk = chunk
                .map_err(|_| AppError::BadRequest("the recording did not arrive whole".into()))?;
            size += chunk.len();
            if size > MAX_RECORDING_BYTES {
                return Err(AppError::PayloadTooLarge(
                    "a recording is at most 40 MB".into(),
                ));
            }
            file.write_all(&chunk).await.map_err(failed)?;
        }
        if size == 0 {
            return Err(AppError::BadRequest("the recording is empty".into()));
        }
        file.flush().await.map_err(failed)?;
        file.sync_all().await.map_err(failed)?;
        Ok(())
    }
    .await;
    drop(file);
    match outcome {
        Ok(()) => {
            tokio::fs::rename(&part, path).await.map_err(failed)?;
            Ok(size)
        }
        Err(error) => {
            let _ = tokio::fs::remove_file(&part).await;
            Err(error)
        }
    }
}

/// A recording's audio, with the type it was recorded in. Answers `Range`.
#[utoipa::path(
    get,
    path = "/api/v1/songs/{song_id}/recordings/{recording_id}/audio",
    security(("bearer" = [])),
    params(("song_id" = Uuid, Path), ("recording_id" = Uuid, Path)),
    responses(
        (status = 200, description = "The audio", content_type = "audio/*", body = Vec<u8>),
        (status = 206, description = "The part of the audio asked for with `Range`"),
        (status = 401, body = ErrorBody),
        (status = 404, body = ErrorBody)
    )
)]
pub async fn get_recording_audio(
    State(state): State<AppState>,
    Path((song_id, recording_id)): Path<(Uuid, Uuid)>,
    request: Request,
) -> Result<Response, AppError> {
    let auth = authenticate(request.headers(), &state).await?;
    let content_type =
        playable_type(&state.pool, auth.church_id, recording_id, Some(song_id)).await?;
    serve(
        state.media.recording_path(auth.church_id, recording_id),
        &content_type,
        request,
        "private, max-age=31536000, immutable",
    )
    .await
}

/// A play link for a recording: a URL without a token, for an `<audio>`
/// element, that works for six hours.
#[utoipa::path(
    post,
    path = "/api/v1/songs/{song_id}/recordings/{recording_id}/link",
    security(("bearer" = [])),
    params(("song_id" = Uuid, Path), ("recording_id" = Uuid, Path)),
    responses(
        (status = 200, body = RecordingLink),
        (status = 401, body = ErrorBody),
        (status = 404, body = ErrorBody)
    )
)]
pub async fn link_recording(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path((song_id, recording_id)): Path<(Uuid, Uuid)>,
) -> Result<Json<RecordingLink>, AppError> {
    let auth = authenticate(&headers, &state).await?;
    playable_type(&state.pool, auth.church_id, recording_id, Some(song_id)).await?;
    let key = state.media.make_link(recording_id);
    Ok(Json(RecordingLink {
        url: format!("/api/v1/public/recordings/{key}"),
        expires_at: Utc::now() + LINK_LIFETIME,
    }))
}

/// Plays a recording through a play link from
/// `POST /songs/{song_id}/recordings/{recording_id}/link`. Answers `Range`;
/// 404 once the link has run out (or the server restarted), or the song or
/// recording is gone.
#[utoipa::path(
    get,
    path = "/api/v1/public/recordings/{key}",
    params(("key" = String, Path)),
    responses(
        (status = 200, description = "The audio", content_type = "audio/*", body = Vec<u8>),
        (status = 206, description = "The part of the audio asked for with `Range`"),
        (status = 404, body = ErrorBody)
    )
)]
pub async fn play_recording(
    State(state): State<AppState>,
    Path(key): Path<String>,
    request: Request,
) -> Result<Response, AppError> {
    let gone = || AppError::NotFound("this play link has run out".into());
    let recording_id = state.media.follow_link(&key).ok_or_else(gone)?;
    let church_id =
        sqlx::query_scalar::<_, Uuid>("SELECT church_id FROM song_recordings WHERE id = $1")
            .bind(recording_id)
            .fetch_optional(&state.pool)
            .await?
            .ok_or_else(gone)?;
    let content_type = playable_type(&state.pool, church_id, recording_id, None).await?;
    serve(
        state.media.recording_path(church_id, recording_id),
        &content_type,
        request,
        "private, max-age=21600",
    )
    .await
}

/// The recording's type, while it and its song are there.
async fn playable_type(
    pool: &PgPool,
    church_id: Uuid,
    recording_id: Uuid,
    song_id: Option<Uuid>,
) -> Result<String, AppError> {
    sqlx::query_scalar::<_, String>(
        "SELECT r.content_type
         FROM song_recordings r JOIN songs s ON s.id = r.song_id
         WHERE r.id = $1 AND r.church_id = $2 AND ($3::uuid IS NULL OR r.song_id = $3)
           AND s.deleted_at IS NULL",
    )
    .bind(recording_id)
    .bind(church_id)
    .bind(song_id)
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| AppError::NotFound("recording was not found".into()))
}

/// Sends the file with `ServeFile`, which streams it and answers `Range`.
async fn serve(
    path: PathBuf,
    content_type: &str,
    request: Request,
    cache: &'static str,
) -> Result<Response, AppError> {
    let mime = content_type
        .parse::<mime::Mime>()
        .unwrap_or(mime::APPLICATION_OCTET_STREAM);
    let response = ServeFile::new_with_mime(&path, &mime)
        .oneshot(request)
        .await
        .map_err(|error| AppError::Internal(format!("reading a recording: {error}")))?;
    if response.status() == StatusCode::NOT_FOUND {
        tracing::error!(path = %path.display(), "a recording's file is missing");
        return Err(AppError::NotFound("recording was not found".into()));
    }
    let mut response = response.map(Body::new);
    response
        .headers_mut()
        .insert(header::CACHE_CONTROL, HeaderValue::from_static(cache));
    Ok(response)
}

/// Leaders, owners and desktops: removes a recording and its file.
#[utoipa::path(
    delete,
    path = "/api/v1/songs/{song_id}/recordings/{recording_id}",
    security(("bearer" = [])),
    params(("song_id" = Uuid, Path), ("recording_id" = Uuid, Path)),
    responses(
        (status = 204, description = "Removed"),
        (status = 403, body = ErrorBody),
        (status = 404, body = ErrorBody)
    )
)]
pub async fn delete_recording(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path((song_id, recording_id)): Path<(Uuid, Uuid)>,
) -> Result<StatusCode, AppError> {
    let auth = authenticate(&headers, &state).await?;
    auth.require_song_editor()?;
    let removed = sqlx::query(
        "DELETE FROM song_recordings WHERE id = $1 AND song_id = $2 AND church_id = $3",
    )
    .bind(recording_id)
    .bind(song_id)
    .bind(auth.church_id)
    .execute(&state.pool)
    .await?;
    if removed.rows_affected() == 0 {
        return Err(AppError::NotFound("recording was not found".into()));
    }
    if let Err(error) =
        tokio::fs::remove_file(state.media.recording_path(auth.church_id, recording_id)).await
        && error.kind() != std::io::ErrorKind::NotFound
    {
        tracing::warn!(%recording_id, %error, "a removed recording's file was left behind");
    }
    Ok(StatusCode::NO_CONTENT)
}

async fn ensure_song(pool: &PgPool, church_id: Uuid, song_id: Uuid) -> Result<(), AppError> {
    let exists = sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS (
            SELECT 1 FROM songs WHERE id = $1 AND church_id = $2 AND deleted_at IS NULL
         )",
    )
    .bind(song_id)
    .bind(church_id)
    .fetch_one(pool)
    .await?;
    if exists {
        Ok(())
    } else {
        Err(AppError::NotFound("song was not found".into()))
    }
}

/// 409 when the song already has `MAX_PER_SONG` recordings.
async fn ensure_room(pool: &PgPool, song_id: Uuid) -> Result<(), AppError> {
    let count =
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM song_recordings WHERE song_id = $1")
            .bind(song_id)
            .fetch_one(pool)
            .await?;
    if count >= MAX_PER_SONG {
        return Err(AppError::Conflict(format!(
            "a song keeps at most {MAX_PER_SONG} recordings; remove one first"
        )));
    }
    Ok(())
}

/// The trimmed title, `None` when blank.
fn title(title: Option<&str>) -> Result<Option<String>, AppError> {
    let title = title.map(str::trim).filter(|title| !title.is_empty());
    if title.is_some_and(|title| title.chars().count() > MAX_TITLE_CHARS) {
        return Err(AppError::BadRequest(format!(
            "a title has at most {MAX_TITLE_CHARS} characters"
        )));
    }
    Ok(title.map(str::to_string))
}

/// The upload's `Content-Type`, which must be audio and safe to send back
/// as a header.
fn audio_type(headers: &HeaderMap) -> Result<String, AppError> {
    let value = headers
        .get(header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or_default()
        .trim()
        .to_ascii_lowercase();
    let safe = value.len() <= 100
        && value.starts_with("audio/")
        && value
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || "/.+-_;=, ".contains(c));
    if safe {
        Ok(value)
    } else {
        Err(AppError::BadRequest(
            "send the recording with an audio Content-Type, such as audio/webm".into(),
        ))
    }
}
