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
