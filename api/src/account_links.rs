//! Account links: an owner sends a one-time link instead of choosing
//! someone's password.
//!
//! An invite lets a new person pick their own username and password and
//! joins them to the church with the role the owner chose. A reset link lets
//! one person choose a new password; it ends their other sessions. Either
//! link signs the person in when it is used, works once, and stops working
//! when it expires or the owner revokes it. Only the token's SHA-256 hash is
//! stored, and the tokens are long random strings, so they are not throttled.

use axum::{
    Json, Router,
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
    response::IntoResponse,
    routing::{delete, get, post},
};
use chrono::{DateTime, Duration, Utc};
use sqlx::FromRow;
use uuid::Uuid;

use crate::{
    AppState,
    access::{in_another_church, trimmed, username_taken},
    auth::{
        LoginRow, authenticate, hash_password, hash_token, issue_session, new_token, role_from_db,
        validate_password,
    },
    error::{AppError, ErrorBody},
    models::{
        AccountLink, AccountLinkKind, AccountLinkResponse, CreateInviteRequest, PublicAccountLink,
        Role, SessionResponse, UseAccountLinkRequest,
    },
};

/// How long an invite works.
const INVITE_DAYS: i64 = 7;
/// How long a reset link works.
const RESET_DAYS: i64 = 3;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/members/links", get(list_account_links))
        .route("/members/links/{link_id}", delete(revoke_account_link))
        .route("/members/invites", post(create_invite))
        .route("/members/{user_id}/reset-link", post(create_reset_link))
        .route(
            "/public/account-links/{token}",
            get(get_account_link).post(use_account_link),
        )
}

#[derive(FromRow)]
struct LinkRow {
    id: Uuid,
    kind: String,
    role: Option<String>,
    display_name: Option<String>,
    user_id: Option<Uuid>,
    created_at: DateTime<Utc>,
    expires_at: DateTime<Utc>,
}

impl LinkRow {
    fn into_link(self) -> Result<AccountLink, AppError> {
        Ok(AccountLink {
            id: self.id,
            kind: kind_from_db(&self.kind)?,
            role: self.role.as_deref().map(role_from_db).transpose()?,
            display_name: self.display_name,
            user_id: self.user_id,
            created_at: self.created_at,
            expires_at: self.expires_at,
        })
    }
}

fn kind_from_db(value: &str) -> Result<AccountLinkKind, AppError> {
    match value {
        "invite" => Ok(AccountLinkKind::Invite),
        "reset" => Ok(AccountLinkKind::Reset),
        _ => Err(AppError::Internal("unknown account link kind".into())),
    }
}

/// `l` is the link; a reset shows the person's current name.
const LINK_COLUMNS: &str =
    "l.id, l.kind, l.role, coalesce(u.display_name, l.display_name) AS display_name,
     l.user_id, l.created_at, l.expires_at";

/// A link that may still be used.
const USABLE: &str = "l.used_at IS NULL AND l.revoked_at IS NULL AND l.expires_at > now()";

/// Owners: the invites and reset links not used yet.
#[utoipa::path(
    get,
    path = "/api/v1/members/links",
    security(("bearer" = [])),
    responses(
        (status = 200, body = [AccountLink]),
        (status = 401, body = ErrorBody),
        (status = 403, body = ErrorBody)
    )
)]
pub async fn list_account_links(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Vec<AccountLink>>, AppError> {
    let auth = authenticate(&headers, &state).await?;
    auth.require_owner()?;
    sqlx::query_as::<_, LinkRow>(&format!(
        "SELECT {LINK_COLUMNS}
         FROM account_links l LEFT JOIN users u ON u.id = l.user_id
         WHERE l.church_id = $1 AND {USABLE}
         ORDER BY l.created_at DESC"
    ))
    .bind(auth.church_id)
    .fetch_all(&state.pool)
    .await?
    .into_iter()
    .map(LinkRow::into_link)
    .collect::<Result<Vec<_>, AppError>>()
    .map(Json)
}

/// Invites a new person with a link. They choose their own username and
/// password when they open it, and join with `role`. Works once, for 7 days.
#[utoipa::path(
    post,
    path = "/api/v1/members/invites",
    security(("bearer" = [])),
    request_body = CreateInviteRequest,
    responses(
        (status = 201, body = AccountLinkResponse),
        (status = 400, body = ErrorBody),
        (status = 401, body = ErrorBody),
        (status = 403, body = ErrorBody)
    )
)]
pub async fn create_invite(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(request): Json<CreateInviteRequest>,
) -> Result<impl IntoResponse, AppError> {
    let auth = authenticate(&headers, &state).await?;
    let owner_id = auth.require_owner()?;
    let display_name = request
        .display_name
        .as_deref()
        .map(str::trim)
        .filter(|name| !name.is_empty())
        .map(|name| trimmed(name, "name", 120))
        .transpose()?;
    let token = new_token("psa_i_");
    let link = sqlx::query_as::<_, LinkRow>(
        "INSERT INTO account_links (id, kind, church_id, token_hash, role, display_name, created_by, expires_at)
         VALUES ($1, 'invite', $2, $3, $4, $5, $6, $7)
         RETURNING id, kind, role, display_name, user_id, created_at, expires_at",
    )
    .bind(Uuid::new_v4())
    .bind(auth.church_id)
    .bind(hash_token(&token))
    .bind(request.role.as_db())
    .bind(display_name)
    .bind(owner_id)
    .bind(Utc::now() + Duration::days(INVITE_DAYS))
    .fetch_one(&state.pool)
    .await?
    .into_link()?;
    Ok((
        StatusCode::CREATED,
        Json(AccountLinkResponse {
            link,
            path: format!("/invite/{token}"),
            token,
        }),
    ))
}

/// Makes a link with which a person chooses a new password, instead of an
/// owner choosing it. Works once, for 3 days; an earlier reset link for them
/// stops working. Not for yourself (use `PUT /account/password`) or someone
/// who also belongs to another church.
#[utoipa::path(
    post,
    path = "/api/v1/members/{user_id}/reset-link",
    security(("bearer" = [])),
    params(("user_id" = Uuid, Path)),
    responses(
        (status = 201, body = AccountLinkResponse),
        (status = 401, body = ErrorBody),
        (status = 403, body = ErrorBody),
        (status = 404, body = ErrorBody),
        (status = 409, body = ErrorBody)
    )
)]
pub async fn create_reset_link(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(user_id): Path<Uuid>,
) -> Result<impl IntoResponse, AppError> {
    let auth = authenticate(&headers, &state).await?;
    let owner_id = auth.require_owner()?;
    if user_id == owner_id {
        return Err(AppError::Forbidden(
            "change your own password with PUT /api/v1/account/password".into(),
        ));
    }
    let mut transaction = state.pool.begin().await?;
    let disabled = sqlx::query_scalar::<_, bool>(
        "SELECT u.disabled_at IS NOT NULL
         FROM memberships m JOIN users u ON u.id = m.user_id
         WHERE m.user_id = $1 AND m.church_id = $2",
    )
    .bind(user_id)
    .bind(auth.church_id)
    .fetch_optional(&mut *transaction)
    .await?
    .ok_or_else(|| AppError::NotFound("member was not found".into()))?;
    if in_another_church(&mut transaction, auth.church_id, user_id).await? {
        return Err(AppError::Forbidden(
            "this person also belongs to another church, so only their role here can change".into(),
        ));
    }
    if disabled {
        return Err(AppError::Conflict(
            "this person cannot sign in; let them sign in again first".into(),
        ));
    }
    sqlx::query(
        "UPDATE account_links SET revoked_at = now()
         WHERE kind = 'reset' AND user_id = $1 AND used_at IS NULL AND revoked_at IS NULL",
    )
    .bind(user_id)
    .execute(&mut *transaction)
    .await?;
    let token = new_token("psa_r_");
    let id = sqlx::query_scalar::<_, Uuid>(
        "INSERT INTO account_links (id, kind, church_id, token_hash, user_id, created_by, expires_at)
         VALUES ($1, 'reset', $2, $3, $4, $5, $6)
         RETURNING id",
    )
    .bind(Uuid::new_v4())
    .bind(auth.church_id)
    .bind(hash_token(&token))
    .bind(user_id)
    .bind(owner_id)
    .bind(Utc::now() + Duration::days(RESET_DAYS))
    .fetch_one(&mut *transaction)
    .await?;
    let link = sqlx::query_as::<_, LinkRow>(&format!(
        "SELECT {LINK_COLUMNS} FROM account_links l LEFT JOIN users u ON u.id = l.user_id
         WHERE l.id = $1"
    ))
    .bind(id)
    .fetch_one(&mut *transaction)
    .await?
    .into_link()?;
    transaction.commit().await?;
    Ok((
        StatusCode::CREATED,
        Json(AccountLinkResponse {
            link,
            path: format!("/reset-password/{token}"),
            token,
        }),
    ))
}

/// Revokes an invite or reset link that has not been used.
#[utoipa::path(
    delete,
    path = "/api/v1/members/links/{link_id}",
    security(("bearer" = [])),
    params(("link_id" = Uuid, Path)),
    responses(
        (status = 204),
        (status = 401, body = ErrorBody),
        (status = 403, body = ErrorBody),
        (status = 404, body = ErrorBody)
    )
)]
pub async fn revoke_account_link(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(link_id): Path<Uuid>,
) -> Result<StatusCode, AppError> {
    let auth = authenticate(&headers, &state).await?;
    auth.require_owner()?;
    let result = sqlx::query(
        "UPDATE account_links SET revoked_at = now()
         WHERE id = $1 AND church_id = $2 AND used_at IS NULL AND revoked_at IS NULL",
    )
    .bind(link_id)
    .bind(auth.church_id)
    .execute(&state.pool)
    .await?;
    if result.rows_affected() == 0 {
        return Err(AppError::NotFound("link was not found".into()));
    }
    Ok(StatusCode::NO_CONTENT)
}

#[derive(FromRow)]
struct OpenLink {
    id: Uuid,
    kind: String,
    church_id: Uuid,
    church_name: String,
    role: Option<String>,
    display_name: Option<String>,
    user_id: Option<Uuid>,
    username: Option<String>,
    expires_at: DateTime<Utc>,
}

/// A usable link by its token. A reset link stops working when its person
/// is disabled or no longer in the church.
async fn open_link<'e, E: sqlx::PgExecutor<'e>>(
    executor: E,
    token: &str,
    lock: bool,
) -> Result<OpenLink, AppError> {
    sqlx::query_as::<_, OpenLink>(&format!(
        "SELECT l.id, l.kind, l.church_id, c.name AS church_name, l.role,
                coalesce(u.display_name, l.display_name) AS display_name,
                l.user_id, u.username, l.expires_at
         FROM account_links l
         JOIN churches c ON c.id = l.church_id
         LEFT JOIN users u ON u.id = l.user_id
         WHERE l.token_hash = $1 AND {USABLE}
           AND (l.kind = 'invite' OR (u.disabled_at IS NULL AND EXISTS (
                SELECT 1 FROM memberships m WHERE m.user_id = l.user_id AND m.church_id = l.church_id)))
         {}",
        if lock { "FOR UPDATE OF l" } else { "" }
    ))
    .bind(hash_token(token))
    .fetch_optional(executor)
    .await?
    .ok_or_else(|| {
        AppError::NotFound("this link does not work: it was used, has expired or was revoked".into())
    })
}

/// What an invite or reset link is for. 404 when it was used, has expired
/// or was revoked.
#[utoipa::path(
    get,
    path = "/api/v1/public/account-links/{token}",
    params(("token" = String, Path)),
    responses((status = 200, body = PublicAccountLink), (status = 404, body = ErrorBody))
)]
pub async fn get_account_link(
    State(state): State<AppState>,
    Path(token): Path<String>,
) -> Result<Json<PublicAccountLink>, AppError> {
    let link = open_link(&state.pool, &token, false).await?;
    Ok(Json(PublicAccountLink {
        kind: kind_from_db(&link.kind)?,
        church_name: link.church_name,
        display_name: link.display_name,
        username: link.username,
        role: link.role.as_deref().map(role_from_db).transpose()?,
        expires_at: link.expires_at,
    }))
}

/// Uses an invite or reset link and signs the person in.
///
/// An invite needs a `username` (and a name, unless the owner gave one) and
/// makes the account; a reset sets the new password and ends the person's
/// other sessions. The link stops working.
#[utoipa::path(
    post,
    path = "/api/v1/public/account-links/{token}",
    params(("token" = String, Path)),
    request_body = UseAccountLinkRequest,
    responses(
        (status = 200, body = SessionResponse),
        (status = 400, body = ErrorBody),
        (status = 404, body = ErrorBody),
        (status = 409, body = ErrorBody)
    )
)]
pub async fn use_account_link(
    State(state): State<AppState>,
    Path(token): Path<String>,
    Json(request): Json<UseAccountLinkRequest>,
) -> Result<Json<SessionResponse>, AppError> {
    // Look before any password work, so a dead link costs nothing.
    let first = open_link(&state.pool, &token, false).await?;
    let invite = kind_from_db(&first.kind)? == AccountLinkKind::Invite;
    let username = if invite {
        Some(trimmed(
            request.username.as_deref().unwrap_or_default(),
            "username",
            100,
        )?)
    } else {
        None
    };
    let display_name = if invite {
        let name = request
            .display_name
            .as_deref()
            .map(str::trim)
            .filter(|name| !name.is_empty())
            .or(first.display_name.as_deref())
            .unwrap_or_default();
        Some(trimmed(name, "name", 120)?.to_string())
    } else {
        None
    };
    validate_password(&request.password)?;
    let password_hash = hash_password(request.password).await?;

    let mut transaction = state.pool.begin().await?;
    // People change one at a time per church (see `access::lock_member`).
    sqlx::query("SELECT id FROM churches WHERE id = $1 FOR UPDATE")
        .bind(first.church_id)
        .execute(&mut *transaction)
        .await?;
    let link = open_link(&mut *transaction, &token, true).await?;
    if link.id != first.id {
        return Err(AppError::NotFound("this link does not work".into()));
    }
    let role = link.role.as_deref().map(role_from_db).transpose()?;
    let (user_id, display_name) = match (invite, link.user_id) {
        (true, _) => {
            let user_id = Uuid::new_v4();
            let display_name = display_name.unwrap_or_default();
            sqlx::query(
                "INSERT INTO users (id, display_name, username, password_hash) VALUES ($1, $2, $3, $4)",
            )
            .bind(user_id)
            .bind(&display_name)
            .bind(username)
            .bind(&password_hash)
            .execute(&mut *transaction)
            .await
            .map_err(username_taken)?;
            sqlx::query("INSERT INTO memberships (user_id, church_id, role) VALUES ($1, $2, $3)")
                .bind(user_id)
                .bind(link.church_id)
                .bind(role.unwrap_or(Role::Viewer).as_db())
                .execute(&mut *transaction)
                .await?;
            (user_id, display_name)
        }
        (false, Some(user_id)) => {
            sqlx::query("UPDATE users SET password_hash = $2 WHERE id = $1")
                .bind(user_id)
                .bind(&password_hash)
                .execute(&mut *transaction)
                .await?;
            sqlx::query("DELETE FROM sessions WHERE user_id = $1")
                .bind(user_id)
                .execute(&mut *transaction)
                .await?;
            (user_id, link.display_name.clone().unwrap_or_default())
        }
        (false, None) => return Err(AppError::Internal("reset link without a person".into())),
    };
    sqlx::query("UPDATE account_links SET used_at = now() WHERE id = $1")
        .bind(link.id)
        .execute(&mut *transaction)
        .await?;
    let member_role = sqlx::query_scalar::<_, String>(
        "SELECT role FROM memberships WHERE user_id = $1 AND church_id = $2",
    )
    .bind(user_id)
    .bind(link.church_id)
    .fetch_one(&mut *transaction)
    .await?;
    transaction.commit().await?;

    let person = LoginRow {
        user_id,
        display_name,
        password_hash: String::new(),
        church_id: link.church_id,
        church_name: link.church_name,
        role: member_role,
    };
    Ok(Json(
        issue_session(&state.pool, state.session_hours, &person).await?,
    ))
}
