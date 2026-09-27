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

export interface SongSummary {
  id: string;
  revision_id: string;
  title: string;
  song_number: string | null;
  authors: string;
  language: string | null;
  updated_at: string;
}

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
}

export interface DeviceTokenSummary {
  id: string;
  name: string;
  created_at: string;
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
}

export interface RemoteDesktop {
  device_id: string;
  name: string;
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
