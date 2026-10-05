export type Role = "owner" | "leader" | "viewer";

export interface SetupStatus {
  initialized: boolean;
}

export interface Session {
  token: string;
  expires_at: string;
  user_id: string;
  church_id: string;
  church_name: string;
  display_name: string;
  role: Role;
}

/** Which kind of bearer token a request carried. */
export type TokenKind = "session" | "api" | "desktop";

/** `GET /session`: who a token belongs to and what it may do now. */
export interface SessionInfo {
  kind: TokenKind;
  church_id: string;
  church_name: string;
  /** Null for desktops. */
  role: Role | null;
  user_id: string | null;
  username: string | null;
  display_name: string | null;
  device_id: string | null;
  device_name: string | null;
  /** Null when the token lasts until revoked. */
  expires_at: string | null;
}

/** A person in the church (`/members`, owners only). */
export interface Member {
  user_id: string;
  username: string;
  display_name: string;
  role: Role;
  /** Cannot sign in; their sessions and API tokens do not work. */
  disabled: boolean;
  /** When they joined the church. */
  created_at: string;
}

export interface SongSummary {
  id: string;
  revision_id: string;
  title: string;
  song_number: string | null;
  authors: string;
  language: string | null;
  updated_at: string;
}

/** `GET /songs?sort=`: by title (default) or by number, songs without one last. */
export type SongSort = "title" | "number";
export type SortDirection = "asc" | "desc";

export interface SongDetail extends SongSummary {
  parent_revision_id: string | null;
  chordpro: string;
  content_hash: string;
}

export interface DeviceToken {
  id: string;
  name: string;
  token: string;
  created_at: string;
  room_name: string;
}

export interface DeviceTokenSummary {
  id: string;
  name: string;
  created_at: string;
  last_used_at: string | null;
  /** Null for a desktop made before rooms that has not been heard from since. */
  room_name: string | null;
}

/** A new API token (`psa_a_`): it acts as its person, and is shown once. */
export interface ApiToken {
  id: string;
  name: string;
  role: Role;
  token: string;
  created_at: string;
  expires_at: string | null;
}

export interface ApiTokenSummary {
  id: string;
  name: string;
  /** The most the token may do; never more than its person may. */
  role: Role;
  /** The person the token acts as. */
  user_id: string;
  user_display_name: string;
  created_at: string;
  expires_at: string | null;
  last_used_at: string | null;
}

/** One entry of `psa150-manifest.json` in the export ZIP. */
export interface ExportManifestEntry {
  filename: string;
  id: string;
  revision_id: string;
  content_hash: string;
}

/** `GET /info`: public "is this a Psalm150 song server?" ping. */
export interface ServerInfo {
  service: "psalm150-song-server";
  version: string;
  initialized: boolean;
  desktop_sign_in: boolean;
  /** Anyone may read the songs through `/public/songs` without signing in. */
  public_library: boolean;
  /** The public library's church, when exactly one church's library is public. */
  public_library_name: string | null;
  /** Anyone may follow a desktop's projection by its room name. */
  rooms: boolean;
}

/** `GET /church`: the signed-in church and its settings. */
export interface ChurchSettings {
  id: string;
  name: string;
  public_library: boolean;
  /** Anyone who knows a desktop's room name may follow the words it projects. */
  public_rooms: boolean;
}

/** One-time desktop sign-in code, valid for five minutes. */
export interface DesktopAuthCode {
  code: string;
  expires_at: string;
}

/** `POST /desktop-auth/token` result: a normal desktop token. */
export interface DesktopTokenResponse {
  token: string;
  device_id: string;
  device_name: string;
  church_name: string;
  room_name: string;
}

export type SetItemKind = "song" | "blank";

/** The song a set item points at, at its current revision. */
export interface SetSongRef {
  revision_id: string;
  title: string;
  song_number: string | null;
  authors: string;
}

export interface SetItem {
  id: string;
  kind: SetItemKind;
  song_id: string | null;
  /** Semitones, -11 to 11. */
  transpose: number;
  note: string;
  /** Null when the song was deleted after it was added. */
  song: SetSongRef | null;
}

export interface SetItemInput {
  id?: string;
  kind: SetItemKind;
  song_id?: string | null;
  transpose?: number;
  note?: string;
}

export interface SetSummary {
  id: string;
  name: string;
  /** `YYYY-MM-DD` */
  service_date: string | null;
  version: number;
  item_count: number;
  updated_at: string;
}

export interface SetDetail {
  id: string;
  name: string;
  service_date: string | null;
  version: number;
  updated_at: string;
  items: SetItem[];
}

/** What a desktop reports about its projection. */
export interface DesktopState {
  accepts_commands: boolean;
  projecting: boolean;
  blanked: boolean;
  song_id: string | null;
  song_title: string | null;
  slide_index: number | null;
  slide_labels: string[];
  set_id: string | null;
  set_item_index: number | null;
  /** The operator lets people follow the projection in the desktop's room. */
  shares_room: boolean;
  /** The projected song's words, slide by slide, without chords. */
  slides: RoomSlide[];
}

export interface RoomSlide {
  label: string;
  lines: string[];
}

export interface RemoteDesktop {
  device_id: string;
  /** The name it was connected with, such as "Psalm150 on SANCTUARY". */
  name: string;
  /** What leaders pick it by and others join: a flower unless renamed. */
  room_name: string;
  online: boolean;
  last_seen: string;
  state: DesktopState;
}

export type RemoteAction =
  | "next"
  | "previous"
  | "blank"
  | "show_slide"
  | "project_song"
  | "project_set_item";

export interface RemoteCommandRequest {
  action: RemoteAction;
  slide_index?: number;
  song_id?: string;
  set_id?: string;
  item_index?: number;
}

export interface RemoteCommand extends RemoteCommandRequest {
  id: string;
  issued_by: string;
  issued_at: string;
}

/** A desktop's room. */
export interface DesktopRoom {
  device_id: string;
  room_name: string;
  public_rooms: boolean;
}

export type RoomStatus = "live" | "blank" | "idle" | "offline";

/** What someone following a room sees; words only while `live` or `blank`. */
export interface RoomView {
  room_name: string;
  status: RoomStatus;
  song_title: string | null;
  slide_index: number | null;
  slides: RoomSlide[];
}
