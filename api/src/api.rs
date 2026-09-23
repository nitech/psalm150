use std::{
    collections::HashSet,
    io::{Cursor, Write},
};

use axum::{
    Json, Router,
    body::Body,
    extract::{DefaultBodyLimit, Path, Query, State},
    http::{HeaderMap, HeaderValue, StatusCode, header},
    response::{IntoResponse, Response},
    routing::{get, post},
};
use chrono::Utc;
use sqlx::{PgPool, Postgres, Transaction};
use utoipa::{OpenApi, openapi::OpenApi as OpenApiDocument};
use uuid::Uuid;
use zip::{ZipWriter, write::SimpleFileOptions};

use crate::{
    AppState,
    auth::{
        Actor, LoginRow, authenticate, hash_password, hash_token, issue_session, new_token,
        verify_password,
    },
    chordpro,
    error::{AppError, ErrorBody},
    models::{
        CreateDeviceTokenRequest, CreateSongRequest, DeleteSongQuery, DeviceTokenResponse,
        DeviceTokenSummary, ExportManifestEntry, HealthResponse, ImportSongInput,
        ImportSongsRequest, ImportSongsResponse, LoginRequest, RevisionSummary, Role,
        SessionResponse, SetupRequest, SetupStatus, SongDetail, SongQuery, SongSummary,
        UpdateSongRequest,
    },
};

/// Name of the JSON entry in the export ZIP that maps files to songs.
pub const EXPORT_MANIFEST: &str = "psa150-manifest.json";

#[derive(OpenApi)]
#[openapi(
    info(
        title = "PSA150 Song Server API",
        version = "0.1.0",
        description = "Private-library Phase 1 API for PSA150"
    ),
    paths(
        health,
        setup_status,
        setup,
        login,
        list_device_tokens,
        create_device_token,
        revoke_device_token,
        list_songs,
        create_song,
        get_song,
        update_song,
        delete_song,
        list_revisions,
        import_songs,
        export_songs
    ),
    components(schemas(
        ErrorBody,
        HealthResponse,
        SetupStatus,
        SetupRequest,
        LoginRequest,
        SessionResponse,
        Role,
        CreateDeviceTokenRequest,
        DeviceTokenResponse,
        DeviceTokenSummary,
        CreateSongRequest,
        UpdateSongRequest,
        SongSummary,
        SongDetail,
        RevisionSummary,
        ImportSongInput,
        ImportSongsRequest,
        ImportSongsResponse,
        ExportManifestEntry
    )),
    tags((name = "PSA150", description = "PSA150 Song Server"))
)]
struct ApiDoc;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/health", get(health))
        .route("/setup", get(setup_status).post(setup))
        .route("/session", post(login))
        .route(
            "/device-tokens",
            get(list_device_tokens).post(create_device_token),
        )
        .route(
            "/device-tokens/{device_id}",
            axum::routing::delete(revoke_device_token),
        )
        .route("/songs", get(list_songs).post(create_song))
        .route(
            "/songs/import",
            post(import_songs).layer(DefaultBodyLimit::max(64 * 1024 * 1024)),
        )
        .route("/songs/export", get(export_songs))
        .route(
            "/songs/{song_id}",
            get(get_song).put(update_song).delete(delete_song),
        )
        .route("/songs/{song_id}/revisions", get(list_revisions))
}

pub async fn openapi() -> Json<OpenApiDocument> {
    Json(ApiDoc::openapi())
}

#[utoipa::path(get, path = "/api/v1/health", responses((status = 200, body = HealthResponse)))]
async fn health(State(state): State<AppState>) -> Result<Json<HealthResponse>, AppError> {
    sqlx::query_scalar::<_, i32>("SELECT 1")
        .fetch_one(&state.pool)
        .await?;
    Ok(Json(HealthResponse {
        status: "ok",
        database: "ok",
        version: env!("CARGO_PKG_VERSION"),
    }))
}

#[utoipa::path(get, path = "/api/v1/setup", responses((status = 200, body = SetupStatus)))]
async fn setup_status(State(state): State<AppState>) -> Result<Json<SetupStatus>, AppError> {
    let initialized = sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS (SELECT 1 FROM instance_settings WHERE id = 1)",
    )
    .fetch_one(&state.pool)
    .await?;
    Ok(Json(SetupStatus { initialized }))
}

#[utoipa::path(
    post,
    path = "/api/v1/setup",
    request_body = SetupRequest,
    responses(
        (status = 201, body = SessionResponse),
        (status = 409, body = ErrorBody)
    )
)]
async fn setup(
    State(state): State<AppState>,
    Json(request): Json<SetupRequest>,
) -> Result<impl IntoResponse, AppError> {
    validate_setup(&request)?;
    let password_hash = hash_password(request.password).await?;
    let church_id = Uuid::new_v4();
    let user_id = Uuid::new_v4();
    let mut transaction = state.pool.begin().await?;

    sqlx::query("SELECT pg_advisory_xact_lock(150)")
        .execute(&mut *transaction)
        .await?;
    let initialized = sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS (SELECT 1 FROM instance_settings WHERE id = 1)",
    )
    .fetch_one(&mut *transaction)
    .await?;
    if initialized {
        return Err(AppError::Conflict(
            "server setup is already complete".into(),
        ));
    }

    sqlx::query("INSERT INTO instance_settings (id) VALUES (1)")
        .execute(&mut *transaction)
        .await?;
    sqlx::query("INSERT INTO churches (id, name, slug) VALUES ($1, $2, $3)")
        .bind(church_id)
        .bind(request.church_name.trim())
        .bind(slugify(&request.church_name))
        .execute(&mut *transaction)
        .await?;
    sqlx::query(
        "INSERT INTO users (id, display_name, username, password_hash)
         VALUES ($1, $2, $3, $4)",
    )
    .bind(user_id)
    .bind(request.owner_name.trim())
    .bind(request.username.trim())
    .bind(password_hash)
    .execute(&mut *transaction)
    .await?;
    sqlx::query("INSERT INTO memberships (user_id, church_id, role) VALUES ($1, $2, 'owner')")
        .bind(user_id)
        .bind(church_id)
        .execute(&mut *transaction)
        .await?;
    transaction.commit().await?;

    let owner = LoginRow {
        user_id,
        display_name: request.owner_name.trim().to_string(),
        password_hash: String::new(),
        church_id,
        church_name: request.church_name.trim().to_string(),
        role: "owner".into(),
    };
    let session = issue_session(&state.pool, state.session_hours, &owner).await?;
    Ok((StatusCode::CREATED, Json(session)))
}

#[utoipa::path(
    post,
    path = "/api/v1/session",
    request_body = LoginRequest,
    responses((status = 200, body = SessionResponse), (status = 401, body = ErrorBody))
)]
async fn login(
    State(state): State<AppState>,
    Json(request): Json<LoginRequest>,
) -> Result<Json<SessionResponse>, AppError> {
    let user = sqlx::query_as::<_, LoginRow>(
        "SELECT u.id AS user_id, u.display_name, u.password_hash,
                c.id AS church_id, c.name AS church_name, m.role
         FROM users u
         JOIN memberships m ON m.user_id = u.id
         JOIN churches c ON c.id = m.church_id
         WHERE lower(u.username) = lower($1) AND u.disabled_at IS NULL
         ORDER BY c.created_at
         LIMIT 1",
    )
    .bind(request.username.trim())
    .fetch_optional(&state.pool)
    .await?
    .ok_or_else(invalid_login)?;

    if !verify_password(request.password, user.password_hash.clone()).await? {
        return Err(invalid_login());
    }

    Ok(Json(
        issue_session(&state.pool, state.session_hours, &user).await?,
    ))
}

#[utoipa::path(
    post,
    path = "/api/v1/device-tokens",
    request_body = CreateDeviceTokenRequest,
    responses((status = 201, body = DeviceTokenResponse), (status = 401, body = ErrorBody))
)]
async fn create_device_token(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(request): Json<CreateDeviceTokenRequest>,
) -> Result<impl IntoResponse, AppError> {
    let auth = authenticate(&headers, &state).await?;
    let user_id = auth.require_editor()?;
    let name = request.name.trim();
    if name.is_empty() || name.len() > 120 {
        return Err(AppError::BadRequest(
            "device name must contain 1 to 120 characters".into(),
        ));
    }

    let id = Uuid::new_v4();
    let token = new_token("psa_d_");
    let created_at = Utc::now();
    sqlx::query(
        "INSERT INTO device_tokens (id, church_id, name, token_hash, created_by, created_at)
         VALUES ($1, $2, $3, $4, $5, $6)",
    )
    .bind(id)
    .bind(auth.church_id)
    .bind(name)
    .bind(hash_token(&token))
    .bind(user_id)
    .bind(created_at)
    .execute(&state.pool)
    .await?;

    Ok((
        StatusCode::CREATED,
        Json(DeviceTokenResponse {
            id,
            name: name.to_string(),
            token,
            created_at,
        }),
    ))
}

#[utoipa::path(
    get,
    path = "/api/v1/device-tokens",
    responses((status = 200, body = [DeviceTokenSummary]), (status = 401, body = ErrorBody))
)]
async fn list_device_tokens(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Vec<DeviceTokenSummary>>, AppError> {
    let auth = authenticate(&headers, &state).await?;
    auth.require_editor()?;
    let devices = sqlx::query_as::<_, DeviceTokenSummary>(
        "SELECT id, name, created_at, last_used_at
         FROM device_tokens
         WHERE church_id = $1 AND revoked_at IS NULL
         ORDER BY lower(name), created_at",
    )
    .bind(auth.church_id)
    .fetch_all(&state.pool)
    .await?;
    Ok(Json(devices))
}

#[utoipa::path(
    delete,
    path = "/api/v1/device-tokens/{device_id}",
    params(("device_id" = Uuid, Path)),
    responses((status = 204), (status = 404, body = ErrorBody))
)]
async fn revoke_device_token(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(device_id): Path<Uuid>,
) -> Result<StatusCode, AppError> {
    let auth = authenticate(&headers, &state).await?;
    auth.require_editor()?;
    let result = sqlx::query(
        "UPDATE device_tokens SET revoked_at = now()
         WHERE id = $1 AND church_id = $2 AND revoked_at IS NULL",
    )
    .bind(device_id)
    .bind(auth.church_id)
    .execute(&state.pool)
    .await?;
    if result.rows_affected() == 0 {
        return Err(AppError::NotFound("device was not found".into()));
    }
    Ok(StatusCode::NO_CONTENT)
}

#[utoipa::path(
    get,
    path = "/api/v1/songs",
    params(("q" = Option<String>, Query), ("limit" = Option<i64>, Query)),
    responses((status = 200, body = [SongSummary]), (status = 401, body = ErrorBody))
)]
async fn list_songs(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<SongQuery>,
) -> Result<Json<Vec<SongSummary>>, AppError> {
    let auth = authenticate(&headers, &state).await?;
    let search = query.q.unwrap_or_default().trim().to_string();
    let pattern = format!("%{search}%");
    let limit = query.limit.unwrap_or(100).clamp(1, 200);

    let songs = sqlx::query_as::<_, SongSummary>(
        "SELECT s.id, r.id AS revision_id, r.title, r.song_number, r.authors,
                r.language, r.created_at AS updated_at
         FROM songs s
         JOIN song_revisions r ON r.id = s.current_revision_id
         WHERE s.church_id = $1 AND s.deleted_at IS NULL
           AND ($2 = '' OR r.title ILIKE $3 OR r.authors ILIKE $3
                OR coalesce(r.song_number, '') ILIKE $3 OR r.chordpro ILIKE $3)
         ORDER BY lower(r.title), r.created_at DESC
         LIMIT $4",
    )
    .bind(auth.church_id)
    .bind(&search)
    .bind(pattern)
    .bind(limit)
    .fetch_all(&state.pool)
    .await?;

    Ok(Json(songs))
}

#[utoipa::path(
    post,
    path = "/api/v1/songs",
    request_body = CreateSongRequest,
    responses((status = 201, body = SongSummary), (status = 401, body = ErrorBody))
)]
async fn create_song(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(request): Json<CreateSongRequest>,
) -> Result<impl IntoResponse, AppError> {
    let auth = authenticate(&headers, &state).await?;
    let actor = auth.require_song_editor()?;
    let song = insert_song(&state.pool, auth.church_id, actor, request.chordpro).await?;
    Ok((StatusCode::CREATED, Json(song)))
}

#[utoipa::path(
    get,
    path = "/api/v1/songs/{song_id}",
    params(("song_id" = Uuid, Path)),
    responses((status = 200, body = SongDetail), (status = 404, body = ErrorBody))
)]
async fn get_song(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(song_id): Path<Uuid>,
) -> Result<Json<SongDetail>, AppError> {
    let auth = authenticate(&headers, &state).await?;
    let song = fetch_song(&state.pool, auth.church_id, song_id)
        .await?
        .ok_or_else(|| AppError::NotFound("song was not found".into()))?;
    Ok(Json(song))
}

#[utoipa::path(
    put,
    path = "/api/v1/songs/{song_id}",
    params(("song_id" = Uuid, Path)),
    request_body = UpdateSongRequest,
    responses(
        (status = 200, body = SongDetail),
        (status = 409, body = ErrorBody),
        (status = 404, body = ErrorBody)
    )
)]
async fn update_song(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(song_id): Path<Uuid>,
    Json(request): Json<UpdateSongRequest>,
) -> Result<Json<SongDetail>, AppError> {
    let auth = authenticate(&headers, &state).await?;
    let actor = auth.require_song_editor()?;
    validate_chordpro(&request.chordpro)?;
    let parsed = chordpro::metadata(&request.chordpro);
    let revision_id = Uuid::new_v4();
    let mut transaction = state.pool.begin().await?;

    let current_revision_id = lock_song(&mut transaction, auth.church_id, song_id).await?;
    if current_revision_id != request.base_revision_id {
        return Err(AppError::Conflict(format!(
            "song changed since revision {}; current revision is {}",
            request.base_revision_id, current_revision_id
        )));
    }

    insert_revision(
        &mut transaction,
        NewRevision {
            revision_id,
            song_id,
            parent_revision_id: Some(current_revision_id),
            actor,
            source: &request.chordpro,
            parsed: &parsed,
            created_at: Utc::now(),
        },
    )
    .await?;
    sqlx::query("UPDATE songs SET current_revision_id = $1 WHERE id = $2")
        .bind(revision_id)
        .bind(song_id)
        .execute(&mut *transaction)
        .await?;
    transaction.commit().await?;

    Ok(Json(
        fetch_song(&state.pool, auth.church_id, song_id)
            .await?
            .ok_or_else(|| AppError::NotFound("song was not found".into()))?,
    ))
}

#[utoipa::path(
    delete,
    path = "/api/v1/songs/{song_id}",
    params(("song_id" = Uuid, Path), DeleteSongQuery),
    responses(
        (status = 204),
        (status = 409, body = ErrorBody),
        (status = 404, body = ErrorBody)
    )
)]
async fn delete_song(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(song_id): Path<Uuid>,
    Query(query): Query<DeleteSongQuery>,
) -> Result<StatusCode, AppError> {
    let auth = authenticate(&headers, &state).await?;
    let actor = auth.require_song_editor()?;
    let mut transaction = state.pool.begin().await?;

    let current_revision_id = lock_song(&mut transaction, auth.church_id, song_id).await?;
    // Like updates, a delete based on an older revision must not discard a
    // newer edit: the caller has to look at the change first.
    if let Some(base) = query.base_revision_id
        && base != current_revision_id
    {
        return Err(AppError::Conflict(format!(
            "song changed since revision {base}; current revision is {current_revision_id}"
        )));
    }
    sqlx::query(
        "UPDATE songs SET deleted_at = now(), deleted_by = $1, deleted_by_device = $2
         WHERE id = $3 AND church_id = $4",
    )
    .bind(actor.user_id)
    .bind(actor.device_id)
    .bind(song_id)
    .bind(auth.church_id)
    .execute(&mut *transaction)
    .await?;
    transaction.commit().await?;
    Ok(StatusCode::NO_CONTENT)
}

#[utoipa::path(
    get,
    path = "/api/v1/songs/{song_id}/revisions",
    params(("song_id" = Uuid, Path)),
    responses((status = 200, body = [RevisionSummary]), (status = 404, body = ErrorBody))
)]
async fn list_revisions(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(song_id): Path<Uuid>,
) -> Result<Json<Vec<RevisionSummary>>, AppError> {
    let auth = authenticate(&headers, &state).await?;
    let exists = sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS (
            SELECT 1 FROM songs WHERE id = $1 AND church_id = $2 AND deleted_at IS NULL
         )",
    )
    .bind(song_id)
    .bind(auth.church_id)
    .fetch_one(&state.pool)
    .await?;
    if !exists {
        return Err(AppError::NotFound("song was not found".into()));
    }

    let revisions = sqlx::query_as::<_, RevisionSummary>(
        "SELECT id, parent_revision_id, title, content_hash, created_at
         FROM song_revisions WHERE song_id = $1 ORDER BY created_at DESC",
    )
    .bind(song_id)
    .fetch_all(&state.pool)
    .await?;
    Ok(Json(revisions))
}

#[utoipa::path(
    post,
    path = "/api/v1/songs/import",
    request_body = ImportSongsRequest,
    responses((status = 201, body = ImportSongsResponse), (status = 400, body = ErrorBody))
)]
async fn import_songs(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(request): Json<ImportSongsRequest>,
) -> Result<impl IntoResponse, AppError> {
    let auth = authenticate(&headers, &state).await?;
    let actor = auth.require_song_editor()?;
    if request.songs.is_empty() || request.songs.len() > 500 {
        return Err(AppError::BadRequest(
            "an import must contain between 1 and 500 songs".into(),
        ));
    }

    for song in &request.songs {
        validate_chordpro(&song.chordpro)?;
    }

    let mut transaction = state.pool.begin().await?;
    // Serialize imports for one church so two desktops cannot add the same
    // content concurrently after both observing that it is missing.
    sqlx::query_scalar::<_, Uuid>("SELECT id FROM churches WHERE id = $1 FOR UPDATE")
        .bind(auth.church_id)
        .fetch_one(&mut *transaction)
        .await?;
    let mut existing_hashes = sqlx::query_scalar::<_, String>(
        "SELECT r.content_hash
         FROM songs s
         JOIN song_revisions r ON r.id = s.current_revision_id
         WHERE s.church_id = $1 AND s.deleted_at IS NULL",
    )
    .bind(auth.church_id)
    .fetch_all(&mut *transaction)
    .await?
    .into_iter()
    .collect::<HashSet<_>>();
    let mut imported = Vec::with_capacity(request.songs.len());
    let mut skipped_existing = 0;
    for song in request.songs {
        if !existing_hashes.insert(chordpro::content_hash(&song.chordpro)) {
            skipped_existing += 1;
            continue;
        }
        imported.push(
            insert_song_in_transaction(&mut transaction, auth.church_id, actor, song.chordpro)
                .await?,
        );
    }
    transaction.commit().await?;

    Ok((
        StatusCode::CREATED,
        Json(ImportSongsResponse {
            songs: imported,
            skipped_existing,
        }),
    ))
}

#[utoipa::path(
    get,
    path = "/api/v1/songs/export",
    responses((status = 200, description = "ZIP archive containing ChordPro files"))
)]
async fn export_songs(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Response, AppError> {
    let auth = authenticate(&headers, &state).await?;
    let songs = sqlx::query_as::<_, SongDetail>(
        "SELECT s.id, r.id AS revision_id, r.parent_revision_id, r.title,
                r.song_number, r.authors, r.language, r.chordpro,
                r.content_hash, r.created_at AS updated_at
         FROM songs s
         JOIN song_revisions r ON r.id = s.current_revision_id
         WHERE s.church_id = $1 AND s.deleted_at IS NULL
         ORDER BY lower(r.title)",
    )
    .bind(auth.church_id)
    .fetch_all(&state.pool)
    .await?;

    let mut archive = ZipWriter::new(Cursor::new(Vec::new()));
    let options = SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
    let mut manifest = Vec::with_capacity(songs.len());
    for song in songs {
        let filename = chordpro::export_filename(&song.title, song.id);
        archive
            .start_file(filename.as_str(), options)
            .map_err(|error| AppError::Internal(format!("could not create export: {error}")))?;
        archive
            .write_all(song.chordpro.as_bytes())
            .map_err(|error| AppError::Internal(format!("could not create export: {error}")))?;
        manifest.push(ExportManifestEntry {
            filename,
            id: song.id,
            revision_id: song.revision_id,
            content_hash: song.content_hash,
        });
    }
    // Maps each exported file to its song and revision so a desktop can send
    // edits (with the base revision) and deletions back.
    archive
        .start_file(EXPORT_MANIFEST, options)
        .map_err(|error| AppError::Internal(format!("could not create export: {error}")))?;
    let manifest = serde_json::to_vec(&manifest)
        .map_err(|error| AppError::Internal(format!("could not create export: {error}")))?;
    archive
        .write_all(&manifest)
        .map_err(|error| AppError::Internal(format!("could not create export: {error}")))?;
    let bytes = archive
        .finish()
        .map_err(|error| AppError::Internal(format!("could not finish export: {error}")))?
        .into_inner();

    let mut response = Response::new(Body::from(bytes));
    response.headers_mut().insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static("application/zip"),
    );
    response.headers_mut().insert(
        header::CONTENT_DISPOSITION,
        HeaderValue::from_static("attachment; filename=psa150-library.zip"),
    );
    Ok(response)
}

async fn insert_song(
    pool: &PgPool,
    church_id: Uuid,
    actor: Actor,
    source: String,
) -> Result<SongSummary, AppError> {
    let mut transaction = pool.begin().await?;
    let song = insert_song_in_transaction(&mut transaction, church_id, actor, source).await?;
    transaction.commit().await?;
    Ok(song)
}

async fn insert_song_in_transaction(
    transaction: &mut Transaction<'_, Postgres>,
    church_id: Uuid,
    actor: Actor,
    source: String,
) -> Result<SongSummary, AppError> {
    validate_chordpro(&source)?;
    let parsed = chordpro::metadata(&source);
    let song_id = Uuid::new_v4();
    let revision_id = Uuid::new_v4();
    let created_at = Utc::now();

    sqlx::query("INSERT INTO songs (id, church_id, created_at) VALUES ($1, $2, $3)")
        .bind(song_id)
        .bind(church_id)
        .bind(created_at)
        .execute(&mut **transaction)
        .await?;
    insert_revision(
        transaction,
        NewRevision {
            revision_id,
            song_id,
            parent_revision_id: None,
            actor,
            source: &source,
            parsed: &parsed,
            created_at,
        },
    )
    .await?;
    sqlx::query("UPDATE songs SET current_revision_id = $1 WHERE id = $2")
        .bind(revision_id)
        .bind(song_id)
        .execute(&mut **transaction)
        .await?;

    Ok(SongSummary {
        id: song_id,
        revision_id,
        title: parsed.title,
        song_number: parsed.song_number,
        authors: parsed.authors,
        language: parsed.language,
        updated_at: created_at,
    })
}

struct NewRevision<'a> {
    revision_id: Uuid,
    song_id: Uuid,
    parent_revision_id: Option<Uuid>,
    actor: Actor,
    source: &'a str,
    parsed: &'a chordpro::SongMetadata,
    created_at: chrono::DateTime<Utc>,
}

async fn insert_revision(
    transaction: &mut Transaction<'_, Postgres>,
    revision: NewRevision<'_>,
) -> Result<(), AppError> {
    sqlx::query(
        "INSERT INTO song_revisions
         (id, song_id, parent_revision_id, title, song_number, authors, language,
          chordpro, content_hash, created_by, created_by_device, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)",
    )
    .bind(revision.revision_id)
    .bind(revision.song_id)
    .bind(revision.parent_revision_id)
    .bind(&revision.parsed.title)
    .bind(&revision.parsed.song_number)
    .bind(&revision.parsed.authors)
    .bind(&revision.parsed.language)
    .bind(revision.source)
    .bind(chordpro::content_hash(revision.source))
    .bind(revision.actor.user_id)
    .bind(revision.actor.device_id)
    .bind(revision.created_at)
    .execute(&mut **transaction)
    .await?;
    Ok(())
}

async fn lock_song(
    transaction: &mut Transaction<'_, Postgres>,
    church_id: Uuid,
    song_id: Uuid,
) -> Result<Uuid, AppError> {
    sqlx::query_scalar::<_, Option<Uuid>>(
        "SELECT current_revision_id FROM songs
         WHERE id = $1 AND church_id = $2 AND deleted_at IS NULL FOR UPDATE",
    )
    .bind(song_id)
    .bind(church_id)
    .fetch_optional(&mut **transaction)
    .await?
    .flatten()
    .ok_or_else(|| AppError::NotFound("song was not found".into()))
}

async fn fetch_song(
    pool: &PgPool,
    church_id: Uuid,
    song_id: Uuid,
) -> Result<Option<SongDetail>, AppError> {
    Ok(sqlx::query_as::<_, SongDetail>(
        "SELECT s.id, r.id AS revision_id, r.parent_revision_id, r.title,
                r.song_number, r.authors, r.language, r.chordpro,
                r.content_hash, r.created_at AS updated_at
         FROM songs s
         JOIN song_revisions r ON r.id = s.current_revision_id
         WHERE s.id = $1 AND s.church_id = $2 AND s.deleted_at IS NULL",
    )
    .bind(song_id)
    .bind(church_id)
    .fetch_optional(pool)
    .await?)
}

fn validate_setup(request: &SetupRequest) -> Result<(), AppError> {
    if request.church_name.trim().is_empty()
        || request.owner_name.trim().is_empty()
        || request.username.trim().is_empty()
    {
        return Err(AppError::BadRequest(
            "church name, owner name, and username are required".into(),
        ));
    }
    if request.password.chars().count() < 10 {
        return Err(AppError::BadRequest(
            "password must contain at least 10 characters".into(),
        ));
    }
    Ok(())
}

fn validate_chordpro(source: &str) -> Result<(), AppError> {
    if source.trim().is_empty() {
        return Err(AppError::BadRequest("ChordPro source is empty".into()));
    }
    if source.len() > 1_000_000 {
        return Err(AppError::BadRequest(
            "a song cannot exceed 1 MB of ChordPro source".into(),
        ));
    }
    Ok(())
}

fn slugify(value: &str) -> String {
    let slug = value
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() {
                character.to_ascii_lowercase()
            } else {
                '-'
            }
        })
        .collect::<String>()
        .split('-')
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join("-");
    if slug.is_empty() {
        format!("church-{}", &Uuid::new_v4().simple().to_string()[..8])
    } else {
        slug
    }
}

fn invalid_login() -> AppError {
    AppError::Unauthorized("username or password is incorrect".into())
}
