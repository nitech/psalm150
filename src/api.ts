import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";

export interface LibraryStatus {
  songs_folder: string | null;
  song_count: number;
  library_dirty: boolean;
  foreign_files: string[];
  conflicts: string[];
}

export interface SongRow {
  id: number;
  filename: string;
  title: string;
  title_sort: string;
  song_num: number | null;
  key: string | null;
  category: string | null;
  tags: string | null;
  ccli: string | null;
  modified_at: string | null;
  favorite: boolean;
  /** Search hits only: 0 title, 1 title misspelt, 2 lyrics or tags, 3 lyrics misspelt. */
  match_rank?: number;
}

export interface SlideLine {
  text: string;
  chords: string[];
}

export interface SlideOverlay {
  title?: string | null;
  key?: string | null;
  song_num?: number | null;
  copyright?: string | null;
  ccli?: string | null;
}

export interface SlidePayload {
  index: number;
  section_index?: number;
  stanza_index?: number;
  section_label: string;
  lines: SlideLine[];
  overlay: SlideOverlay;
}

export interface SlideTheme {
  font_name: string;
  font_size: number;
  font_bold: boolean;
  font_italic: boolean;
  foreground: string;
  background: string;
  margin_top: number;
  margin_left: number;
  margin_right: number;
  margin_bottom: number;
  projection_width: number;
  projection_height: number;
  show_title_overlay: boolean;
  show_key_overlay: boolean;
  show_copyright_overlay: boolean;
  show_ccli_overlay: boolean;
}

export interface ProjectionState {
  filename?: string | null;
  title?: string | null;
  key?: string | null;
  ccli?: string | null;
  nashville?: boolean;
  slides: SlidePayload[];
  current_index: number;
  blank: boolean;
  transpose_semitones: number;
  hold_slide_id?: string | null;
}

export interface StageSlide {
  index: number;
  section_label: string;
  next_section_label?: string | null;
  lines: SlideLine[];
  overlay: SlideOverlay;
  nashville: boolean;
  key?: string | null;
}

export interface ProjectionSnapshot {
  revision: number;
  session_id: string | null;
  projection: ProjectionState;
  theme: SlideTheme;
  audience: SlidePayload;
  stage: StageSlide | null;
}

export type SectionKind =
  | "verse"
  | "chorus"
  | "chorus2"
  | "bridge"
  | "intro"
  | "pre_chorus"
  | "interlude"
  | "other";

export interface ChordPlacement {
  chord: string;
  position: number;
}

export interface LyricLine {
  text: string;
  chords: ChordPlacement[];
  source_line?: number | null;
}

export interface SongSection {
  label: string;
  kind: SectionKind;
  lines: LyricLine[];
}

export interface SongDetail {
  parsed: {
    meta: Record<string, unknown>;
    raw: string;
    sections: SongSection[];
  };
  projection: ProjectionState;
  content_hash: string;
}

export interface WebSearchCandidate {
  title: string;
  source_name: string;
  source_url: string;
  chordpro_content: string;
}

export interface ImportReport {
  written: number;
  skipped: number;
  failed: number;
  warnings: string[];
  cancelled: boolean;
  aborted_reason: string | null;
  files: ImportFileResult[];
}

export interface ImportFileResult {
  filename: string | null;
  title: string;
  status: "imported" | "skipped" | "failed";
  reason: string | null;
}

export interface ImportProgress {
  current: number;
  total: number;
  song_title: string;
}

/** Answer to the quick "is this a Psalm150 song server?" check. */
export interface ServerProbe {
  url: string;
  initialized: boolean;
  /** False for servers that still need a pasted desktop token. */
  desktop_sign_in: boolean;
}

export interface ServerSyncProgress {
  phase: "signing in" | "preparing" | "uploading" | "downloading" | "activating";
  label: string;
  current: number;
  total: number | null;
  unit: "songs" | "bytes" | "steps";
}

export interface Setlist {
  id: string;
  name: string;
  date: string;
  items: SetlistItem[];
  /** Server library only: the song server's copy of this set. */
  server?: { version: number | null; dirty: boolean } | null;
}

export interface SetlistItem {
  type: "song" | "blank" | "hold";
  file?: string | null;
  transpose?: number | null;
  arrangement?: string | null;
  id?: string | null;
  /** Free text for the team, from a song server set. */
  note?: string | null;
}

/** Result of synchronizing sets with the song server. */
export interface SetSyncReport {
  uploaded: number;
  downloaded: number;
  /** Names of sets whose edit on this PC was kept as a copy. */
  conflicts: string[];
  skipped_items: number;
  fetched_songs: number;
  unsupported: boolean;
}

/** A leader's phone asked (through the song server) to project a song. */
export interface RemoteProject {
  filename: string;
  transpose: number;
  set_id: string | null;
  item_index: number | null;
  issued_by: string;
}

export interface SongLineEdit {
  sectionIndex: number;
  lineIndex: number;
  text: string;
}

export interface DuplicateCandidate {
  filename: string;
  title: string;
  songNum: number | null;
  key: string | null;
  modifiedAt: string | null;
  contentHash: string;
  raw: string;
}

export interface DuplicateGroup {
  id: string;
  reasons: string[];
  candidates: DuplicateCandidate[];
  reviewed: boolean;
}

export interface RecoveryItem {
  id: string;
  original_filename: string;
  created_at: string;
}

/** Config value for projection on a resizable test window instead of a physical monitor. */
export const SIMULATED_DISPLAY_ID = "__simulated__";

export interface DisplayInfo {
  id: string;
  label: string;
  name?: string | null;
  width: number;
  height: number;
  isPrimary: boolean;
}

/** Phone remote server state, as returned by start_remote / get_remote_status. */
export interface RemoteStatus {
  running: boolean;
  port: number;
  pin: string;
}

export interface AppConfig {
  last_songs_folder?: string | null;
  last_local_songs_folder?: string | null;
  read_only: boolean;
  server_library?: ServerLibraryConfig | null;
  vsb_sync?: VsbSyncConfig | null;
  web_search_enabled: boolean;
  /** Show the song-number column in the song list (default on). */
  show_song_numbers: boolean;
  project_to_stage: boolean;
  audience_monitor?: string | null;
  stage_monitor?: string | null;
  remote_enabled: boolean;
  /** Leaders may steer this PC through the connected song server. */
  server_remote_enabled?: boolean;
  remote_pin?: string | null;
  remote_port: number;
  key_format_compressed: boolean;
  history_days: number;
  first_run_complete: boolean;
}

export interface ServerLibraryConfig {
  url: string;
  last_synced_at: string;
  song_count: number;
}

/** Linked Visual Song Book database, kept in two-way sync with the library. */
export interface VsbSyncConfig {
  mdb_path: string;
  last_synced_at?: string | null;
  last_summary?: string | null;
  last_error?: string | null;
}

export interface VsbSyncReport {
  files_written: number;
  files_created: number;
  files_deleted: number;
  rows_written: number;
  rows_inserted: number;
  rows_deleted: number;
  conflicts: number;
  differing: number;
  sent_to_server: number;
  linked: number;
  blocked: string[];
  errors: string[];
  backup?: string | null;
  finished_at: string;
}

export interface VsbSyncProgress {
  label: string;
  current: number;
  total: number;
}

export interface VsbSyncFinished {
  report: VsbSyncReport | null;
  error: string | null;
}

export const api = {
  pickSongsFolder: async () => {
    const selected = await open({
      title: "Select Songs Folder",
      directory: true,
      multiple: false,
    });
    if (selected === null) {
      return invoke<LibraryStatus>("get_library_status");
    }
    const path = Array.isArray(selected) ? selected[0] : selected;
    return invoke<LibraryStatus>("set_songs_folder", { path });
  },
  getLibraryStatus: () => invoke<LibraryStatus>("get_library_status"),
  rescanSongs: () => invoke<LibraryStatus>("rescan_songs"),
  searchSongs: (query: string, favoritesOnly = false) =>
    invoke<SongRow[]>("search_songs", { query, favoritesOnly }),
  searchWebSongs: (query: string) =>
    invoke<WebSearchCandidate[]>("search_web_songs", { query }),
  listByKey: (key: string) => invoke<SongRow[]>("list_by_key", { key }),
  listKeys: () => invoke<string[]>("list_keys"),
  listCategories: () => invoke<string[]>("list_categories"),
  getHistory: (limit = 50) => invoke<[string, string, string][]>("get_history", { limit }),
  toggleFavorite: (filename: string) => invoke<boolean>("toggle_favorite", { filename }),
  listFavorites: () => invoke<string[]>("list_favorites"),
  importMdbPath: (mdbPath: string) => invoke<ImportReport>("import_mdb_path", { mdbPath }),
  cancelImport: () => invoke<void>("cancel_import"),
  importMdb: async () => {
    const selected = await open({
      title: "Import legacy songbook",
      filters: [{ name: "Visual Song Book database", extensions: ["mdb"] }],
      multiple: false,
    });
    if (selected === null) {
      throw new Error("Import cancelled");
    }
    const mdbPath = Array.isArray(selected) ? selected[0] : selected;
    return invoke<ImportReport>("import_mdb_path", { mdbPath });
  },
  checkDuplicates: () => invoke<{ kind: string; message: string; filenames: string[] }[]>("check_duplicates"),
  listDuplicateGroups: (includeReviewed = false) =>
    invoke<DuplicateGroup[]>("list_duplicate_groups", { includeReviewed }),
  markDuplicateKeepBoth: (leftHash: string, rightHash: string) =>
    invoke<void>("mark_duplicate_keep_both", { leftHash, rightHash }),
  listRecoveryItems: () => invoke<RecoveryItem[]>("list_recovery_items"),
  restoreRecoveryItem: (id: string) => invoke<string>("restore_recovery_item", { id }),
  loadSong: (filename: string) => invoke<SongDetail>("load_song", { filename }),
  previewWebSong: (content: string) => invoke<SongDetail>("preview_web_song", { content }),
  projectSong: (source: { filename: string } | { content: string }) =>
    invoke<ProjectionSnapshot>("project_song", {
      filename: "filename" in source ? source.filename : null,
      content: "content" in source ? source.content : null,
    }),
  saveSong: (filename: string, content: string, expectedHash: string) =>
    invoke<SongDetail>("save_song", { filename, content, expectedHash }),
  saveSongLines: (filename: string, expectedHash: string, edits: SongLineEdit[]) =>
    invoke<SongDetail>("save_song_lines", { filename, expectedHash, edits }),
  saveWebSong: (content: string) => invoke<SongDetail>("save_web_song", { content }),
  deleteSong: (filename: string) => invoke<RecoveryItem>("delete_song", { filename }),
  openAudienceWindow: () => invoke<void>("open_audience_window"),
  closeAudienceWindow: () => invoke<void>("close_audience_window"),
  openStageWindow: () => invoke<void>("open_stage_window"),
  closeStageWindow: () => invoke<void>("close_stage_window"),
  closeProjectionWindows: () => invoke<void>("close_projection_windows"),
  showSlide: (index: number) => invoke<ProjectionSnapshot>("show_slide", { index }),
  nextSlide: () => invoke<ProjectionSnapshot>("next_slide"),
  previousSlide: () => invoke<ProjectionSnapshot>("previous_slide"),
  blankScreen: () => invoke<ProjectionSnapshot>("blank_screen"),
  getProjectionState: () => invoke<ProjectionState>("get_projection_state"),
  getProjectionSnapshot: () => invoke<ProjectionSnapshot>("get_projection_snapshot"),
  getNextSlidePreview: () => invoke<SlidePayload | null>("get_next_slide_preview"),
  setTranspose: (semitones: number) => invoke<ProjectionSnapshot>("set_transpose", { semitones }),
  logProjection: () => invoke<void>("log_projection"),
  listSetlists: () => invoke<Setlist[]>("list_setlists"),
  createSetlist: (name: string, date: string) =>
    invoke<Setlist>("create_setlist", { name, date }),
  loadSetlist: (id: string) => invoke<Setlist>("load_setlist", { id }),
  saveSetlist: (setlist: Setlist) => invoke<void>("save_setlist", { setlist }),
  setlistAdvance: () => invoke<SetlistItem | null>("setlist_advance"),
  setlistPrevious: () => invoke<SetlistItem | null>("setlist_previous"),
  addToSetlist: (id: string, filename: string) =>
    invoke<Setlist>("add_to_setlist", { id, filename }),
  removeFromSetlist: (id: string, filename: string) =>
    invoke<Setlist>("remove_from_setlist", { id, filename }),
  /** Today in the PC's regional short date format, or null off Windows. */
  formatShortDate: () => invoke<string | null>("format_short_date"),
  chooseVsbDatabase: async () => {
    const selected = await open({
      title: "Link a Visual Song Book database",
      filters: [{ name: "Visual Song Book database", extensions: ["mdb"] }],
      multiple: false,
    });
    if (selected === null) return undefined;
    const path = Array.isArray(selected) ? selected[0] : selected;
    return invoke<VsbSyncConfig | null>("set_vsb_database", { path });
  },
  unlinkVsbDatabase: () => invoke<VsbSyncConfig | null>("set_vsb_database", { path: null }),
  syncVsbDatabase: (force: boolean) =>
    invoke<VsbSyncReport | null>("sync_vsb_database", { force }),
  setReadOnly: (readOnly: boolean) => invoke<void>("set_read_only", { readOnly }),
  connectServerLibrary: (url: string, token: string) =>
    invoke<LibraryStatus>("connect_server_library", { url, token }),
  probeSongServer: (url: string) => invoke<ServerProbe>("probe_song_server", { url }),
  signInServerLibrary: (url: string) =>
    invoke<LibraryStatus>("sign_in_server_library", { url }),
  cancelServerSignIn: () => invoke<void>("cancel_server_sign_in"),
  syncServerLibrary: () => invoke<LibraryStatus>("sync_server_library"),
  syncServerSets: () => invoke<SetSyncReport>("sync_server_sets"),
  setServerRemoteEnabled: (enabled: boolean) => invoke<void>("set_server_remote_enabled", { enabled }),
  setActiveSetlist: (id: string | null) => invoke<void>("set_active_setlist", { id }),
  disconnectServerLibrary: () => invoke<void>("disconnect_server_library"),
  setWebSearchEnabled: (enabled: boolean) =>
    invoke<void>("set_web_search_enabled", { enabled }),
  setProjectToStage: (projectToStage: boolean) =>
    invoke<void>("set_project_to_stage", { projectToStage }),
  setShowSongNumbers: (enabled: boolean) =>
    invoke<void>("set_show_song_numbers", { enabled }),
  getConfig: () => invoke<AppConfig>("get_config"),
  getShortcuts: () => invoke<Partial<Record<string, string>>>("get_shortcuts"),
  saveShortcuts: (shortcuts: Record<string, string>) => invoke<void>("save_shortcuts", { shortcuts }),
  listDisplays: () => invoke<DisplayInfo[]>("list_displays"),
  setAudienceMonitor: (monitorId: string | null) =>
    invoke<void>("set_audience_monitor", { monitorId }),
  setStageMonitor: (monitorId: string | null) =>
    invoke<void>("set_stage_monitor", { monitorId }),
  exportCcliReport: (from: string, to: string) =>
    invoke<string>("export_ccli_report", { from, to }),
  printSongbookHtml: (title: string, includeIndexes: boolean) =>
    invoke<string>("print_songbook_html", { title, includeIndexes }),
  startRemote: (port?: number) => invoke<RemoteStatus>("start_remote", { port }),
  stopRemote: () => invoke<void>("stop_remote"),
  getRemoteStatus: () => invoke<RemoteStatus | null>("get_remote_status"),
};
