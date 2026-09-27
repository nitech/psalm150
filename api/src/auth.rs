use argon2::{
    Argon2, PasswordHash, PasswordHasher, PasswordVerifier,
    password_hash::{SaltString, rand_core::OsRng},
};
use axum::http::{HeaderMap, header::AUTHORIZATION};
use chrono::{Duration, Utc};
use sha2::{Digest, Sha256};
use sqlx::{FromRow, PgPool};
use uuid::Uuid;

use crate::{
    AppState,
    error::AppError,
    models::{Role, SessionResponse},
};

#[derive(Debug)]
pub struct AuthContext {
    pub user_id: Option<Uuid>,
    pub church_id: Uuid,
    pub role: Role,
    pub is_device: bool,
    pub device_id: Option<Uuid>,
}

/// Who wrote a song change: a person or a desktop device token.
#[derive(Debug, Clone, Copy)]
pub struct Actor {
    pub user_id: Option<Uuid>,
    pub device_id: Option<Uuid>,
}

impl AuthContext {
    /// Church content (songs and sets) create, edit and delete: leaders and
    /// owners, and desktop tokens, which keep a church's desktops, their sets
    /// and their Visual Song Book in sync.
    pub fn require_song_editor(&self) -> Result<Actor, AppError> {
        if self.is_device {
            return Ok(self.actor());
        }
        Ok(Actor {
            user_id: Some(self.require_editor()?),
            device_id: None,
        })
    }

    pub fn actor(&self) -> Actor {
        Actor {
            user_id: self.user_id,
            device_id: self.device_id,
        }
    }

    pub fn require_editor(&self) -> Result<Uuid, AppError> {
        if self.is_device || !self.role.can_edit() {
            return Err(AppError::Forbidden("leader access is required".into()));
        }
        self.user_id
            .ok_or_else(|| AppError::Forbidden("a person account is required".into()))
    }
}

#[derive(FromRow)]
struct SessionRow {
    user_id: Uuid,
    church_id: Uuid,
    role: String,
}

#[derive(FromRow)]
struct DeviceRow {
    id: Uuid,
    church_id: Uuid,
}

#[derive(FromRow)]
pub struct LoginRow {
    pub user_id: Uuid,
    pub display_name: String,
    pub password_hash: String,
    pub church_id: Uuid,
    pub church_name: String,
    pub role: String,
}

pub async fn authenticate(headers: &HeaderMap, state: &AppState) -> Result<AuthContext, AppError> {
    let token = bearer(headers)?;
    let token_hash = hash_token(token);

    if token.starts_with("psa_s_") {
        let session = sqlx::query_as::<_, SessionRow>(
            "SELECT s.user_id, s.church_id, m.role
             FROM sessions s
             JOIN users u ON u.id = s.user_id AND u.disabled_at IS NULL
             JOIN memberships m ON m.user_id = s.user_id AND m.church_id = s.church_id
             WHERE s.token_hash = $1 AND s.expires_at > now()",
        )
        .bind(&token_hash)
        .fetch_optional(&state.pool)
        .await?
        .ok_or_else(|| AppError::Unauthorized("invalid or expired session".into()))?;

        let _ = sqlx::query("UPDATE sessions SET last_used_at = now() WHERE token_hash = $1")
            .bind(&token_hash)
            .execute(&state.pool)
            .await;

        return Ok(AuthContext {
            user_id: Some(session.user_id),
            church_id: session.church_id,
            role: Role::from_db(&session.role)
                .ok_or_else(|| AppError::Internal("unknown role in database".into()))?,
            is_device: false,
            device_id: None,
        });
    }

    if token.starts_with("psa_d_") {
        let device = sqlx::query_as::<_, DeviceRow>(
            "SELECT id, church_id FROM device_tokens
             WHERE token_hash = $1 AND revoked_at IS NULL",
        )
        .bind(&token_hash)
        .fetch_optional(&state.pool)
        .await?
        .ok_or_else(|| AppError::Unauthorized("invalid or revoked device token".into()))?;

        let _ = sqlx::query("UPDATE device_tokens SET last_used_at = now() WHERE token_hash = $1")
            .bind(&token_hash)
            .execute(&state.pool)
            .await;

        return Ok(AuthContext {
            user_id: None,
            church_id: device.church_id,
            role: Role::Viewer,
            is_device: true,
            device_id: Some(device.id),
        });
    }

    Err(AppError::Unauthorized("unknown token type".into()))
}

pub async fn hash_password(password: String) -> Result<String, AppError> {
    tokio::task::spawn_blocking(move || {
        let salt = SaltString::generate(&mut OsRng);
        Argon2::default()
            .hash_password(password.as_bytes(), &salt)
            .map(|hash| hash.to_string())
            .map_err(|error| AppError::Internal(format!("could not hash password: {error}")))
    })
    .await
    .map_err(|error| AppError::Internal(format!("password task failed: {error}")))?
}

pub async fn verify_password(password: String, encoded: String) -> Result<bool, AppError> {
    tokio::task::spawn_blocking(move || {
        let parsed = PasswordHash::new(&encoded).map_err(|error| {
            AppError::Internal(format!("stored password hash is invalid: {error}"))
        })?;
        Ok(Argon2::default()
            .verify_password(password.as_bytes(), &parsed)
            .is_ok())
    })
    .await
    .map_err(|error| AppError::Internal(format!("password task failed: {error}")))?
}

pub async fn issue_session(
    pool: &PgPool,
    session_hours: i64,
    user: &LoginRow,
) -> Result<SessionResponse, AppError> {
    let token = new_token("psa_s_");
    let token_hash = hash_token(&token);
    let expires_at = Utc::now() + Duration::hours(session_hours);

    sqlx::query(
        "INSERT INTO sessions (token_hash, user_id, church_id, expires_at)
         VALUES ($1, $2, $3, $4)",
    )
    .bind(token_hash)
    .bind(user.user_id)
    .bind(user.church_id)
    .bind(expires_at)
    .execute(pool)
    .await?;

    Ok(SessionResponse {
        token,
        expires_at,
        user_id: user.user_id,
        church_id: user.church_id,
        church_name: user.church_name.clone(),
        display_name: user.display_name.clone(),
        role: Role::from_db(&user.role)
            .ok_or_else(|| AppError::Internal("unknown role in database".into()))?,
    })
}

pub fn new_token(prefix: &str) -> String {
    format!(
        "{prefix}{}{}",
        Uuid::new_v4().simple(),
        Uuid::new_v4().simple()
    )
}

pub fn hash_token(token: &str) -> String {
    hex::encode(Sha256::digest(token.as_bytes()))
}

fn bearer(headers: &HeaderMap) -> Result<&str, AppError> {
    let header = headers
        .get(AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .ok_or_else(|| AppError::Unauthorized("bearer token is required".into()))?;
    header
        .strip_prefix("Bearer ")
        .filter(|token| !token.is_empty())
        .ok_or_else(|| AppError::Unauthorized("bearer token is required".into()))
}
