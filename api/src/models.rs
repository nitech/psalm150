use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use utoipa::{IntoParams, ToSchema};
use uuid::Uuid;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
#[serde(rename_all = "lowercase")]
pub enum Role {
    Owner,
    Leader,
    Viewer,
}

impl Role {
    pub fn from_db(value: &str) -> Option<Self> {
        match value {
            "owner" => Some(Self::Owner),
            "leader" => Some(Self::Leader),
            "viewer" => Some(Self::Viewer),
            _ => None,
        }
    }

    pub fn can_edit(self) -> bool {
        matches!(self, Self::Owner | Self::Leader)
    }
}

#[derive(Debug, Serialize, ToSchema)]
pub struct HealthResponse {
    pub status: &'static str,
    pub database: &'static str,
    pub version: &'static str,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct SetupStatus {
    pub initialized: bool,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct SetupRequest {
    pub church_name: String,
    pub owner_name: String,
    pub username: String,
    pub password: String,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct LoginRequest {
    pub username: String,
    pub password: String,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct SessionResponse {
    pub token: String,
    pub expires_at: DateTime<Utc>,
    pub user_id: Uuid,
    pub church_id: Uuid,
    pub church_name: String,
    pub display_name: String,
    pub role: Role,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct CreateDeviceTokenRequest {
    pub name: String,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct DeviceTokenResponse {
    pub id: Uuid,
    pub name: String,
    pub token: String,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Serialize, FromRow, ToSchema)]
pub struct DeviceTokenSummary {
    pub id: Uuid,
    pub name: String,
    pub created_at: DateTime<Utc>,
    pub last_used_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct CreateSongRequest {
    pub chordpro: String,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct UpdateSongRequest {
    pub base_revision_id: Uuid,
    pub chordpro: String,
}

#[derive(Debug, Deserialize, ToSchema, IntoParams)]
pub struct DeleteSongQuery {
    /// Revision the caller last saw; a newer current revision is a 409.
    pub base_revision_id: Option<Uuid>,
}

/// One line of `psa150-manifest.json` in the export ZIP.
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct ExportManifestEntry {
    pub filename: String,
    pub id: Uuid,
    pub revision_id: Uuid,
    pub content_hash: String,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct SongQuery {
    pub q: Option<String>,
    pub limit: Option<i64>,
}

#[derive(Debug, Clone, Serialize, FromRow, ToSchema)]
pub struct SongSummary {
    pub id: Uuid,
    pub revision_id: Uuid,
    pub title: String,
    pub song_number: Option<String>,
    pub authors: String,
    pub language: Option<String>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Serialize, FromRow, ToSchema)]
pub struct SongDetail {
    pub id: Uuid,
    pub revision_id: Uuid,
    pub parent_revision_id: Option<Uuid>,
    pub title: String,
    pub song_number: Option<String>,
    pub authors: String,
    pub language: Option<String>,
    pub chordpro: String,
    pub content_hash: String,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Serialize, FromRow, ToSchema)]
pub struct RevisionSummary {
    pub id: Uuid,
    pub parent_revision_id: Option<Uuid>,
    pub title: String,
    pub content_hash: String,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct ImportSongsRequest {
    pub songs: Vec<ImportSongInput>,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct ImportSongInput {
    pub filename: Option<String>,
    pub chordpro: String,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct ImportSongsResponse {
    pub songs: Vec<SongSummary>,
    pub skipped_existing: usize,
}
