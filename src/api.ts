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
  slides: SlidePayload[];
  current_index: number;
  blank: boolean;
  transpose_semitones: number;
  hold_slide_id?: string | null;
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
  warnings: string[];
  cancelled: boolean;
}

export interface ImportProgress {
  current: number;
  total: number;
  song_title: string;
}

export interface Setlist {
  id: string;
  name: string;
  date: string;
  items: SetlistItem[];
}

export interface SetlistItem {
  type: "song" | "blank" | "hold";
  file?: string | null;
  transpose?: number | null;
  arrangement?: string | null;
  id?: string | null;
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

export interface AppConfig {
  last_songs_folder?: string | null;
  read_only: boolean;
  web_search_enabled: boolean;
  /** Show the song-number column in the song list (default on). */
  show_song_numbers: boolean;
  project_to_stage: boolean;
  audience_monitor?: string | null;
  stage_monitor?: string | null;
  remote_enabled: boolean;
  remote_pin?: string | null;
  remote_port: number;
  key_format_compressed: boolean;
  history_days: number;
  first_run_complete: boolean;
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
  loadSong: (filename: string) => invoke<SongDetail>("load_song", { filename }),
  saveSong: (filename: string, content: string) =>
    invoke<SongDetail>("save_song", { filename, content }),
  deleteSong: (filename: string) => invoke<void>("delete_song", { filename }),
  quickProject: (text: string, save: boolean) =>
    invoke<SongDetail>("quick_project", { text, save }),
  openAudienceWindow: () => invoke<void>("open_audience_window"),
  closeAudienceWindow: () => invoke<void>("close_audience_window"),
  openStageWindow: () => invoke<void>("open_stage_window"),
  closeStageWindow: () => invoke<void>("close_stage_window"),
  closeProjectionWindows: () => invoke<void>("close_projection_windows"),
  showSlide: (index: number) => invoke<ProjectionState>("show_slide", { index }),
  nextSlide: () => invoke<ProjectionState>("next_slide"),
  previousSlide: () => invoke<ProjectionState>("previous_slide"),
  blankScreen: () => invoke<ProjectionState>("blank_screen"),
  getProjectionState: () => invoke<ProjectionState>("get_projection_state"),
  getNextSlidePreview: () => invoke<SlidePayload | null>("get_next_slide_preview"),
  setTranspose: (semitones: number) => invoke<ProjectionState>("set_transpose", { semitones }),
  logProjection: () => invoke<void>("log_projection"),
  listSetlists: () => invoke<Setlist[]>("list_setlists"),
  createSetlist: (name: string, date: string) =>
    invoke<Setlist>("create_setlist", { name, date }),
  loadSetlist: (id: string) => invoke<Setlist>("load_setlist", { id }),
  saveSetlist: (setlist: Setlist) => invoke<void>("save_setlist", { setlist }),
  setlistAdvance: () => invoke<SetlistItem | null>("setlist_advance"),
  setlistPrevious: () => invoke<SetlistItem | null>("setlist_previous"),
  setReadOnly: (readOnly: boolean) => invoke<void>("set_read_only", { readOnly }),
  setWebSearchEnabled: (enabled: boolean) =>
    invoke<void>("set_web_search_enabled", { enabled }),
  setProjectToStage: (projectToStage: boolean) =>
    invoke<void>("set_project_to_stage", { projectToStage }),
  setShowSongNumbers: (enabled: boolean) =>
    invoke<void>("set_show_song_numbers", { enabled }),
  getConfig: () => invoke<AppConfig>("get_config"),
  listDisplays: () => invoke<DisplayInfo[]>("list_displays"),
  setAudienceMonitor: (monitorId: string | null) =>
    invoke<void>("set_audience_monitor", { monitorId }),
  setStageMonitor: (monitorId: string | null) =>
    invoke<void>("set_stage_monitor", { monitorId }),
  exportCcliReport: (from: string, to: string) =>
    invoke<string>("export_ccli_report", { from, to }),
  printSongbookHtml: (title: string, includeIndexes: boolean) =>
    invoke<string>("print_songbook_html", { title, includeIndexes }),
  startRemote: (port?: number) => invoke<{ running: boolean; port: number; pin: string }>("start_remote", { port }),
  stopRemote: () => invoke<void>("stop_remote"),
  getRemoteStatus: () => invoke<{ running: boolean; port: number; pin: string } | null>("get_remote_status"),
};
