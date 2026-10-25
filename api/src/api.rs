use std::{
    collections::HashSet,
    io::{Cursor, Write},
    net::SocketAddr,
};

use axum::{
    Extension, Json, Router,
    body::Body,
    extract::{ConnectInfo, DefaultBodyLimit, Path, Query, State},
    http::{HeaderMap, HeaderValue, StatusCode, header},
    response::{IntoResponse, Response},
    routing::{get, post},
};
use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use chrono::Utc;
use sha2::{Digest, Sha256};
use sqlx::{PgPool, Postgres, Transaction};
use utoipa::{
    Modify, OpenApi,
    openapi::{
        OpenApi as OpenApiDocument,
        security::{HttpAuthScheme, HttpBuilder, SecurityScheme},
        tag::Tag,
    },
};
use uuid::Uuid;
use zip::{ZipWriter, write::SimpleFileOptions};

use crate::{
    AppState,
    auth::{
        Actor, LoginRow, MAX_PASSWORD_CHARS, authenticate, hash_password, hash_token,
        issue_session, new_token, validate_password, verify_password,
    },
    chordpro,
    error::{AppError, ErrorBody},
    models::{
        AddSharedSetItemRequest, ApiTokenResponse, ApiTokenSummary, ChangePasswordRequest,
        ChurchSettings, CreateApiTokenRequest, CreateDesktopAuthCodeRequest,
        CreateDeviceTokenRequest, CreateMemberRequest, CreateSetRequest, CreateSongRequest,
        DeleteSongQuery, DeletedSet, DeletedSong, DesktopAuthCodeResponse, DesktopRoom,
        DesktopState, DesktopTokenRequest, DesktopTokenResponse, DeviceTokenResponse,
        DeviceTokenSummary, ExportManifestEntry, HealthResponse, ImportSongInput,
        ImportSongsRequest, ImportSongsResponse, KeyMode, LeadSetRequest, LoginRequest, Member,
        PageQuery, RemoteAction, RemoteCommand, RemoteCommandRequest, RemoteDesktop,
        RevisionDetail, RevisionSummary, Role, RoomNameRequest, RoomSlide, RoomStatus, RoomView,
        ServerInfo, SessionInfo, SessionResponse, SetDetail, SetItem, SetItemInput, SetItemKind,
        SetLive, SetShare, SetSongRef, SetSummary, SetupRequest, SetupStatus, ShareSetRequest,
        SharedSet, SharedSetLive, SongDetail, SongKeyCount, SongQuery, SongSort, SongSummary,
        SortDirection, TokenKind, UpdateChurchRequest, UpdateMemberRequest, UpdateSetRequest,
        UpdateSongRequest,
    },
    throttle,
};

/// Name of the JSON entry in the export ZIP that maps files to songs.
pub const EXPORT_MANIFEST: &str = "psa150-manifest.json";

#[derive(OpenApi)]
#[openapi(
    info(
        title = "PSA150 Song Server API",
        version = "0.1.0",
        description = "Everything the song server does, for any client. Operations marked with \
            the `bearer` scheme need `Authorization: Bearer <token>`: a `psa_s_` session from \
            `POST /api/v1/session`, a `psa_a_` API token from `POST /api/v1/api-tokens` (it acts \
            as the person who made it, for scripts and integrations) or a `psa_d_` desktop token. \
            Errors are JSON `{\"error\": \"...\"}`."
    ),
    modifiers(&BearerAuth, &Groups),
    paths(
        health,
        server_info,
        setup_status,
        setup,
        login,
        crate::access::current_session,
        crate::access::end_session,
        crate::access::change_password,
        crate::access::list_api_tokens,
        crate::access::create_api_token,
        crate::access::revoke_api_token,
        crate::access::list_members,
        crate::access::create_member,
        crate::access::update_member,
        crate::access::remove_member,
        crate::account_links::list_account_links,
        crate::account_links::create_invite,
        crate::account_links::create_reset_link,
        crate::account_links::revoke_account_link,
        crate::account_links::get_account_link,
        crate::account_links::use_account_link,
        get_church,
        update_church,
        list_device_tokens,
        create_device_token,
        revoke_device_token,
        create_desktop_auth_code,
        exchange_desktop_auth_code,
        list_songs,
        create_song,
        get_song,
        update_song,
        delete_song,
        list_deleted_songs,
        restore_song,
        list_revisions,
        get_revision,
        list_song_keys,
        crate::online::search_online,
        list_public_songs,
        list_public_song_keys,
        get_public_song,
        import_songs,
        export_songs,
        crate::sets::list_sets,
        crate::sets::sets_snapshot,
        crate::sets::create_set,
        crate::sets::get_set,
        crate::sets::update_set,
        crate::sets::delete_set,
        crate::sets::list_deleted_sets,
        crate::sets::restore_set,
        crate::shared_sets::get_set_share,
        crate::shared_sets::share_set,
        crate::shared_sets::stop_sharing_set,
        crate::shared_sets::get_shared_set,
        crate::shared_sets::get_shared_set_song,
        crate::shared_sets::list_shared_set_songs,
        crate::shared_sets::add_shared_set_item,
        crate::shared_sets::remove_shared_set_item,
        crate::live_sets::get_set_live,
        crate::live_sets::lead_set,
        crate::live_sets::stop_leading_set,
        crate::live_sets::shared_set_live,
        crate::remote::report_desktop_state,
        crate::remote::leave_remote,
        crate::remote::wait_for_commands,
        crate::remote::list_desktops,
        crate::remote::desktop_events,
        crate::remote::send_command,
        crate::rooms::own_room,
        crate::rooms::rename_own_room,
        crate::rooms::rename_room,
        crate::rooms::get_room,
        crate::rooms::room_events
    ),
    components(schemas(
        ErrorBody,
        crate::online::OnlineSong,
        HealthResponse,
        ServerInfo,
        SetupStatus,
        SetupRequest,
        LoginRequest,
        SessionResponse,
        SessionInfo,
        TokenKind,
        Role,
        ChangePasswordRequest,
        CreateApiTokenRequest,
        ApiTokenResponse,
        ApiTokenSummary,
        Member,
        CreateMemberRequest,
        UpdateMemberRequest,
        crate::models::AccountLinkKind,
        crate::models::CreateInviteRequest,
        crate::models::AccountLink,
        crate::models::AccountLinkResponse,
        crate::models::PublicAccountLink,
        crate::models::UseAccountLinkRequest,
        ChurchSettings,
        UpdateChurchRequest,
        CreateDeviceTokenRequest,
        DeviceTokenResponse,
        DeviceTokenSummary,
        CreateDesktopAuthCodeRequest,
        DesktopAuthCodeResponse,
        DesktopTokenRequest,
        DesktopTokenResponse,
        CreateSongRequest,
        UpdateSongRequest,
        SongSummary,
        SongDetail,
        DeletedSong,
        RevisionSummary,
        RevisionDetail,
        ImportSongInput,
        ImportSongsRequest,
        ImportSongsResponse,
        SongSort,
        SortDirection,
        KeyMode,
        SongKeyCount,
        ExportManifestEntry,
        SetItemKind,
        SetItemInput,
        CreateSetRequest,
        UpdateSetRequest,
        SetSummary,
        DeletedSet,
        SetSongRef,
        SetItem,
        SetDetail,
        ShareSetRequest,
        SetShare,
        SharedSet,
        AddSharedSetItemRequest,
        LeadSetRequest,
        SetLive,
        SharedSetLive,
        DesktopState,
        RemoteDesktop,
        RemoteAction,
        RemoteCommandRequest,
        RemoteCommand,
        RoomSlide,
        DesktopRoom,
        RoomNameRequest,
        RoomStatus,
        RoomView
    ))
)]
struct ApiDoc;

/// Declares the `bearer` scheme that authenticated operations refer to.
struct BearerAuth;

impl Modify for BearerAuth {
    fn modify(&self, openapi: &mut OpenApiDocument) {
        openapi
            .components
            .get_or_insert_with(Default::default)
            .add_security_scheme(
                "bearer",
                SecurityScheme::Http(
                    HttpBuilder::new()
                        .scheme(HttpAuthScheme::Bearer)
                        .description(Some(
                            "A `psa_s_` session, a `psa_a_` API token or a `psa_d_` desktop token",
                        ))
                        .build(),
                ),
            );
    }
}

/// The API's sections, in reading order: (name, description, the paths
/// after `/api/v1/` that belong to it). Every operation is in exactly one;
/// the web client's API reference and tools such as Swagger group by them.
const GROUPS: &[(&str, &str, &[&str])] = &[
    (
        "Server",
        "Whether the server is up, what it offers, and setting it up the first time.",
        &["health", "info", "setup"],
    ),
    (
        "Sign-in and account",
        "Signing in and out, changing your own password, and opening an invite or reset link.",
        &["session", "account", "public/account-links"],
    ),
    (
        "API tokens",
        "Tokens that act as you, for scripts and other programs.",
        &["api-tokens"],
    ),
    (
        "People",
        "The church's people and their roles, and links that invite people or reset a password. Owners only.",
        &["members"],
    ),
    ("Church", "The church's name and settings.", &["church"]),
    (
        "Songs",
        "The church's song library: ChordPro songs with every revision kept.",
        &["songs"],
    ),
    (
        "Sets",
        "Song lists for services, shared with the desktops.",
        &["sets"],
    ),
    (
        "Desktops",
        "Connecting Psalm150 desktops: browser sign-in, desktop tokens and room names.",
        &["device-tokens", "desktop-auth"],
    ),
    (
        "Remote control",
        "Desktops report what they project; leaders' phones follow and steer them.",
        &["remote"],
    ),
    (
        "Rooms",
        "Anyone may follow the words a desktop projects by its room name. No token needed.",
        &["public/rooms"],
    ),
    (
        "Shared sets",
        "Sets a leader shared on a link: anyone with the link reads the set and its songs,          follows a leader through it live, and adds or removes songs when the leader allows it.          No token needed.",
        &["public/sets"],
    ),
    (
        "Public library",
        "Songs of churches that opened their library to everyone. No token needed.",
        &["public/songs"],
    ),
];

/// Puts every operation in its section (`GROUPS`), by its path.
struct Groups;

impl Modify for Groups {
    fn modify(&self, openapi: &mut OpenApiDocument) {
        openapi.tags = Some(
            GROUPS
                .iter()
                .map(|(name, description, _)| {
                    let mut tag = Tag::new(name);
                    tag.description = Some((*description).to_string());
                    tag
                })
                .collect(),
        );
        for (path, item) in openapi.paths.paths.iter_mut() {
            let rest = path.trim_start_matches("/api/v1/");
            let group = GROUPS
                .iter()
                .find(|(_, _, prefixes)| {
                    prefixes.iter().any(|prefix| {
                        rest == *prefix
                            || rest
                                .strip_prefix(prefix)
                                .is_some_and(|tail| tail.starts_with('/'))
                    })
                })
                .map(|(name, _, _)| (*name).to_string());
            for operation in [
                &mut item.get,
                &mut item.put,
                &mut item.post,
                &mut item.delete,
                &mut item.patch,
            ]
            .into_iter()
            .flatten()
            {
                operation.tags = group.clone().map(|group| vec![group]);
            }
        }
    }
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/health", get(health))
        .route("/info", get(server_info))
        .route("/setup", get(setup_status).post(setup))
        .route("/session", post(login))
        .route("/church", get(get_church).put(update_church))
        .route(
            "/device-tokens",
            get(list_device_tokens).post(create_device_token),
        )
        .route(
            "/device-tokens/{device_id}",
            axum::routing::delete(revoke_device_token),
        )
        .route("/desktop-auth/codes", post(create_desktop_auth_code))
        .route("/desktop-auth/token", post(exchange_desktop_auth_code))
        .route("/songs", get(list_songs).post(create_song))
        .route(
            "/songs/import",
            post(import_songs).layer(DefaultBodyLimit::max(64 * 1024 * 1024)),
        )
        .route("/songs/export", get(export_songs))
        .route("/songs/deleted", get(list_deleted_songs))
        .route("/songs/keys", get(list_song_keys))
        .route(
            "/songs/{song_id}",
            get(get_song).put(update_song).delete(delete_song),
        )
        .route("/songs/{song_id}/restore", post(restore_song))
        .route("/songs/{song_id}/revisions", get(list_revisions))
        .route(
            "/songs/{song_id}/revisions/{revision_id}",
            get(get_revision),
        )
        .route("/public/songs", get(list_public_songs))
        .route("/public/songs/keys", get(list_public_song_keys))
        .route("/public/songs/{song_id}", get(get_public_song))
        .merge(crate::access::router())
        .merge(crate::account_links::router())
        .merge(crate::online::router())
        .merge(crate::sets::router())
        .merge(crate::shared_sets::router())
        .merge(crate::live_sets::router())
        .merge(crate::remote::router())
        .merge(crate::rooms::router())
}

pub async fn openapi() -> Json<OpenApiDocument> {
    Json(ApiDoc::openapi())
}

/// Checks that the server and its database answer.
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

/// The desktop API contract. Desktops check new paths against the OpenAPI
/// document on their own, so raise this only when an existing path changes
/// behaviour that a new desktop release depends on, and raise the desktop's
/// `REQUIRED_DESKTOP_API` to match in that release. Never lower it.
pub const DESKTOP_API: u32 = 1;

/// What this server is and offers.
///
/// Whether it is set up, supports desktop sign-in, has a public library and
/// shares rooms. No token needed.
#[utoipa::path(get, path = "/api/v1/info", responses((status = 200, body = ServerInfo)))]
async fn server_info(State(state): State<AppState>) -> Result<Json<ServerInfo>, AppError> {
    let public = sqlx::query_scalar::<_, String>(
        "SELECT name FROM churches WHERE public_library ORDER BY created_at LIMIT 2",
    )
    .fetch_all(&state.pool)
    .await?;
    let rooms =
        sqlx::query_scalar::<_, bool>("SELECT EXISTS (SELECT 1 FROM churches WHERE public_rooms)")
            .fetch_one(&state.pool)
            .await?;
    Ok(Json(ServerInfo {
        service: "psalm150-song-server",
        version: env!("CARGO_PKG_VERSION"),
        desktop_api: DESKTOP_API,
        initialized: is_initialized(&state.pool).await?,
        desktop_sign_in: true,
        public_library: !public.is_empty(),
        public_library_name: match public.as_slice() {
            [name] => Some(name.clone()),
            _ => None,
        },
        rooms,
    }))
}

/// Whether the server has been set up with a church and its first owner.
#[utoipa::path(get, path = "/api/v1/setup", responses((status = 200, body = SetupStatus)))]
async fn setup_status(State(state): State<AppState>) -> Result<Json<SetupStatus>, AppError> {
    Ok(Json(SetupStatus {
        initialized: is_initialized(&state.pool).await?,
    }))
}

async fn is_initialized(pool: &PgPool) -> Result<bool, AppError> {
    Ok(sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS (SELECT 1 FROM instance_settings WHERE id = 1)",
    )
    .fetch_one(pool)
    .await?)
}

/// Sets up a new server.
///
/// Creates the church and its first owner, and signs the owner in. Works once;
/// after that the answer is 409.
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
    // Refuse before hashing, so a set-up server spends no work on it; the
    // check under the lock below settles a race.
    if is_initialized(&state.pool).await? {
        return Err(setup_complete());
    }
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
        return Err(setup_complete());
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

/// Signs in with a username and password. Failures are counted per username
/// and per client address; past a limit the answer is 429 with
/// `Retry-After`, before any password is checked (see `throttle`).
#[utoipa::path(
    post,
    path = "/api/v1/session",
    request_body = LoginRequest,
    responses(
        (status = 200, body = SessionResponse),
        (status = 401, body = ErrorBody),
        (status = 429, body = ErrorBody, headers(
            ("Retry-After" = u64, description = "Seconds until the next try is allowed")
        ))
    )
)]
async fn login(
    State(state): State<AppState>,
    headers: HeaderMap,
    peer: Option<Extension<ConnectInfo<SocketAddr>>>,
    Json(request): Json<LoginRequest>,
) -> Result<Json<SessionResponse>, AppError> {
    let username = request.username.trim();
    // No account has a longer username or password; refusing them here keeps
    // huge values out of the throttle's keys and the password hash.
    if username.chars().count() > 100 || request.password.chars().count() > MAX_PASSWORD_CHARS {
        return Err(invalid_login());
    }
    let account = format!("sign-in:account:{}", username.to_lowercase());
    let client = format!(
        "sign-in:client:{}",
        throttle::client_address(
            state.client_ip_header.as_ref(),
            &headers,
            peer.map(|Extension(ConnectInfo(address))| address),
        )
    );
    let refused = |seconds| AppError::TooManyRequests {
        message: format!(
            "too many failed sign-ins; try again {}",
            throttle::wait_text(seconds)
        ),
        retry_after_seconds: seconds,
    };
    let client_attempt = state
        .throttle
        .attempt(&client, throttle::SIGN_IN_PER_CLIENT)
        .map_err(refused)?;
    if let Err(seconds) = state
        .throttle
        .attempt(&account, throttle::SIGN_IN_PER_ACCOUNT)
    {
        state.throttle.forgive(&client, client_attempt);
        return Err(refused(seconds));
    }

    let user = sqlx::query_as::<_, LoginRow>(
        "SELECT u.id AS user_id, u.display_name, u.password_hash,
                c.id AS church_id, c.name AS church_name, m.role
         FROM users u
         JOIN memberships m ON m.user_id = u.id
         JOIN churches c ON c.id = m.church_id
         WHERE lower(u.username) = lower($1) AND u.disabled_at IS NULL
           AND ($2::uuid IS NULL OR c.id = $2)
         ORDER BY c.created_at
         LIMIT 1",
    )
    .bind(username)
    .bind(request.church_id)
    .fetch_optional(&state.pool)
    .await?;
    // An unknown username takes as long to refuse as a wrong password, so
    // the timing does not tell which usernames exist.
    let verified = match &user {
        Some(user) => verify_password(request.password, user.password_hash.clone()).await?,
        None => {
            verify_password(request.password, unknown_user_hash().await?).await?;
            false
        }
    };
    // Both attempts already count as failures.
    let Some(user) = user.filter(|_| verified) else {
        return Err(invalid_login());
    };
    state.throttle.forgive(&client, client_attempt);
    state.throttle.clear(&account);

    Ok(Json(
        issue_session(&state.pool, state.session_hours, &user).await?,
    ))
}

/// A real Argon2 hash of a random password, made once, to check sign-ins
/// for unknown usernames against.
async fn unknown_user_hash() -> Result<String, AppError> {
    static HASH: tokio::sync::OnceCell<String> = tokio::sync::OnceCell::const_new();
    HASH.get_or_try_init(|| hash_password(Uuid::new_v4().to_string()))
        .await
        .cloned()
}

/// The signed-in church and its settings.
#[utoipa::path(
    get,
    path = "/api/v1/church",
    security(("bearer" = [])),
    responses((status = 200, body = ChurchSettings), (status = 401, body = ErrorBody))
)]
async fn get_church(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<ChurchSettings>, AppError> {
    let auth = authenticate(&headers, &state).await?;
    Ok(Json(
        sqlx::query_as::<_, ChurchSettings>(
            "SELECT id, name, public_library, public_rooms FROM churches WHERE id = $1",
        )
        .bind(auth.church_id)
        .fetch_one(&state.pool)
        .await?,
    ))
}

/// Renames the church, opens its library to everyone (read only), or opens or
/// closes its rooms. Fields left out stay as they are.
#[utoipa::path(
    put,
    path = "/api/v1/church",
    security(("bearer" = [])),
    request_body = UpdateChurchRequest,
    responses(
        (status = 200, body = ChurchSettings),
        (status = 400, body = ErrorBody),
        (status = 401, body = ErrorBody),
        (status = 403, body = ErrorBody)
    )
)]
async fn update_church(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(request): Json<UpdateChurchRequest>,
) -> Result<Json<ChurchSettings>, AppError> {
    let auth = authenticate(&headers, &state).await?;
    auth.require_owner()?;
    let name = request.name.as_deref().map(str::trim);
    if name.is_some_and(|name| name.is_empty() || name.chars().count() > 200) {
        return Err(AppError::BadRequest(
            "church name must contain 1 to 200 characters".into(),
        ));
    }
    let settings = sqlx::query_as::<_, ChurchSettings>(
        "UPDATE churches
         SET name = coalesce($1, name),
             public_library = coalesce($2, public_library),
             public_rooms = coalesce($3, public_rooms)
         WHERE id = $4
         RETURNING id, name, public_library, public_rooms",
    )
    .bind(name)
    .bind(request.public_library)
    .bind(request.public_rooms)
    .bind(auth.church_id)
    .fetch_one(&state.pool)
    .await?;
    if request.public_rooms.is_some() {
        state
            .remote
            .set_rooms_open(settings.id, settings.public_rooms);
    }
    Ok(Json(settings))
}

/// Makes a desktop token by hand.
///
/// For a desktop that cannot open a browser to sign in. The `psa_d_` token is
/// shown once.
#[utoipa::path(
    post,
    path = "/api/v1/device-tokens",
    security(("bearer" = [])),
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
    let name = validate_device_name(&request.name)?;
    let mut transaction = state.pool.begin().await?;
    let device = insert_device_token(&mut transaction, auth.church_id, user_id, name).await?;
    transaction.commit().await?;
    Ok((StatusCode::CREATED, Json(device)))
}

fn validate_device_name(name: &str) -> Result<&str, AppError> {
    let name = name.trim();
    if name.is_empty() || name.len() > 120 {
        return Err(AppError::BadRequest(
            "device name must contain 1 to 120 characters".into(),
        ));
    }
    Ok(name)
}

/// Issues a new desktop (`psa_d_`) token; only its hash is stored.
async fn insert_device_token(
    transaction: &mut Transaction<'_, Postgres>,
    church_id: Uuid,
    created_by: Uuid,
    name: &str,
) -> Result<DeviceTokenResponse, AppError> {
    let id = Uuid::new_v4();
    let token = new_token("psa_d_");
    let created_at = Utc::now();
    sqlx::query(
        "INSERT INTO device_tokens (id, church_id, name, token_hash, created_by, created_at)
         VALUES ($1, $2, $3, $4, $5, $6)",
    )
    .bind(id)
    .bind(church_id)
    .bind(name)
    .bind(hash_token(&token))
    .bind(created_by)
    .bind(created_at)
    .execute(&mut **transaction)
    .await?;
    let room_name = crate::rooms::assign_room_name(transaction, id, None).await?;
    Ok(DeviceTokenResponse {
        id,
        name: name.to_string(),
        token,
        created_at,
        room_name,
    })
}

/// How long a desktop sign-in code stays valid.
const DESKTOP_AUTH_CODE_MINUTES: i64 = 5;

/// A leader approves a desktop's browser sign-in.
///
/// Returns a one-time code, valid for five minutes, that the browser hands to
/// the desktop's loopback address. The desktop's PKCE `code_challenge` (S256)
/// ties the code to that desktop.
#[utoipa::path(
    post,
    path = "/api/v1/desktop-auth/codes",
    security(("bearer" = [])),
    request_body = CreateDesktopAuthCodeRequest,
    responses(
        (status = 201, body = DesktopAuthCodeResponse),
        (status = 400, body = ErrorBody),
        (status = 401, body = ErrorBody),
        (status = 403, body = ErrorBody)
    )
)]
async fn create_desktop_auth_code(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(request): Json<CreateDesktopAuthCodeRequest>,
) -> Result<impl IntoResponse, AppError> {
    let auth = authenticate(&headers, &state).await?;
    let user_id = auth.require_editor()?;
    let device_name = validate_device_name(&request.device_name)?;
    let challenge = request.code_challenge.as_str();
    let valid_challenge = (43..=128).contains(&challenge.len())
        && challenge
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_');
    if !valid_challenge {
        return Err(AppError::BadRequest(
            "code_challenge must be 43 to 128 base64url characters (S256)".into(),
        ));
    }

    let code = new_token("psa_c_");
    let expires_at = Utc::now() + chrono::Duration::minutes(DESKTOP_AUTH_CODE_MINUTES);
    sqlx::query(
        "INSERT INTO desktop_auth_codes
         (code_hash, church_id, user_id, device_name, code_challenge, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6)",
    )
    .bind(hash_token(&code))
    .bind(auth.church_id)
    .bind(user_id)
    .bind(device_name)
    .bind(challenge)
    .bind(expires_at)
    .execute(&state.pool)
    .await?;

    Ok((
        StatusCode::CREATED,
        Json(DesktopAuthCodeResponse { code, expires_at }),
    ))
}

#[derive(sqlx::FromRow)]
struct ConsumedCode {
    church_id: Uuid,
    user_id: Uuid,
    device_name: String,
    code_challenge: String,
}

/// A desktop trades its one-time sign-in code for a desktop token.
///
/// Send the code and the PKCE `code_verifier`. No bearer token is needed; each
/// code works once. The answer carries a `psa_d_` token and the desktop's room
/// name.
#[utoipa::path(
    post,
    path = "/api/v1/desktop-auth/token",
    request_body = DesktopTokenRequest,
    responses((status = 201, body = DesktopTokenResponse), (status = 400, body = ErrorBody))
)]
async fn exchange_desktop_auth_code(
    State(state): State<AppState>,
    Json(request): Json<DesktopTokenRequest>,
) -> Result<impl IntoResponse, AppError> {
    let invalid = || AppError::BadRequest("the sign-in code is invalid or has expired".into());

    // Burn the code in its own statement so it stays single use even when
    // the verifier below turns out to be wrong.
    let consumed = sqlx::query_as::<_, ConsumedCode>(
        "UPDATE desktop_auth_codes SET used_at = now()
         WHERE code_hash = $1 AND used_at IS NULL AND expires_at > now()
         RETURNING church_id, user_id, device_name, code_challenge",
    )
    .bind(hash_token(&request.code))
    .fetch_optional(&state.pool)
    .await?
    .ok_or_else(invalid)?;

    let expected = URL_SAFE_NO_PAD.encode(Sha256::digest(request.code_verifier.as_bytes()));
    if !constant_time_eq(expected.as_bytes(), consumed.code_challenge.as_bytes()) {
        return Err(invalid());
    }

    let mut transaction = state.pool.begin().await?;
    // The approving person must still be an active leader of the church.
    let church_name = sqlx::query_scalar::<_, String>(
        "SELECT c.name
         FROM memberships m
         JOIN users u ON u.id = m.user_id AND u.disabled_at IS NULL
         JOIN churches c ON c.id = m.church_id
         WHERE m.user_id = $1 AND m.church_id = $2 AND m.role IN ('owner', 'leader')",
    )
    .bind(consumed.user_id)
    .bind(consumed.church_id)
    .fetch_optional(&mut *transaction)
    .await?
    .ok_or_else(invalid)?;
    let device = insert_device_token(
        &mut transaction,
        consumed.church_id,
        consumed.user_id,
        &consumed.device_name,
    )
    .await?;
    transaction.commit().await?;

    Ok((
        StatusCode::CREATED,
        Json(DesktopTokenResponse {
            token: device.token,
            device_id: device.id,
            device_name: device.name,
            church_name,
            room_name: device.room_name,
        }),
    ))
}

fn constant_time_eq(left: &[u8], right: &[u8]) -> bool {
    left.len() == right.len()
        && left
            .iter()
            .zip(right)
            .fold(0u8, |difference, (a, b)| difference | (a ^ b))
            == 0
}

/// The church's connected desktops. Leaders and owners.
#[utoipa::path(
    get,
    path = "/api/v1/device-tokens",
    security(("bearer" = [])),
    responses((status = 200, body = [DeviceTokenSummary]), (status = 401, body = ErrorBody))
)]
async fn list_device_tokens(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Vec<DeviceTokenSummary>>, AppError> {
    let auth = authenticate(&headers, &state).await?;
    auth.require_editor()?;
    let devices = sqlx::query_as::<_, DeviceTokenSummary>(
        "SELECT id, name, created_at, last_used_at, room_name
         FROM device_tokens
         WHERE church_id = $1 AND revoked_at IS NULL
         ORDER BY lower(name), created_at",
    )
    .bind(auth.church_id)
    .fetch_all(&state.pool)
    .await?;
    Ok(Json(devices))
}

/// Revokes a desktop's token.
///
/// The desktop stops synchronizing, leaves the remote at once, and its room
/// name becomes free for another desktop.
#[utoipa::path(
    delete,
    path = "/api/v1/device-tokens/{device_id}",
    security(("bearer" = [])),
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
    // Off the remote list and out of its room at once.
    state.remote.forget(device_id);
    Ok(StatusCode::NO_CONTENT)
}

/// Searches the church's songs.
///
/// `q` matches the title, authors, song number and words; `key` and
/// `key_mode` keep only songs in those keys. Results come a page at a time
/// (`limit`, `offset`), by title, number or key; a page shorter than `limit`
/// is the last.
#[utoipa::path(
    get,
    path = "/api/v1/songs",
    security(("bearer" = [])),
    params(
        ("q" = Option<String>, Query),
        ("limit" = Option<i64>, Query),
        ("offset" = Option<i64>, Query),
        ("sort" = Option<SongSort>, Query),
        ("direction" = Option<SortDirection>, Query),
        ("key" = Option<String>, Query),
        ("key_mode" = Option<KeyMode>, Query)
    ),
    responses((status = 200, body = [SongSummary]), (status = 401, body = ErrorBody))
)]
async fn list_songs(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<SongQuery>,
) -> Result<Json<Vec<SongSummary>>, AppError> {
    let auth = authenticate(&headers, &state).await?;
    Ok(Json(
        search_songs(&state.pool, Library::Church(auth.church_id), query).await?,
    ))
}

/// Anyone: searches the public libraries.
///
/// The songs of churches that opened their library to everyone. Searching,
/// filtering, paging and sorting work as in `GET /songs`.
#[utoipa::path(
    get,
    path = "/api/v1/public/songs",
    params(
        ("q" = Option<String>, Query),
        ("limit" = Option<i64>, Query),
        ("offset" = Option<i64>, Query),
        ("sort" = Option<SongSort>, Query),
        ("direction" = Option<SortDirection>, Query),
        ("key" = Option<String>, Query),
        ("key_mode" = Option<KeyMode>, Query)
    ),
    responses((status = 200, body = [SongSummary]))
)]
async fn list_public_songs(
    State(state): State<AppState>,
    Query(query): Query<SongQuery>,
) -> Result<Json<Vec<SongSummary>>, AppError> {
    Ok(Json(
        search_songs(&state.pool, Library::Public, query).await?,
    ))
}

/// Anyone: a song from a public library, with its ChordPro text.
#[utoipa::path(
    get,
    path = "/api/v1/public/songs/{song_id}",
    params(("song_id" = Uuid, Path)),
    responses((status = 200, body = SongDetail), (status = 404, body = ErrorBody))
)]
async fn get_public_song(
    State(state): State<AppState>,
    Path(song_id): Path<Uuid>,
) -> Result<Json<SongDetail>, AppError> {
    let song = fetch_song(&state.pool, Library::Public, song_id)
        .await?
        .ok_or_else(|| AppError::NotFound("song was not found".into()))?;
    Ok(Json(song))
}

/// The keys the church's songs are in, with how many songs each.
///
/// For offering only the keys a key filter would find songs in. Songs
/// without a key, or whose key does not start with a note, are left out.
#[utoipa::path(
    get,
    path = "/api/v1/songs/keys",
    security(("bearer" = [])),
    responses((status = 200, body = [SongKeyCount]), (status = 401, body = ErrorBody))
)]
async fn list_song_keys(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Vec<SongKeyCount>>, AppError> {
    let auth = authenticate(&headers, &state).await?;
    Ok(Json(
        song_keys(&state.pool, Library::Church(auth.church_id)).await?,
    ))
}

/// Anyone: the keys the public libraries' songs are in.
///
/// As `GET /songs/keys`, for the songs of `GET /public/songs`.
#[utoipa::path(
    get,
    path = "/api/v1/public/songs/keys",
    responses((status = 200, body = [SongKeyCount]))
)]
async fn list_public_song_keys(
    State(state): State<AppState>,
) -> Result<Json<Vec<SongKeyCount>>, AppError> {
    Ok(Json(song_keys(&state.pool, Library::Public).await?))
}

async fn song_keys(pool: &PgPool, library: Library) -> Result<Vec<SongKeyCount>, AppError> {
    Ok(sqlx::query_as::<_, SongKeyCount>(&format!(
        "SELECT r.key_root AS root, r.key_minor AS minor, count(*) AS songs
         FROM songs s
         JOIN churches c ON c.id = s.church_id
         JOIN song_revisions r ON r.id = s.current_revision_id
         WHERE {LIBRARY_FILTER} AND r.key_root IS NOT NULL
         GROUP BY r.key_root, r.key_minor
         ORDER BY r.key_root, r.key_minor"
    ))
    .bind(library.church_id())
    .fetch_all(pool)
    .await?)
}

/// Which songs a read may see.
#[derive(Clone, Copy)]
pub(crate) enum Library {
    /// The signed-in caller's church.
    Church(Uuid),
    /// Every church whose owner made the library public; no sign-in.
    Public,
}

impl Library {
    /// Bound as `$1` next to the filter `LIBRARY_FILTER`.
    fn church_id(self) -> Option<Uuid> {
        match self {
            Self::Church(id) => Some(id),
            Self::Public => None,
        }
    }
}

/// `s` is the song and `c` its church; `$1` is `Library::church_id`.
const LIBRARY_FILTER: &str =
    "(s.church_id = $1 OR ($1::uuid IS NULL AND c.public_library)) AND s.deleted_at IS NULL";

/// `ORDER BY` for a song list. Built only from the two enums, never from
/// request text. Ties fall back to the title (always A to Z), then the newest
/// revision, then the id, so pages never overlap.
fn song_order(sort: SongSort, direction: SortDirection) -> String {
    let dir = match direction {
        SortDirection::Asc => "ASC",
        SortDirection::Desc => "DESC",
    };
    match sort {
        SongSort::Title => format!("lower(r.title) {dir}, r.created_at DESC, s.id"),
        // Like the desktop: songs without a number last in both directions;
        // numbers compared numerically ("9" before "10"), then as text ("12a").
        SongSort::Number => format!(
            "(r.song_number IS NULL) ASC,
             substring(r.song_number FROM '^\\d{{1,18}}')::bigint {dir} NULLS LAST,
             lower(r.song_number) {dir},
             lower(r.title) ASC, r.created_at DESC, s.id"
        ),
        // Tonic C to B (C# and Db together), major before minor; songs
        // without a key last in both directions.
        SongSort::Key => format!(
            "(r.key_root IS NULL) ASC, r.key_root {dir}, r.key_minor {dir},
             lower(r.title) ASC, r.created_at DESC, s.id"
        ),
    }
}

pub(crate) async fn search_songs(
    pool: &PgPool,
    library: Library,
    query: SongQuery,
) -> Result<Vec<SongSummary>, AppError> {
    let search = query.q.unwrap_or_default().trim().to_string();
    if search.chars().count() > MAX_SEARCH_CHARS {
        return Err(AppError::BadRequest(format!(
            "q must be at most {MAX_SEARCH_CHARS} characters"
        )));
    }
    let limit = query.limit.unwrap_or(100).clamp(1, 200);
    let offset = query.offset.unwrap_or(0).max(0);
    let order = song_order(
        query.sort.unwrap_or_default(),
        query.direction.unwrap_or_default(),
    );
    let keys = query
        .key
        .as_deref()
        .unwrap_or_default()
        .split(',')
        .map(str::trim)
        .filter(|key| !key.is_empty())
        .map(str::to_string)
        .collect::<Vec<_>>();
    if keys.len() > 24 || keys.iter().any(|key| key.chars().count() > 12) {
        return Err(AppError::BadRequest(
            "key must be at most 24 keys, separated by commas".into(),
        ));
    }
    // The tonics are read by the same function that fills `key_root`, so
    // `C#` finds songs in `Db`. A name that is not a note matches nothing.
    let key_filter = if keys.is_empty() {
        ""
    } else {
        "AND r.key_root IN (SELECT song_key_root(k) FROM unnest($5::text[]) AS k)"
    };
    let mode_filter = match query.key_mode {
        None => "",
        Some(KeyMode::Major) => "AND r.key_minor = false",
        Some(KeyMode::Minor) => "AND r.key_minor = true",
    };
    // Each a separate statement, so the database plans each on its own: the
    // trigram indexes (migration 0010) answer a search with a word of three
    // letters or digits. Without one they cannot narrow anything down, so the
    // ChordPro text, the large column, is left out; such a search would match
    // nearly every song's lyrics anyway.
    let matches = if search.is_empty() {
        ""
    } else if has_trigram(&search) {
        "AND (r.title ILIKE $4 OR r.authors ILIKE $4 OR r.song_number ILIKE $4
              OR r.chordpro ILIKE $4)"
    } else {
        "AND (r.title ILIKE $4 OR r.authors ILIKE $4 OR r.song_number ILIKE $4)"
    };

    let sql = format!(
        "SELECT s.id, r.id AS revision_id, r.title, r.song_number, r.authors,
                r.language, r.song_key, r.created_at AS updated_at
         FROM songs s
         JOIN churches c ON c.id = s.church_id
         JOIN song_revisions r ON r.id = s.current_revision_id
         WHERE {LIBRARY_FILTER} {matches} {key_filter} {mode_filter}
         ORDER BY {order}
         LIMIT $2 OFFSET $3"
    );
    let mut songs = sqlx::query_as::<_, SongSummary>(&sql)
        .bind(library.church_id())
        .bind(limit)
        .bind(offset);
    // `$4` is bound even without a search, so the keys are always `$5`.
    songs = songs.bind(format!("%{}%", escape_like(&search)));
    if !keys.is_empty() {
        songs = songs.bind(keys);
    }
    Ok(songs.fetch_all(pool).await?)
}

/// The longest song search accepted.
const MAX_SEARCH_CHARS: usize = 200;

/// Whether a search has a run of three letters or digits, the shortest a
/// trigram index can look up.
fn has_trigram(search: &str) -> bool {
    search
        .split(|c: char| !c.is_alphanumeric())
        .any(|word| word.chars().count() >= 3)
}

/// `%` and `_` match themselves, so a search cannot turn into a pattern that
/// matches everything and reads every song.
fn escape_like(search: &str) -> String {
    let mut escaped = String::with_capacity(search.len());
    for c in search.chars() {
        if matches!(c, '\\' | '%' | '_') {
            escaped.push('\\');
        }
        escaped.push(c);
    }
    escaped
}

/// Adds a song from its ChordPro text.
///
/// The title, authors, song number and other details are read from the ChordPro
/// directives. A song without a number gets the next free one, the highest in
/// the library plus one, added to its text as `{meta: song_num=N}`.
/// (`POST /songs/import` keeps songs as they are.)
#[utoipa::path(
    post,
    path = "/api/v1/songs",
    security(("bearer" = [])),
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

/// A song with its current ChordPro text.
#[utoipa::path(
    get,
    path = "/api/v1/songs/{song_id}",
    security(("bearer" = [])),
    params(("song_id" = Uuid, Path)),
    responses((status = 200, body = SongDetail), (status = 404, body = ErrorBody))
)]
async fn get_song(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(song_id): Path<Uuid>,
) -> Result<Json<SongDetail>, AppError> {
    let auth = authenticate(&headers, &state).await?;
    let song = fetch_song(&state.pool, Library::Church(auth.church_id), song_id)
        .await?
        .ok_or_else(|| AppError::NotFound("song was not found".into()))?;
    Ok(Json(song))
}

/// Saves a new revision of a song.
///
/// `base_revision_id` must be the song's current revision. If someone saved a
/// change in between, the answer is 409 and nothing is saved: read the song
/// again and redo the edit.
#[utoipa::path(
    put,
    path = "/api/v1/songs/{song_id}",
    security(("bearer" = [])),
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
        fetch_song(&state.pool, Library::Church(auth.church_id), song_id)
            .await?
            .ok_or_else(|| AppError::NotFound("song was not found".into()))?,
    ))
}

/// Deletes a song; it can be restored.
///
/// With `base_revision_id`, a song that changed since that revision is not
/// deleted (409).
#[utoipa::path(
    delete,
    path = "/api/v1/songs/{song_id}",
    security(("bearer" = [])),
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

/// Every saved revision of a song.
#[utoipa::path(
    get,
    path = "/api/v1/songs/{song_id}/revisions",
    security(("bearer" = [])),
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

/// One revision of a song with its full source: the current one or any
/// earlier one.
#[utoipa::path(
    get,
    path = "/api/v1/songs/{song_id}/revisions/{revision_id}",
    security(("bearer" = [])),
    params(("song_id" = Uuid, Path), ("revision_id" = Uuid, Path)),
    responses(
        (status = 200, body = RevisionDetail),
        (status = 401, body = ErrorBody),
        (status = 404, body = ErrorBody)
    )
)]
async fn get_revision(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path((song_id, revision_id)): Path<(Uuid, Uuid)>,
) -> Result<Json<RevisionDetail>, AppError> {
    let auth = authenticate(&headers, &state).await?;
    sqlx::query_as::<_, RevisionDetail>(
        "SELECT r.id, r.song_id, r.parent_revision_id, r.title, r.song_number, r.authors,
                r.language, r.chordpro, r.content_hash, r.created_at
         FROM song_revisions r
         JOIN songs s ON s.id = r.song_id
         WHERE r.id = $1 AND r.song_id = $2 AND s.church_id = $3 AND s.deleted_at IS NULL",
    )
    .bind(revision_id)
    .bind(song_id)
    .bind(auth.church_id)
    .fetch_optional(&state.pool)
    .await?
    .map(Json)
    .ok_or_else(|| AppError::NotFound("revision was not found".into()))
}

/// Deleted songs, most recently deleted first, to find one to restore.
#[utoipa::path(
    get,
    path = "/api/v1/songs/deleted",
    security(("bearer" = [])),
    params(PageQuery),
    responses((status = 200, body = [DeletedSong]), (status = 401, body = ErrorBody))
)]
async fn list_deleted_songs(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<PageQuery>,
) -> Result<Json<Vec<DeletedSong>>, AppError> {
    let auth = authenticate(&headers, &state).await?;
    Ok(Json(
        sqlx::query_as::<_, DeletedSong>(
            "SELECT s.id, r.id AS revision_id, r.title, r.song_number, r.authors, r.language,
                    s.deleted_at
             FROM songs s
             JOIN song_revisions r ON r.id = s.current_revision_id
             WHERE s.church_id = $1 AND s.deleted_at IS NOT NULL
             ORDER BY s.deleted_at DESC, s.id
             LIMIT $2 OFFSET $3",
        )
        .bind(auth.church_id)
        .bind(query.limit.unwrap_or(100).clamp(1, 200))
        .bind(query.offset.unwrap_or(0).max(0))
        .fetch_all(&state.pool)
        .await?,
    ))
}

/// Brings a deleted song back with its history. A song that is not deleted
/// is returned unchanged.
#[utoipa::path(
    post,
    path = "/api/v1/songs/{song_id}/restore",
    security(("bearer" = [])),
    params(("song_id" = Uuid, Path)),
    responses(
        (status = 200, body = SongDetail),
        (status = 401, body = ErrorBody),
        (status = 403, body = ErrorBody),
        (status = 404, body = ErrorBody)
    )
)]
async fn restore_song(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(song_id): Path<Uuid>,
) -> Result<Json<SongDetail>, AppError> {
    let auth = authenticate(&headers, &state).await?;
    auth.require_song_editor()?;
    sqlx::query(
        "UPDATE songs SET deleted_at = NULL, deleted_by = NULL, deleted_by_device = NULL
         WHERE id = $1 AND church_id = $2 AND deleted_at IS NOT NULL",
    )
    .bind(song_id)
    .bind(auth.church_id)
    .execute(&state.pool)
    .await?;
    fetch_song(&state.pool, Library::Church(auth.church_id), song_id)
        .await?
        .map(Json)
        .ok_or_else(|| AppError::NotFound("song was not found".into()))
}

/// Adds many songs at once from ChordPro files.
///
/// A file whose exact text is already in the library is skipped and counted in
/// `skipped_existing`.
#[utoipa::path(
    post,
    path = "/api/v1/songs/import",
    security(("bearer" = [])),
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

/// The church's whole library as a ZIP of ChordPro files.
///
/// `psa150-manifest.json` in the ZIP maps each file to its song.
#[utoipa::path(
    get,
    path = "/api/v1/songs/export",
    security(("bearer" = [])),
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

/// A new song (`POST /songs`). One without a number gets the next free one:
/// the highest number in the church's library (deleted songs too, so a
/// restored song keeps its own) plus one, written into the ChordPro as
/// `{meta: song_num=N}` like the desktop does. Imports keep what they have.
async fn insert_song(
    pool: &PgPool,
    church_id: Uuid,
    actor: Actor,
    source: String,
) -> Result<SongSummary, AppError> {
    let mut transaction = pool.begin().await?;
    let source = if chordpro::metadata(&source).song_number.is_none() {
        // One new number at a time per church, so two songs never get the same.
        sqlx::query_scalar::<_, Uuid>("SELECT id FROM churches WHERE id = $1 FOR UPDATE")
            .bind(church_id)
            .fetch_one(&mut *transaction)
            .await?;
        let next = sqlx::query_scalar::<_, i64>(
            "SELECT COALESCE(MAX(substring(r.song_number FROM '^\\d{1,18}')::bigint), 0) + 1
             FROM songs s
             JOIN song_revisions r ON r.id = s.current_revision_id
             WHERE s.church_id = $1",
        )
        .bind(church_id)
        .fetch_one(&mut *transaction)
        .await?;
        chordpro::with_song_number(&source, next)
    } else {
        source
    };
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
        song_key: parsed.song_key,
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
          chordpro, content_hash, created_by, created_by_device, created_at, song_key)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)",
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
    .bind(&revision.parsed.song_key)
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

pub(crate) async fn fetch_song(
    pool: &PgPool,
    library: Library,
    song_id: Uuid,
) -> Result<Option<SongDetail>, AppError> {
    Ok(sqlx::query_as::<_, SongDetail>(&format!(
        "SELECT s.id, r.id AS revision_id, r.parent_revision_id, r.title,
                r.song_number, r.authors, r.language, r.chordpro,
                r.content_hash, r.created_at AS updated_at
         FROM songs s
         JOIN churches c ON c.id = s.church_id
         JOIN song_revisions r ON r.id = s.current_revision_id
         WHERE {LIBRARY_FILTER} AND s.id = $2"
    ))
    .bind(library.church_id())
    .bind(song_id)
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
    validate_password(&request.password)
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

fn setup_complete() -> AppError {
    AppError::Conflict("server setup is already complete".into())
}

#[cfg(test)]
mod search_tests {
    use super::{escape_like, has_trigram};

    #[test]
    fn finds_a_word_the_index_can_look_up() {
        assert!(has_trigram("amazing gr"));
        assert!(has_trigram("Blå"));
        assert!(has_trigram("123"));
        assert!(!has_trigram("gr"));
        assert!(!has_trigram("o l m"));
        assert!(!has_trigram("%%%"));
        assert!(!has_trigram("---"));
    }

    #[test]
    fn escapes_like_wildcards() {
        assert_eq!(escape_like(r"100% _x\"), r"100\% \_x\\");
        assert_eq!(escape_like("grace"), "grace");
    }
}
