use chrono::{DateTime, NaiveDate, Utc};
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

/// `GET /info`: a cheap, public "is this a Psalm150 song server?" ping.
#[derive(Debug, Serialize, ToSchema)]
pub struct ServerInfo {
    /// Always `psalm150-song-server`.
    pub service: &'static str,
    pub version: &'static str,
    pub initialized: bool,
    /// The server supports browser sign-in for desktops (`/desktop-auth/*`).
    pub desktop_sign_in: bool,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct CreateDesktopAuthCodeRequest {
    pub device_name: String,
    /// BASE64URL-NOPAD(SHA256(code_verifier)); only the S256 method exists.
    pub code_challenge: String,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct DesktopAuthCodeResponse {
    /// One-time code, valid for five minutes.
    pub code: String,
    pub expires_at: DateTime<Utc>,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct DesktopTokenRequest {
    pub code: String,
    pub code_verifier: String,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct DesktopTokenResponse {
    /// A normal `psa_d_` device token.
    pub token: String,
    pub device_id: Uuid,
    pub device_name: String,
    pub church_name: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "lowercase")]
pub enum SetItemKind {
    /// A song from this church's library.
    Song,
    /// An empty screen between songs (for prayer, a reading, announcements).
    Blank,
}

impl SetItemKind {
    pub fn as_db(self) -> &'static str {
        match self {
            Self::Song => "song",
            Self::Blank => "blank",
        }
    }

    pub fn from_db(value: &str) -> Option<Self> {
        match value {
            "song" => Some(Self::Song),
            "blank" => Some(Self::Blank),
            _ => None,
        }
    }
}

/// One entry of a set, as sent by a client.
#[derive(Debug, Clone, Deserialize, ToSchema)]
pub struct SetItemInput {
    /// Keeps an item's identity across edits; a new id is assigned when absent.
    pub id: Option<Uuid>,
    pub kind: SetItemKind,
    /// Required for `song` items; must be a song of the caller's church.
    pub song_id: Option<Uuid>,
    /// Semitones, -11 to 11. Defaults to 0.
    #[serde(default)]
    pub transpose: i16,
    /// Free text for the team, at most 500 characters.
    #[serde(default)]
    pub note: String,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct CreateSetRequest {
    /// Optional client-chosen id, so a desktop can create a set offline and
    /// upload it later without creating it twice. 409 when it already exists.
    pub id: Option<Uuid>,
    pub name: String,
    /// The service day, `YYYY-MM-DD`.
    pub service_date: Option<NaiveDate>,
    #[serde(default)]
    pub items: Vec<SetItemInput>,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct UpdateSetRequest {
    /// The `version` this edit is based on; a newer version on the server is a 409.
    pub base_version: i32,
    pub name: String,
    pub service_date: Option<NaiveDate>,
    pub items: Vec<SetItemInput>,
}

#[derive(Debug, Deserialize, ToSchema, IntoParams)]
pub struct DeleteSetQuery {
    /// Version the caller last saw; a newer version is a 409.
    pub base_version: Option<i32>,
}

#[derive(Debug, Deserialize, ToSchema, IntoParams)]
pub struct SetQuery {
    /// Only sets on or after this day (sets without a date are always included).
    pub from: Option<NaiveDate>,
    pub limit: Option<i64>,
}

#[derive(Debug, Clone, Serialize, FromRow, ToSchema)]
pub struct SetSummary {
    pub id: Uuid,
    pub name: String,
    pub service_date: Option<NaiveDate>,
    pub version: i32,
    pub item_count: i64,
    pub updated_at: DateTime<Utc>,
}

/// The song an item points at, at its current revision.
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct SetSongRef {
    pub revision_id: Uuid,
    pub title: String,
    pub song_number: Option<String>,
    pub authors: String,
}

#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct SetItem {
    pub id: Uuid,
    pub kind: SetItemKind,
    pub song_id: Option<Uuid>,
    pub transpose: i16,
    pub note: String,
    /// Absent when the song was deleted after it was added to the set.
    pub song: Option<SetSongRef>,
}

#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct SetDetail {
    pub id: Uuid,
    pub name: String,
    pub service_date: Option<NaiveDate>,
    pub version: i32,
    pub updated_at: DateTime<Utc>,
    pub items: Vec<SetItem>,
}

/// What a desktop reports about its projection, so phones can show it.
#[derive(Debug, Clone, Default, Serialize, Deserialize, ToSchema)]
pub struct DesktopState {
    /// The operator allows remote control through this server.
    #[serde(default)]
    pub accepts_commands: bool,
    #[serde(default)]
    pub projecting: bool,
    #[serde(default)]
    pub blanked: bool,
    pub song_id: Option<Uuid>,
    pub song_title: Option<String>,
    pub slide_index: Option<u32>,
    /// One short label per slide ("Verse 1", "Chorus"), at most 200.
    #[serde(default)]
    pub slide_labels: Vec<String>,
    pub set_id: Option<Uuid>,
    pub set_item_index: Option<u32>,
}

#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct RemoteDesktop {
    pub device_id: Uuid,
    pub name: String,
    /// Heard from within the last 45 seconds.
    pub online: bool,
    pub last_seen: DateTime<Utc>,
    pub state: DesktopState,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum RemoteAction {
    Next,
    Previous,
    /// Toggle the blank screen.
    Blank,
    /// Needs `slide_index`.
    ShowSlide,
    /// Needs `song_id`.
    ProjectSong,
    /// Needs `set_id` and `item_index`.
    ProjectSetItem,
}

#[derive(Debug, Clone, Deserialize, ToSchema)]
pub struct RemoteCommandRequest {
    pub action: RemoteAction,
    pub slide_index: Option<u32>,
    pub song_id: Option<Uuid>,
    pub set_id: Option<Uuid>,
    pub item_index: Option<u32>,
}

#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct RemoteCommand {
    pub id: Uuid,
    pub action: RemoteAction,
    pub slide_index: Option<u32>,
    pub song_id: Option<Uuid>,
    pub set_id: Option<Uuid>,
    pub item_index: Option<u32>,
    /// Display name of the person who sent it.
    pub issued_by: String,
    pub issued_at: DateTime<Utc>,
}

#[derive(Debug, Deserialize, ToSchema, IntoParams)]
pub struct CommandsQuery {
    /// Seconds to wait for a command when none is queued, 0 to 30. Default 0.
    pub wait: Option<u64>,
}
