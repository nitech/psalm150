//! Who uses the API, and as whom: the caller's own token, passwords, API
//! tokens, and the people of a church.
//!
//! An API token (`psa_a_`) acts as the person who made it, with at most the
//! role it was made with, so a script or an integration can do through the
//! API whatever that person can do. Owners run the church: they add people,
//! change roles, reset passwords, disable and remove people, and see and
//! revoke everyone's API tokens.

use axum::{
    Json, Router,
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
    response::IntoResponse,
    routing::{delete, get, patch, put},
};
use chrono::{DateTime, Utc};
use sqlx::{FromRow, PgPool, Postgres, Transaction};
use uuid::Uuid;

use crate::{
    AppState,
    auth::{
        authenticate, hash_password, hash_token, new_token, role_from_db, validate_password,
        verify_password,
    },
    error::{AppError, ErrorBody},
    models::{
        ApiTokenResponse, ApiTokenSummary, ChangePasswordRequest, CreateApiTokenRequest,
        CreateMemberRequest, Member, Role, SessionInfo, TokenKind, UpdateMemberRequest,
    },
    throttle,
};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/session", get(current_session).delete(end_session))
        .route("/account/password", put(change_password))
        .route("/api-tokens", get(list_api_tokens).post(create_api_token))
        .route("/api-tokens/{token_id}", delete(revoke_api_token))
        .route("/members", get(list_members).post(create_member))
        .route(
            "/members/{user_id}",
            patch(update_member).delete(remove_member),
        )
}

#[derive(FromRow)]
struct PersonToken {
    /// Cleared when the person was removed from their last church.
    username: Option<String>,
    display_name: String,
    church_name: String,
    expires_at: Option<DateTime<Utc>>,
}

/// Who the token belongs to and what it may do.
#[utoipa::path(
    get,
    path = "/api/v1/session",
    security(("bearer" = [])),
    responses((status = 200, body = SessionInfo), (status = 401, body = ErrorBody))
)]
pub async fn current_session(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<SessionInfo>, AppError> {
    let auth = authenticate(&headers, &state).await?;
    let gone = || AppError::Unauthorized("the token was revoked".into());
    if auth.is_device() {
        let (device_name, church_name) = sqlx::query_as::<_, (String, String)>(
            "SELECT d.name, c.name FROM device_tokens d JOIN churches c ON c.id = d.church_id
             WHERE d.token_hash = $1",
        )
        .bind(&auth.token_hash)
        .fetch_optional(&state.pool)
        .await?
        .ok_or_else(gone)?;
        return Ok(Json(SessionInfo {
            kind: auth.kind,
            church_id: auth.church_id,
            church_name,
            role: None,
            user_id: None,
            username: None,
            display_name: None,
            device_id: auth.device_id,
            device_name: Some(device_name),
            expires_at: None,
        }));
    }

    let query = if auth.kind == TokenKind::Session {
        "SELECT u.username, u.display_name, c.name AS church_name, s.expires_at
         FROM sessions s JOIN users u ON u.id = s.user_id JOIN churches c ON c.id = s.church_id
         WHERE s.token_hash = $1"
    } else {
        "SELECT u.username, u.display_name, c.name AS church_name, t.expires_at
         FROM api_tokens t JOIN users u ON u.id = t.user_id JOIN churches c ON c.id = t.church_id
         WHERE t.token_hash = $1"
    };
    let person = sqlx::query_as::<_, PersonToken>(query)
        .bind(&auth.token_hash)
        .fetch_optional(&state.pool)
        .await?
        .ok_or_else(gone)?;
    Ok(Json(SessionInfo {
        kind: auth.kind,
        church_id: auth.church_id,
        church_name: person.church_name,
        role: Some(auth.role),
        user_id: auth.user_id,
        username: person.username,
        display_name: Some(person.display_name),
        device_id: None,
        device_name: None,
        expires_at: person.expires_at,
    }))
}

/// Signs out: the token that makes this request stops working, whatever its
/// kind. A desktop that disconnects revokes its own token this way.
#[utoipa::path(
    delete,
    path = "/api/v1/session",
    security(("bearer" = [])),
    responses((status = 204), (status = 401, body = ErrorBody))
)]
pub async fn end_session(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<StatusCode, AppError> {
    let auth = authenticate(&headers, &state).await?;
    let statement = match auth.kind {
        TokenKind::Session => "DELETE FROM sessions WHERE token_hash = $1",
        TokenKind::Api => {
            "UPDATE api_tokens SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL"
        }
        TokenKind::Desktop => {
            "UPDATE device_tokens SET revoked_at = now()
             WHERE token_hash = $1 AND revoked_at IS NULL"
        }
    };
    sqlx::query(statement)
        .bind(&auth.token_hash)
        .execute(&state.pool)
        .await?;
    Ok(StatusCode::NO_CONTENT)
}

/// Changes the caller's own password. The person's other sessions end; this
/// one and their API tokens keep working. Wrong current passwords are
/// limited per person like failed sign-ins (429 with `Retry-After`).
#[utoipa::path(
    put,
    path = "/api/v1/account/password",
    security(("bearer" = [])),
    request_body = ChangePasswordRequest,
    responses(
        (status = 204),
        (status = 400, body = ErrorBody),
        (status = 401, body = ErrorBody),
        (status = 403, body = ErrorBody),
        (status = 429, body = ErrorBody, headers(
            ("Retry-After" = u64, description = "Seconds until the next try is allowed")
        ))
    )
)]
pub async fn change_password(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(request): Json<ChangePasswordRequest>,
) -> Result<StatusCode, AppError> {
    let auth = authenticate(&headers, &state).await?;
    let user_id = auth.require_person()?;
    validate_password(&request.new_password)?;
    let key = format!("password:{user_id}");
    state
        .throttle
        .check(&key, throttle::PASSWORD_CHANGE)
        .map_err(|seconds| AppError::TooManyRequests {
            message: format!(
                "too many wrong passwords; try again {}",
                throttle::wait_text(seconds)
            ),
            retry_after_seconds: seconds,
        })?;
    let stored = sqlx::query_scalar::<_, String>("SELECT password_hash FROM users WHERE id = $1")
        .bind(user_id)
        .fetch_one(&state.pool)
        .await?;
    if !verify_password(request.current_password, stored).await? {
        state.throttle.fail(&key, throttle::PASSWORD_CHANGE);
        return Err(AppError::Forbidden(
            "the current password is incorrect".into(),
        ));
    }
    state.throttle.clear(&key);
    let password_hash = hash_password(request.new_password).await?;

    let mut transaction = state.pool.begin().await?;
    sqlx::query("UPDATE users SET password_hash = $1 WHERE id = $2")
        .bind(password_hash)
        .bind(user_id)
        .execute(&mut *transaction)
        .await?;
    end_sessions(&mut transaction, user_id, &auth.token_hash).await?;
    transaction.commit().await?;
    Ok(StatusCode::NO_CONTENT)
}

#[derive(FromRow)]
struct ApiTokenRow {
    id: Uuid,
    name: String,
    role: String,
    user_id: Uuid,
    user_display_name: String,
    created_at: DateTime<Utc>,
    expires_at: Option<DateTime<Utc>>,
    last_used_at: Option<DateTime<Utc>>,
}

/// The caller's active API tokens; an owner sees everyone's in the church.
#[utoipa::path(
    get,
    path = "/api/v1/api-tokens",
    security(("bearer" = [])),
    responses(
        (status = 200, body = [ApiTokenSummary]),
        (status = 401, body = ErrorBody),
        (status = 403, body = ErrorBody)
    )
)]
pub async fn list_api_tokens(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Vec<ApiTokenSummary>>, AppError> {
    let auth = authenticate(&headers, &state).await?;
    let user_id = auth.require_person()?;
    let rows = sqlx::query_as::<_, ApiTokenRow>(
        "SELECT t.id, t.name, t.role, t.user_id, u.display_name AS user_display_name,
                t.created_at, t.expires_at, t.last_used_at
         FROM api_tokens t
         JOIN users u ON u.id = t.user_id
         WHERE t.church_id = $1 AND ($3 OR t.user_id = $2)
           AND t.revoked_at IS NULL AND (t.expires_at IS NULL OR t.expires_at > now())
         ORDER BY lower(t.name), t.created_at",
    )
    .bind(auth.church_id)
    .bind(user_id)
    .bind(auth.role == Role::Owner)
    .fetch_all(&state.pool)
    .await?;
    rows.into_iter()
        .map(|row| {
            Ok(ApiTokenSummary {
                id: row.id,
                name: row.name,
                role: role_from_db(&row.role)?,
                user_id: row.user_id,
                user_display_name: row.user_display_name,
                created_at: row.created_at,
                expires_at: row.expires_at,
                last_used_at: row.last_used_at,
            })
        })
        .collect::<Result<Vec<_>, AppError>>()
        .map(Json)
}

/// Makes an API token that acts as the caller, with at most their role.
#[utoipa::path(
    post,
    path = "/api/v1/api-tokens",
    security(("bearer" = [])),
    request_body = CreateApiTokenRequest,
    responses(
        (status = 201, body = ApiTokenResponse),
        (status = 400, body = ErrorBody),
        (status = 401, body = ErrorBody),
        (status = 403, body = ErrorBody)
    )
)]
pub async fn create_api_token(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(request): Json<CreateApiTokenRequest>,
) -> Result<impl IntoResponse, AppError> {
    let auth = authenticate(&headers, &state).await?;
    let user_id = auth.require_person()?;
    let name = trimmed(&request.name, "token name", 120)?;
    let role = request.role.unwrap_or(auth.role);
    if !auth.role.includes(role) {
        return Err(AppError::BadRequest(
            "a token cannot have more access than the person making it".into(),
        ));
    }
    let created_at = Utc::now();
    if request
        .expires_at
        .is_some_and(|expires_at| expires_at <= created_at)
    {
        return Err(AppError::BadRequest(
            "expires_at must be in the future".into(),
        ));
    }

    let id = Uuid::new_v4();
    let token = new_token("psa_a_");
    sqlx::query(
        "INSERT INTO api_tokens
         (id, user_id, church_id, name, role, token_hash, created_at, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
    )
    .bind(id)
    .bind(user_id)
    .bind(auth.church_id)
    .bind(name)
    .bind(role.as_db())
    .bind(hash_token(&token))
    .bind(created_at)
    .bind(request.expires_at)
    .execute(&state.pool)
    .await?;

    Ok((
        StatusCode::CREATED,
        Json(ApiTokenResponse {
            id,
            name: name.to_string(),
            role,
            token,
            created_at,
            expires_at: request.expires_at,
        }),
    ))
}

/// Revokes one of the caller's API tokens; an owner may revoke anyone's.
#[utoipa::path(
    delete,
    path = "/api/v1/api-tokens/{token_id}",
    security(("bearer" = [])),
    params(("token_id" = Uuid, Path)),
    responses(
        (status = 204),
        (status = 401, body = ErrorBody),
        (status = 403, body = ErrorBody),
        (status = 404, body = ErrorBody)
    )
)]
pub async fn revoke_api_token(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(token_id): Path<Uuid>,
) -> Result<StatusCode, AppError> {
    let auth = authenticate(&headers, &state).await?;
    let user_id = auth.require_person()?;
    let result = sqlx::query(
        "UPDATE api_tokens SET revoked_at = now()
         WHERE id = $1 AND church_id = $2 AND ($4 OR user_id = $3) AND revoked_at IS NULL",
    )
    .bind(token_id)
    .bind(auth.church_id)
    .bind(user_id)
    .bind(auth.role == Role::Owner)
    .execute(&state.pool)
    .await?;
    if result.rows_affected() == 0 {
        return Err(AppError::NotFound("API token was not found".into()));
    }
    Ok(StatusCode::NO_CONTENT)
}

#[derive(FromRow)]
struct MemberRow {
    user_id: Uuid,
    username: String,
    display_name: String,
    role: String,
    disabled: bool,
    created_at: DateTime<Utc>,
}

impl MemberRow {
    fn into_member(self) -> Result<Member, AppError> {
        Ok(Member {
            user_id: self.user_id,
            username: self.username,
            display_name: self.display_name,
            role: role_from_db(&self.role)?,
            disabled: self.disabled,
            created_at: self.created_at,
        })
    }
}

/// `u` is the user and `m` their membership.
const MEMBER_COLUMNS: &str = "u.id AS user_id, u.username, u.display_name, m.role,
     u.disabled_at IS NOT NULL AS disabled, m.created_at";

/// Owners: the church's people and their roles.
#[utoipa::path(
    get,
    path = "/api/v1/members",
    security(("bearer" = [])),
    responses(
        (status = 200, body = [Member]),
        (status = 401, body = ErrorBody),
        (status = 403, body = ErrorBody)
    )
)]
pub async fn list_members(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Vec<Member>>, AppError> {
    let auth = authenticate(&headers, &state).await?;
    auth.require_owner()?;
    sqlx::query_as::<_, MemberRow>(&format!(
        "SELECT {MEMBER_COLUMNS}
         FROM memberships m JOIN users u ON u.id = m.user_id
         WHERE m.church_id = $1
         ORDER BY lower(u.display_name), lower(u.username)"
    ))
    .bind(auth.church_id)
    .fetch_all(&state.pool)
    .await?
    .into_iter()
    .map(MemberRow::into_member)
    .collect::<Result<Vec<_>, AppError>>()
    .map(Json)
}

/// Adds a person to the church with a new account.
#[utoipa::path(
    post,
    path = "/api/v1/members",
    security(("bearer" = [])),
    request_body = CreateMemberRequest,
    responses(
        (status = 201, body = Member),
        (status = 400, body = ErrorBody),
        (status = 401, body = ErrorBody),
        (status = 403, body = ErrorBody),
        (status = 409, body = ErrorBody)
    )
)]
pub async fn create_member(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(request): Json<CreateMemberRequest>,
) -> Result<impl IntoResponse, AppError> {
    let auth = authenticate(&headers, &state).await?;
    auth.require_owner()?;
    let username = trimmed(&request.username, "username", 100)?;
    let display_name = trimmed(&request.display_name, "name", 120)?;
    validate_password(&request.password)?;
    let password_hash = hash_password(request.password).await?;
    let user_id = Uuid::new_v4();

    let mut transaction = state.pool.begin().await?;
    sqlx::query(
        "INSERT INTO users (id, display_name, username, password_hash) VALUES ($1, $2, $3, $4)",
    )
    .bind(user_id)
    .bind(display_name)
    .bind(username)
    .bind(password_hash)
    .execute(&mut *transaction)
    .await
    .map_err(username_taken)?;
    sqlx::query("INSERT INTO memberships (user_id, church_id, role) VALUES ($1, $2, $3)")
        .bind(user_id)
        .bind(auth.church_id)
        .bind(request.role.as_db())
        .execute(&mut *transaction)
        .await?;
    transaction.commit().await?;

    let member = fetch_member(&state.pool, auth.church_id, user_id).await?;
    Ok((StatusCode::CREATED, Json(member)))
}

/// Changes a person's role or account. Their name, username, password and
/// whether they are disabled belong to the account, which an owner changes
/// only when the person belongs to no other church.
#[utoipa::path(
    patch,
    path = "/api/v1/members/{user_id}",
    security(("bearer" = [])),
    params(("user_id" = Uuid, Path)),
    request_body = UpdateMemberRequest,
    responses(
        (status = 200, body = Member),
        (status = 400, body = ErrorBody),
        (status = 401, body = ErrorBody),
        (status = 403, body = ErrorBody),
        (status = 404, body = ErrorBody),
        (status = 409, body = ErrorBody)
    )
)]
pub async fn update_member(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(user_id): Path<Uuid>,
    Json(request): Json<UpdateMemberRequest>,
) -> Result<Json<Member>, AppError> {
    let auth = authenticate(&headers, &state).await?;
    auth.require_owner()?;
    let display_name = request
        .display_name
        .as_deref()
        .map(|name| trimmed(name, "name", 120))
        .transpose()?;
    let username = request
        .username
        .as_deref()
        .map(|name| trimmed(name, "username", 100))
        .transpose()?;
    let password_hash = match request.password {
        Some(password) => {
            validate_password(&password)?;
            Some(hash_password(password).await?)
        }
        None => None,
    };

    let mut transaction = state.pool.begin().await?;
    let current = lock_member(&mut transaction, auth.church_id, user_id).await?;
    let role = request.role.unwrap_or(current.role);
    let disabled = request.disabled.unwrap_or(current.disabled);
    let account_change = display_name.is_some()
        || username.is_some()
        || password_hash.is_some()
        || disabled != current.disabled;
    if account_change && in_another_church(&mut transaction, auth.church_id, user_id).await? {
        return Err(AppError::Forbidden(
            "this person also belongs to another church, so only their role here can change".into(),
        ));
    }
    if current.is_active_owner() && (role != Role::Owner || disabled) {
        ensure_another_owner(&mut transaction, auth.church_id, user_id).await?;
    }

    sqlx::query("UPDATE memberships SET role = $3 WHERE user_id = $1 AND church_id = $2")
        .bind(user_id)
        .bind(auth.church_id)
        .bind(role.as_db())
        .execute(&mut *transaction)
        .await?;
    if account_change {
        sqlx::query(
            "UPDATE users
             SET display_name = coalesce($2, display_name),
                 username = coalesce($3, username),
                 password_hash = coalesce($4, password_hash),
                 disabled_at = CASE WHEN $5 THEN coalesce(disabled_at, now()) END
             WHERE id = $1",
        )
        .bind(user_id)
        .bind(display_name)
        .bind(username)
        .bind(&password_hash)
        .bind(disabled)
        .execute(&mut *transaction)
        .await
        .map_err(username_taken)?;
    }
    if password_hash.is_some() || (disabled && !current.disabled) {
        end_sessions(&mut transaction, user_id, &auth.token_hash).await?;
    }
    if disabled && !current.disabled {
        sqlx::query(
            "UPDATE api_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL",
        )
        .bind(user_id)
        .execute(&mut *transaction)
        .await?;
    }
    transaction.commit().await?;

    Ok(Json(
        fetch_member(&state.pool, auth.church_id, user_id).await?,
    ))
}

/// Removes a person from the church: their sessions there end and their API
/// tokens there are revoked. An account left in no church is kept, disabled
/// and without a username: the revisions and sets they saved still record who
/// saved them, and the username can be given to someone else.
#[utoipa::path(
    delete,
    path = "/api/v1/members/{user_id}",
    security(("bearer" = [])),
    params(("user_id" = Uuid, Path)),
    responses(
        (status = 204),
        (status = 401, body = ErrorBody),
        (status = 403, body = ErrorBody),
        (status = 404, body = ErrorBody),
        (status = 409, body = ErrorBody)
    )
)]
pub async fn remove_member(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(user_id): Path<Uuid>,
) -> Result<StatusCode, AppError> {
    let auth = authenticate(&headers, &state).await?;
    auth.require_owner()?;
    let mut transaction = state.pool.begin().await?;
    let current = lock_member(&mut transaction, auth.church_id, user_id).await?;
    if current.is_active_owner() {
        ensure_another_owner(&mut transaction, auth.church_id, user_id).await?;
    }
    for statement in [
        "DELETE FROM memberships WHERE user_id = $1 AND church_id = $2",
        "DELETE FROM sessions WHERE user_id = $1 AND church_id = $2",
        "UPDATE api_tokens SET revoked_at = now()
         WHERE user_id = $1 AND church_id = $2 AND revoked_at IS NULL",
    ] {
        sqlx::query(statement)
            .bind(user_id)
            .bind(auth.church_id)
            .execute(&mut *transaction)
            .await?;
    }
    sqlx::query(
        "UPDATE users SET disabled_at = coalesce(disabled_at, now()), username = NULL
         WHERE id = $1 AND NOT EXISTS (SELECT 1 FROM memberships WHERE user_id = $1)",
    )
    .bind(user_id)
    .execute(&mut *transaction)
    .await?;
    transaction.commit().await?;
    Ok(StatusCode::NO_CONTENT)
}

struct CurrentMember {
    role: Role,
    disabled: bool,
}

impl CurrentMember {
    fn is_active_owner(&self) -> bool {
        self.role == Role::Owner && !self.disabled
    }
}

/// Locks the church for the rest of the transaction, so changes to its
/// people happen one at a time (two owners cannot each demote the other),
/// and reads the person's membership.
async fn lock_member(
    transaction: &mut Transaction<'_, Postgres>,
    church_id: Uuid,
    user_id: Uuid,
) -> Result<CurrentMember, AppError> {
    sqlx::query("SELECT id FROM churches WHERE id = $1 FOR UPDATE")
        .bind(church_id)
        .execute(&mut **transaction)
        .await?;
    let (role, disabled) = sqlx::query_as::<_, (String, bool)>(
        "SELECT m.role, u.disabled_at IS NOT NULL
         FROM memberships m JOIN users u ON u.id = m.user_id
         WHERE m.user_id = $1 AND m.church_id = $2",
    )
    .bind(user_id)
    .bind(church_id)
    .fetch_optional(&mut **transaction)
    .await?
    .ok_or_else(member_not_found)?;
    Ok(CurrentMember {
        role: role_from_db(&role)?,
        disabled,
    })
}

async fn ensure_another_owner(
    transaction: &mut Transaction<'_, Postgres>,
    church_id: Uuid,
    user_id: Uuid,
) -> Result<(), AppError> {
    let others = sqlx::query_scalar::<_, i64>(
        "SELECT count(*)
         FROM memberships m JOIN users u ON u.id = m.user_id AND u.disabled_at IS NULL
         WHERE m.church_id = $1 AND m.role = 'owner' AND m.user_id <> $2",
    )
    .bind(church_id)
    .bind(user_id)
    .fetch_one(&mut **transaction)
    .await?;
    if others == 0 {
        return Err(AppError::Conflict(
            "the church needs at least one owner who is not disabled".into(),
        ));
    }
    Ok(())
}

async fn in_another_church(
    transaction: &mut Transaction<'_, Postgres>,
    church_id: Uuid,
    user_id: Uuid,
) -> Result<bool, AppError> {
    Ok(sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS (SELECT 1 FROM memberships WHERE user_id = $1 AND church_id <> $2)",
    )
    .bind(user_id)
    .bind(church_id)
    .fetch_one(&mut **transaction)
    .await?)
}

/// Signs the person out everywhere except with the token making the request.
async fn end_sessions(
    transaction: &mut Transaction<'_, Postgres>,
    user_id: Uuid,
    keep_token_hash: &str,
) -> Result<(), AppError> {
    sqlx::query("DELETE FROM sessions WHERE user_id = $1 AND token_hash <> $2")
        .bind(user_id)
        .bind(keep_token_hash)
        .execute(&mut **transaction)
        .await?;
    Ok(())
}

async fn fetch_member(pool: &PgPool, church_id: Uuid, user_id: Uuid) -> Result<Member, AppError> {
    sqlx::query_as::<_, MemberRow>(&format!(
        "SELECT {MEMBER_COLUMNS}
         FROM memberships m JOIN users u ON u.id = m.user_id
         WHERE m.church_id = $1 AND m.user_id = $2"
    ))
    .bind(church_id)
    .bind(user_id)
    .fetch_optional(pool)
    .await?
    .ok_or_else(member_not_found)?
    .into_member()
}

fn member_not_found() -> AppError {
    AppError::NotFound("member was not found".into())
}

fn username_taken(error: sqlx::Error) -> AppError {
    match &error {
        sqlx::Error::Database(database) if database.is_unique_violation() => {
            AppError::Conflict("that username is already taken".into())
        }
        _ => AppError::Database(error),
    }
}

/// `value` trimmed, which must hold 1 to `max` characters.
fn trimmed<'a>(value: &'a str, what: &str, max: usize) -> Result<&'a str, AppError> {
    let value = value.trim();
    if value.is_empty() || value.chars().count() > max {
        return Err(AppError::BadRequest(format!(
            "{what} must contain 1 to {max} characters"
        )));
    }
    Ok(value)
}
