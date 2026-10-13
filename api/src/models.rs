use chrono::{DateTime, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use utoipa::{IntoParams, ToSchema};
use uuid::Uuid;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
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

    pub fn as_db(self) -> &'static str {
        match self {
            Self::Owner => "owner",
            Self::Leader => "leader",
            Self::Viewer => "viewer",
        }
    }

    pub fn can_edit(self) -> bool {
        matches!(self, Self::Owner | Self::Leader)
    }

    /// Owners may do everything leaders may, and leaders everything viewers may.
    pub fn includes(self, other: Role) -> bool {
        self.rank() >= other.rank()
    }

    /// The lesser of the two: what a token capped at `cap` may do for a
    /// person whose role is `self`.
    pub fn at_most(self, cap: Role) -> Role {
        if self.includes(cap) { cap } else { self }
    }

    fn rank(self) -> u8 {
        match self {
            Self::Viewer => 0,
            Self::Leader => 1,
            Self::Owner => 2,
        }
    }
}

/// Which kind of bearer token a request carried.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
#[serde(rename_all = "lowercase")]
pub enum TokenKind {
    /// `psa_s_`: a person signed in with a password; expires.
    Session,
    /// `psa_a_`: a person's API token for scripts and integrations; lasts
    /// until it is revoked or reaches its own expiry.
    Api,
    /// `psa_d_`: a desktop. It reads, imports and edits songs and sets and
    /// uses the remote-control relay; it never acts as a person.
    Desktop,
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
    /// For a person in several churches: which one to sign in to. Without
    /// it, the church they joined first.
    pub church_id: Option<Uuid>,
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

/// `GET /session`: who the bearer token belongs to and what it may do.
#[derive(Debug, Serialize, ToSchema)]
pub struct SessionInfo {
    pub kind: TokenKind,
    pub church_id: Uuid,
    pub church_name: String,
    /// What a person's token may do: their role, or less for an API token
    /// made with a lower one. Absent for desktops, which have their own
    /// fixed access.
    pub role: Option<Role>,
    pub user_id: Option<Uuid>,
    pub username: Option<String>,
    pub display_name: Option<String>,
    pub device_id: Option<Uuid>,
    pub device_name: Option<String>,
    /// When the token stops working; absent when it lasts until revoked.
    pub expires_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct ChangePasswordRequest {
    pub current_password: String,
    /// At least 10 characters.
    pub new_password: String,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct CreateApiTokenRequest {
    /// What the token is for, such as "Church website".
    pub name: String,
    /// At most the creator's own role; defaults to it. `viewer` makes a
    /// read-only token.
    pub role: Option<Role>,
    /// When the token stops working; it lasts until revoked when absent.
    pub expires_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct ApiTokenResponse {
    pub id: Uuid,
    pub name: String,
    pub role: Role,
    /// Shown once; only its hash is stored.
    pub token: String,
    pub created_at: DateTime<Utc>,
    pub expires_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct ApiTokenSummary {
    pub id: Uuid,
    pub name: String,
    /// The most the token may do; it never does more than its person may.
    pub role: Role,
    /// The person the token acts as.
    pub user_id: Uuid,
    pub user_display_name: String,
    pub created_at: DateTime<Utc>,
    pub expires_at: Option<DateTime<Utc>>,
    pub last_used_at: Option<DateTime<Utc>>,
}

/// A person in the church.
#[derive(Debug, Serialize, ToSchema)]
pub struct Member {
    pub user_id: Uuid,
    pub username: String,
    pub display_name: String,
    pub role: Role,
    /// A disabled person cannot sign in, and their sessions and API tokens
    /// do not work.
    pub disabled: bool,
    /// When they joined the church.
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct CreateMemberRequest {
    pub username: String,
    pub display_name: String,
    /// At least 10 characters.
    pub password: String,
    pub role: Role,
}

/// Fields left out stay as they are.
#[derive(Debug, Deserialize, ToSchema)]
pub struct UpdateMemberRequest {
    pub role: Option<Role>,
    pub display_name: Option<String>,
    pub username: Option<String>,
    /// Sets a new password and ends the person's sessions.
    pub password: Option<String>,
    /// Disabling ends the person's sessions and revokes their API tokens.
    pub disabled: Option<bool>,
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
    /// The desktop's room (see `DesktopRoom`).
    pub room_name: String,
}

#[derive(Debug, Serialize, FromRow, ToSchema)]
pub struct DeviceTokenSummary {
    pub id: Uuid,
    pub name: String,
    pub created_at: DateTime<Utc>,
    pub last_used_at: Option<DateTime<Utc>>,
    /// Absent for a desktop made before rooms that has not been heard from since.
    pub room_name: Option<String>,
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
    /// Rows to skip, for paging through a library larger than `limit`.
    pub offset: Option<i64>,
    /// `title` (default) or `number`.
    pub sort: Option<SongSort>,
    /// `asc` (default) or `desc`.
    pub direction: Option<SortDirection>,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Deserialize, ToSchema)]
#[serde(rename_all = "lowercase")]
pub enum SongSort {
    #[default]
    Title,
    /// By the number's leading digits, numerically ("9" before "10"), then
    /// the rest of it. Songs without a number come last in both directions.
    Number,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Deserialize, ToSchema)]
#[serde(rename_all = "lowercase")]
pub enum SortDirection {
    #[default]
    Asc,
    Desc,
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

/// One revision of a song, current or earlier, with its full source.
#[derive(Debug, Serialize, FromRow, ToSchema)]
pub struct RevisionDetail {
    pub id: Uuid,
    pub song_id: Uuid,
    pub parent_revision_id: Option<Uuid>,
    pub title: String,
    pub song_number: Option<String>,
    pub authors: String,
    pub language: Option<String>,
    pub chordpro: String,
    pub content_hash: String,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Deserialize, ToSchema, IntoParams)]
pub struct PageQuery {
    /// Defaults to 100; 1 to 200.
    pub limit: Option<i64>,
    /// Rows to skip.
    pub offset: Option<i64>,
}

/// A deleted song, as it was when it was deleted.
#[derive(Debug, Serialize, FromRow, ToSchema)]
pub struct DeletedSong {
    pub id: Uuid,
    pub revision_id: Uuid,
    pub title: String,
    pub song_number: Option<String>,
    pub authors: String,
    pub language: Option<String>,
    pub deleted_at: DateTime<Utc>,
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
    /// At least one church has made its library public: anyone may read it
    /// through `/public/songs` without signing in.
    pub public_library: bool,
    /// The public library's church name, when exactly one church's is public.
    pub public_library_name: Option<String>,
    /// At least one church shares its projections in rooms that anyone may
    /// join by name (`/public/rooms/{room_name}`).
    pub rooms: bool,
}

/// `GET /church`: the signed-in church and its settings.
#[derive(Debug, Serialize, FromRow, ToSchema)]
pub struct ChurchSettings {
    pub id: Uuid,
    pub name: String,
    /// Anyone, signed in or not, may read the songs. Sets stay private
    /// unless a leader shares one on a link.
    pub public_library: bool,
    /// Anyone who knows a desktop's room name may follow the words it
    /// projects. On by default; each desktop can also stop sharing.
    pub public_rooms: bool,
}

/// Fields left out stay as they are.
#[derive(Debug, Deserialize, ToSchema)]
pub struct UpdateChurchRequest {
    /// 1 to 200 characters.
    pub name: Option<String>,
    pub public_library: Option<bool>,
    pub public_rooms: Option<bool>,
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
    /// The desktop's room (see `DesktopRoom`).
    pub room_name: String,
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
    /// Rows to skip, for paging past `limit`.
    pub offset: Option<i64>,
}

#[derive(Debug, Clone, Serialize, FromRow, ToSchema)]
pub struct SetSummary {
    pub id: Uuid,
    pub name: String,
    pub service_date: Option<NaiveDate>,
    pub version: i32,
    pub item_count: i64,
    pub updated_at: DateTime<Utc>,
    /// A leader shared the set on a link (see `SetShare`).
    pub shared: bool,
}

/// A deleted set, as it was when it was deleted.
#[derive(Debug, Clone, Serialize, FromRow, ToSchema)]
pub struct DeletedSet {
    pub id: Uuid,
    pub name: String,
    pub service_date: Option<NaiveDate>,
    pub version: i32,
    pub item_count: i64,
    pub deleted_at: DateTime<Utc>,
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
    /// A leader shared the set on a link (see `SetShare`).
    pub shared: bool,
    pub items: Vec<SetItem>,
}

/// `PUT /sets/{set_id}/share`.
#[derive(Debug, Deserialize, ToSchema)]
pub struct ShareSetRequest {
    /// Anyone with the link may also add songs to the set and remove them.
    #[serde(default)]
    pub editable: bool,
}

/// A set's share link. The link is `<server>/shared/{key}`; anyone who has it
/// reads the set and its songs through `/public/sets/{key}` without a token.
#[derive(Debug, Clone, Serialize, FromRow, ToSchema)]
pub struct SetShare {
    /// The secret part of the link: 32 letters and digits.
    pub key: String,
    /// Anyone with the link may also add songs to the set and remove them.
    pub editable: bool,
    pub shared_at: DateTime<Utc>,
}

/// A set as people with its share link see it.
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct SharedSet {
    pub name: String,
    pub service_date: Option<NaiveDate>,
    /// Goes up with every change, by the church or through the link.
    pub version: i32,
    pub updated_at: DateTime<Utc>,
    /// The church the set belongs to.
    pub church_name: String,
    /// Anyone with the link may add songs to the set and remove them. Then
    /// they may also search and read the church's songs, to find one to add.
    pub editable: bool,
    pub items: Vec<SetItem>,
}

/// `PUT /sets/{set_id}/live`: the item a leader shows now.
#[derive(Debug, Deserialize, ToSchema)]
pub struct LeadSetRequest {
    /// An item of the set.
    pub item_id: Uuid,
}

/// Who leads a set live and how many follow it through its shared link.
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct SetLive {
    /// Someone leads the set: people with its shared link move with them.
    /// Leading ends a minute after the leader's last report.
    pub leading: bool,
    /// The item the leader shows; null when nobody leads.
    pub item_id: Option<Uuid>,
    pub leader_name: Option<String>,
    /// Shared-link pages that have the set open now.
    pub viewers: usize,
}

/// What a shared-link page hears while it has the set open: the item to show.
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct SharedSetLive {
    /// The item the leader shows; null when nobody leads.
    pub item_id: Option<Uuid>,
    pub leader_name: Option<String>,
}

/// `POST /public/sets/{share_key}/items`: adds a song through an editable link.
#[derive(Debug, Deserialize, ToSchema)]
pub struct AddSharedSetItemRequest {
    /// A song of the set's church.
    pub song_id: Uuid,
    /// Where it goes, counting from 0; the end of the set when left out or
    /// past the end.
    pub position: Option<usize>,
}

/// What a desktop reports about its projection, so phones can show it.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize, ToSchema)]
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
    /// The operator lets people follow this projection in the desktop's room.
    #[serde(default)]
    pub shares_room: bool,
    /// The projected song's words, slide by slide in the order they are
    /// shown, without chords: at most 200 slides of 40 lines.
    #[serde(default)]
    pub slides: Vec<RoomSlide>,
}

/// One slide's words.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct RoomSlide {
    /// Such as "Verse 1" or "Chorus"; may be empty.
    #[serde(default)]
    pub label: String,
    #[serde(default)]
    pub lines: Vec<String>,
}

#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct RemoteDesktop {
    pub device_id: Uuid,
    /// The name it was connected with, such as "Psalm150 on SANCTUARY".
    pub name: String,
    /// The desktop's room, which leaders pick it by and others join.
    pub room_name: String,
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

/// A desktop's room: anyone who knows the name may follow the words the
/// desktop projects, unless its church or its operator stopped sharing.
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct DesktopRoom {
    pub device_id: Uuid,
    /// A flower by default, unique on this server. Matched without regard to
    /// case, accents, spaces or punctuation.
    pub room_name: String,
    /// The church shares its projections in rooms.
    pub public_rooms: bool,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct RoomNameRequest {
    /// 2 to 30 letters, digits, spaces, hyphens or apostrophes. Left out or
    /// null: a new random flower.
    pub room_name: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum RoomStatus {
    /// Words are on screen; `slide_index` is the one showing.
    Live,
    /// A song is projected but the screen is blank.
    Blank,
    /// The desktop is online but shows nothing it shares.
    Idle,
    /// Not heard from the desktop for a while.
    Offline,
}

/// What someone following a room sees. Words are only included while the
/// status is `live` or `blank`.
#[derive(Debug, Clone, PartialEq, Serialize, ToSchema)]
pub struct RoomView {
    pub room_name: String,
    pub status: RoomStatus,
    pub song_title: Option<String>,
    pub slide_index: Option<u32>,
    pub slides: Vec<RoomSlide>,
}
