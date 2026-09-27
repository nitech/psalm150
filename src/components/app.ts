import { html, nothing, type TemplateResult } from "lit";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { confirm } from "@tauri-apps/plugin-dialog";
import {
  api,
  type AppConfig,
  type DuplicateCandidate,
  type DuplicateGroup,
  SIMULATED_DISPLAY_ID,
  type DisplayInfo,
  type ImportProgress,
  type ImportReport,
  type LibraryStatus,
  type LyricLine,
  type ProjectionState,
  type ProjectionSnapshot,
  type RecoveryItem,
  type RemoteProject,
  type RemoteStatus,
  type ServerLibraryConfig,
  type SetSyncReport,
  type ServerSyncProgress,
  type Setlist,
  type SongDetail,
  type SongRow,
  type VsbSyncConfig,
  type VsbSyncFinished,
  type VsbSyncProgress,
  type WebSearchCandidate,
} from "../api";
import { icon } from "../icons";
import {
  DEFAULT_SHORTCUTS,
  SHORTCUT_ACTIONS,
  actionForCombo,
  comboFromEvent,
  formatCombo,
  hasCommandModifier,
  resolveShortcuts,
  shortcutProblem,
  VIEW_SHORTCUTS,
  type ShortcutAction,
  type ShortcutMap,
} from "../shortcuts";
import { applyKey, keyTokenAt, matchingKeys, parseSearch, type KeyToken } from "../search-query";
import {
  applyPendingEditsToLineText,
  collectLineEdits,
  diffLineSegments,
  hasPendingEdits,
  lineIsBlank,
  type PendingEdits,
} from "../adhoc-edit";
import {
  buildPerformanceSections,
  stanzaBlockKey,
  sourceLineKey,
} from "../performance-sections";
import {
  activeStanzaIndex,
  buildPreviewStanzaBlocksFromSections,
  buildStanzaMarkers,
  type PreviewStanzaBlock,
  stanzaStepSlideIndex,
} from "../stanza-markers";
import {
  parseSongSort,
  sortSongs,
  toggleSongSort,
  type SongSort,
  type SongSortColumn,
} from "../song-sort";
import { Psa150Element } from "./base";
import { StanzaNumberInput } from "../stanza-number-input";
import {
  projectionStructureSignature,
  shouldAcceptProjectionSnapshot,
  shouldResetStanzaSequence,
} from "../projection-snapshot";
import type { SelectOption } from "./select";
import "./select";
import "./modal";
import "./song-list";
import { isWebResultId, webResultId, webResultIndex } from "./song-list-ids";

/** What the browse pane lists: search results, or one of the toolbar views. */
type BrowseMode = "search" | "history" | "favorites" | "setlist";
/** The Settings check of the typed server URL. */
type ServerProbeState =
  | { status: "idle" }
  | { status: "checking" }
  | { status: "ok"; desktopSignIn: boolean; initialized: boolean }
  | { status: "error"; message: string };
type ToastTone = "info" | "success" | "error";
type SettingsSectionId =
  | "library"
  | "server"
  | "vsb"
  | "projection"
  | "search"
  | "remote"
  | "reports"
  | "shortcuts";

const SETTINGS_SECTIONS: ReadonlyArray<{
  id: SettingsSectionId;
  label: string;
  icon: string;
  keywords: string;
}> = [
  { id: "library", label: "Library", icon: "♫", keywords: "songs folder chordpro import mdb rescan duplicates numbers" },
  { id: "server", label: "Church server", icon: "↗", keywords: "server url token sync download offline cache church" },
  { id: "vsb", label: "Visual Song Book", icon: "⇄", keywords: "vsb visual song book mdb access database sync synchronize two-way backup" },
  { id: "projection", label: "Projection", icon: "▣", keywords: "congregation audience stage monitor display chords read only editing" },
  { id: "search", label: "Search", icon: "⌕", keywords: "web internet local songs match" },
  { id: "remote", label: "Phone remote", icon: "◌", keywords: "phone remote wifi network tailscale pin slides" },
  { id: "reports", label: "Reports", icon: "▤", keywords: "print songbook ccli csv export" },
  { id: "shortcuts", label: "Keyboard shortcuts", icon: "⌘", keywords: "keys keyboard hotkeys shortcuts alt ctrl enter arrows stanzas blank projection setlist favourite search" },
];

const BROWSE_TITLES: Record<Exclude<BrowseMode, "search">, string> = {
  history: "History",
  favorites: "Favourites",
  setlist: "Setlist",
};

const BROWSE_PANE_WIDTH_KEY = "psa150-browse-pane-width";
const BROWSE_PANE_MIN = 280;
const BROWSE_PANE_MAX = 720;
const BROWSE_PANE_DEFAULT = 340;
/** Wait after typing in the server URL field before checking it. */
const SERVER_PROBE_DELAY_MS = 450;
const WEB_SEARCH_DEBOUNCE_MS = 650;
const SONG_SORT_KEY = "psa150-song-sort";
const CURRENT_SETLIST_KEY = "psa150-current-setlist";

/**
 * Root component for the main window. Owns all application state and IPC
 * orchestration, and composes the presentational components (`psa150-song-list`,
 * `psa150-modal`).
 */
export class Psa150App extends Psa150Element {
  static properties = {
    songs: { state: true },
    currentSong: { state: true },
    currentFilename: { state: true },
    projection: { state: true },
    libraryStatus: { state: true },
    browseMode: { state: true },
    currentSetlist: { state: true },
    projectToStage: { state: true },
    readOnly: { state: true },
    serverLibrary: { state: true },
    lastLocalSongsFolder: { state: true },
    serverUrl: { state: true },
    serverToken: { state: true },
    serverSyncing: { state: true },
    serverProbe: { state: true },
    serverSignInWaiting: { state: true },
    serverSyncProgress: { state: true },
    webSearchEnabled: { state: true },
    displays: { state: true },
    audienceMonitor: { state: true },
    stageMonitor: { state: true },
    keys: { state: true },
    query: { state: true },
    keyToken: { state: true },
    keyMenuIndex: { state: true },
    setlists: { state: true },
    favoriteFiles: { state: true },
    shortcuts: { state: true },
    recordingShortcut: { state: true },
    shortcutError: { state: true },
    setlistMenuOpen: { state: true },
    newSetlistName: { state: true },
    vsbSync: { state: true },
    serverRemoteEnabled: { state: true },
    vsbProgress: { state: true },
    vsbSyncing: { state: true },
    editorValue: { state: true },
    settingsOpen: { state: true },
    activeSettingsSection: { state: true },
    settingsQuery: { state: true },
    editOpen: { state: true },
    importOpen: { state: true },
    importCurrent: { state: true },
    importTotal: { state: true },
    importSong: { state: true },
    importReportOpen: { state: true },
    importReport: { state: true },
    toastMsg: { state: true },
    toastTone: { state: true },
    toastVisible: { state: true },
    windowMaximized: { state: true },
    projecting: { state: true },
    browsePaneWidth: { state: true },
    webResults: { state: true },
    webSearchLoading: { state: true },
    adhocEditingBlockKey: { state: true },
    adhocPendingEdits: { state: true },
    showSongNumbers: { state: true },
    songSort: { state: true },
    remoteStatus: { state: true },
    activeProjectionTitle: { state: true },
    duplicatesOpen: { state: true },
    duplicateGroups: { state: true },
    duplicateGroupId: { state: true },
    duplicateLeft: { state: true },
    duplicateRight: { state: true },
    includeReviewedDuplicates: { state: true },
    recoveryItems: { state: true },
    duplicatesStale: { state: true },
  };

  declare songs: SongRow[];
  declare currentSong: SongDetail | null;
  declare currentFilename: string | null;
  declare projection: ProjectionState | null;
  declare libraryStatus: LibraryStatus | null;
  declare browseMode: BrowseMode;
  declare currentSetlist: Setlist | null;
  declare projectToStage: boolean;
  declare readOnly: boolean;
  declare serverLibrary: ServerLibraryConfig | null;
  declare lastLocalSongsFolder: string | null;
  declare serverUrl: string;
  declare serverToken: string;
  declare serverSyncing: boolean;
  declare serverProbe: ServerProbeState;
  declare serverSignInWaiting: boolean;
  declare serverSyncProgress: ServerSyncProgress | null;
  declare webSearchEnabled: boolean;
  declare displays: DisplayInfo[];
  declare audienceMonitor: string;
  declare stageMonitor: string;
  declare keys: string[];
  declare query: string;
  /** The `#…` word being typed in the search field, while it can become a key. */
  declare keyToken: KeyToken | null;
  declare keyMenuIndex: number;
  declare setlists: Setlist[];
  /** Filenames marked as favourites, for the star on the song title row. */
  declare favoriteFiles: Set<string>;
  declare shortcuts: ShortcutMap;
  /** Settings row waiting for a new key combination. */
  declare recordingShortcut: ShortcutAction | null;
  declare shortcutError: string | null;
  declare setlistMenuOpen: boolean;
  declare newSetlistName: string;
  declare vsbSync: VsbSyncConfig | null;
  declare serverRemoteEnabled: boolean;
  declare vsbProgress: VsbSyncProgress | null;
  declare vsbSyncing: boolean;
  declare editorValue: string;
  declare settingsOpen: boolean;
  declare activeSettingsSection: SettingsSectionId;
  declare settingsQuery: string;
  declare editOpen: boolean;
  declare importOpen: boolean;
  declare importCurrent: number;
  declare importTotal: number;
  declare importSong: string;
  declare importReportOpen: boolean;
  declare importReport: ImportReport | null;
  declare toastMsg: string;
  declare toastTone: ToastTone;
  declare toastVisible: boolean;
  declare windowMaximized: boolean;
  declare projecting: boolean;
  declare browsePaneWidth: number;
  declare webResults: WebSearchCandidate[];
  declare webSearchLoading: boolean;
  declare adhocEditingBlockKey: string | null;
  declare adhocPendingEdits: PendingEdits;
  declare showSongNumbers: boolean;
  declare songSort: SongSort;
  declare remoteStatus: RemoteStatus | null;
  declare activeProjectionTitle: string | null;
  declare duplicatesOpen: boolean;
  declare duplicateGroups: DuplicateGroup[];
  declare duplicateGroupId: string | null;
  declare duplicateLeft: string | null;
  declare duplicateRight: string | null;
  declare includeReviewedDuplicates: boolean;
  declare recoveryItems: RecoveryItem[];
  declare duplicatesStale: boolean;

  private toastTimer: ReturnType<typeof setTimeout> | null = null;
  private webSearchTimer: ReturnType<typeof setTimeout> | null = null;
  private webSearchGeneration = 0;
  private unlistenImport: UnlistenFn | null = null;
  private unlistenServerSync: UnlistenFn | null = null;
  private serverProbeTimer: ReturnType<typeof setTimeout> | null = null;
  private serverProbeGeneration = 0;
  private unlistenLibrary: UnlistenFn | null = null;
  private unlistenProjection: UnlistenFn | null = null;
  private unlistenProjectionClosed: UnlistenFn | null = null;
  private unlistenProjectionEscaped: UnlistenFn | null = null;
  private unlistenExternalLibrary: UnlistenFn | null = null;
  private unlistenWindowResize: UnlistenFn | null = null;
  private unlistenVsbProgress: UnlistenFn | null = null;
  private unlistenVsbFinished: UnlistenFn | null = null;
  private unlistenSetlistsChanged: UnlistenFn | null = null;
  private unlistenRemoteProject: UnlistenFn | null = null;
  private importBusy = false;
  private keysLoaded = false;
  private songsRefreshGeneration = 0;
  /** The current mouse press on the search field is what focuses it. */
  private searchClickFocuses = false;
  private splitterDragging = false;
  private sortedSongsCache: { songs: SongRow[]; sort: SongSort; sorted: SongRow[] } | null = null;
  private stanzaNumberInput = new StanzaNumberInput();
  private projectionRevision = -1;
  private projectionSessionId: string | null = null;
  private projectionStructure = "";
  private selectionGeneration = 0;
  private activeSelectionId: string | null = null;

  constructor() {
    super();
    this.songs = [];
    this.currentSong = null;
    this.currentFilename = null;
    this.projection = null;
    this.libraryStatus = null;
    this.browseMode = "search";
    this.currentSetlist = null;
    this.projectToStage = false;
    this.readOnly = false;
    this.serverLibrary = null;
    this.lastLocalSongsFolder = null;
    this.serverUrl = "";
    this.serverToken = "";
    this.serverSyncing = false;
    this.serverProbe = { status: "idle" };
    this.serverSignInWaiting = false;
    this.serverSyncProgress = null;
    this.webSearchEnabled = true;
    this.displays = [];
    this.audienceMonitor = "";
    this.stageMonitor = "";
    this.keys = [];
    this.query = "";
    this.keyToken = null;
    this.keyMenuIndex = 0;
    this.setlists = [];
    this.favoriteFiles = new Set();
    this.shortcuts = { ...DEFAULT_SHORTCUTS };
    this.recordingShortcut = null;
    this.shortcutError = null;
    this.setlistMenuOpen = false;
    this.newSetlistName = "";
    this.vsbSync = null;
    this.serverRemoteEnabled = false;
    this.vsbProgress = null;
    this.vsbSyncing = false;
    this.editorValue = "";
    this.settingsOpen = false;
    this.activeSettingsSection = "library";
    this.settingsQuery = "";
    this.editOpen = false;
    this.importOpen = false;
    this.importCurrent = 0;
    this.importTotal = 0;
    this.importSong = "";
    this.importReportOpen = false;
    this.importReport = null;
    this.toastMsg = "";
    this.toastTone = "info";
    this.toastVisible = false;
    this.windowMaximized = false;
    this.projecting = false;
    const savedWidth = localStorage.getItem(BROWSE_PANE_WIDTH_KEY);
    const parsed = savedWidth ? Number.parseInt(savedWidth, 10) : Number.NaN;
    this.browsePaneWidth =
      Number.isFinite(parsed) && parsed >= BROWSE_PANE_MIN ? parsed : BROWSE_PANE_DEFAULT;
    this.webResults = [];
    this.webSearchLoading = false;
    this.adhocEditingBlockKey = null;
    this.adhocPendingEdits = new Map();
    this.showSongNumbers = true;
    this.songSort = parseSongSort(localStorage.getItem(SONG_SORT_KEY));
    this.remoteStatus = null;
    this.activeProjectionTitle = null;
    this.duplicatesOpen = false;
    this.duplicateGroups = [];
    this.duplicateGroupId = null;
    this.duplicateLeft = null;
    this.duplicateRight = null;
    this.includeReviewedDuplicates = false;
    this.recoveryItems = [];
    this.duplicatesStale = false;
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────

  connectedCallback() {
    super.connectedCallback();
    window.addEventListener("keydown", this.onRecordShortcutKeydown, true);
    window.addEventListener("keydown", this.onGlobalKeydown);
    window.addEventListener("blur", this.stanzaNumberInput.reset);
    window.addEventListener("focusin", this.stanzaNumberInput.reset);
    window.addEventListener("pointerdown", this.stanzaNumberInput.reset);
    document.addEventListener("pointerdown", this.onDocumentPointerDown);
    void getCurrentWebviewWindow().setFocus();
    void this.initWindowChrome();
    void this.init();
  }

  private async initWindowChrome() {
    const win = getCurrentWebviewWindow();
    try {
      this.windowMaximized = await win.isMaximized();
      this.unlistenWindowResize = await win.onResized(async () => {
        this.windowMaximized = await win.isMaximized();
      });
    } catch (err) {
      console.error(err);
    }
  }

  private onTitlebarDblClick = async (event: MouseEvent) => {
    if ((event.target as HTMLElement).closest(".app-no-drag")) return;
    await this.toggleWindowMaximize();
  };

  private async minimizeWindow() {
    await getCurrentWebviewWindow().minimize();
  }

  private async toggleWindowMaximize() {
    const win = getCurrentWebviewWindow();
    await win.toggleMaximize();
    this.windowMaximized = await win.isMaximized();
  }

  private async closeWindow() {
    await getCurrentWebviewWindow().close();
  }

  private async init() {
    try {
      this.unlistenLibrary = await listen("library-changed", async () => {
        this.keysLoaded = false;
        await this.refreshLibraryStatus();
        await this.refreshSetlists();
        await this.refreshFavorites();
        await this.refreshSongs();
      });
      this.unlistenExternalLibrary = await listen("library-external-changed", () => {
        if (this.duplicatesOpen) this.duplicatesStale = true;
      });
      this.unlistenProjection = await listen<ProjectionSnapshot>("projection-updated", (event) => {
        this.applyProjectionSnapshot(event.payload);
      });
      this.unlistenProjectionClosed = await listen("projection-closed", () => {
        this.stanzaNumberInput.reset();
        this.projecting = false;
      });
      this.unlistenProjectionEscaped = await listen("projection-escaped", () => {
        void this.startFreshSearch();
      });
      this.unlistenVsbProgress = await listen<VsbSyncProgress>("vsb-sync-progress", (event) => {
        this.vsbSyncing = true;
        this.vsbProgress = event.payload;
      });
      this.unlistenVsbFinished = await listen<VsbSyncFinished>("vsb-sync-finished", (event) => {
        void this.onVsbSyncFinished(event.payload);
      });
      this.unlistenSetlistsChanged = await listen<SetSyncReport>("setlists-changed", (event) => {
        void this.onSetlistsChanged(event.payload);
      });
      this.unlistenRemoteProject = await listen<RemoteProject>("remote-project", (event) => {
        void this.onRemoteProject(event.payload);
      });
      this.applyProjectionSnapshot(await api.getProjectionSnapshot());
      this.shortcuts = resolveShortcuts(await api.getShortcuts().catch(() => null));
    } catch (err) {
      console.error(err);
    }
    await this.bootstrapLibrary();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    window.removeEventListener("keydown", this.onRecordShortcutKeydown, true);
    window.removeEventListener("keydown", this.onGlobalKeydown);
    window.removeEventListener("blur", this.stanzaNumberInput.reset);
    window.removeEventListener("focusin", this.stanzaNumberInput.reset);
    window.removeEventListener("pointerdown", this.stanzaNumberInput.reset);
    this.stanzaNumberInput.reset();
    this.unlistenLibrary?.();
    this.unlistenProjection?.();
    this.unlistenProjectionClosed?.();
    this.unlistenProjectionEscaped?.();
    this.unlistenExternalLibrary?.();
    this.unlistenWindowResize?.();
    this.unlistenVsbProgress?.();
    this.unlistenVsbFinished?.();
    this.unlistenSetlistsChanged?.();
    this.unlistenRemoteProject?.();
    document.removeEventListener("pointerdown", this.onDocumentPointerDown);
    void this.unlistenImport?.();
    void this.unlistenServerSync?.();
  }

  firstUpdated() {
    this.focusActiveBrowseField();
  }

  /** Clicking outside the setlist menu or the key list closes it. */
  private onDocumentPointerDown = (event: PointerEvent) => {
    const target = event.target as HTMLElement | null;
    if (this.setlistMenuOpen && !target?.closest(".setlist-menu, .setlist-btn")) {
      this.setlistMenuOpen = false;
    }
    if (this.keyToken && !target?.closest(".search-wrap")) {
      this.keyToken = null;
    }
  };

  updated(changed: Map<string, unknown>) {
    if (changed.has("projection") || changed.has("projecting")) {
      if (this.isProjectionActive()) {
        requestAnimationFrame(() => this.scrollActiveStanzaIntoView());
      }
    }
  }

  private scrollActiveStanzaIntoView(behavior: ScrollBehavior = "smooth") {
    const active = this.querySelector<HTMLElement>(".song-stanza.active");
    if (!active) return;
    active.scrollIntoView({ block: "nearest", behavior });
  }

  // ── Derived helpers ────────────────────────────────────────────────────

  private isProjectionActive(): boolean {
    return Boolean(
      this.projecting &&
        this.projection &&
        this.projection.slides.length > 0 &&
        !this.projection.blank,
    );
  }

  private onSplitterPointerDown = (event: PointerEvent) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const splitter = event.currentTarget as HTMLElement;
    splitter.setPointerCapture(event.pointerId);
    this.splitterDragging = true;
    document.body.classList.add("workspace-resizing");
  };

  private onSplitterPointerMove = (event: PointerEvent) => {
    if (!this.splitterDragging) return;
    const workspace = this.querySelector<HTMLElement>(".workspace");
    if (!workspace) return;
    const rect = workspace.getBoundingClientRect();
    const padLeft = Number.parseFloat(getComputedStyle(workspace).paddingLeft) || 0;
    const width = Math.round(
      Math.min(
        BROWSE_PANE_MAX,
        Math.max(BROWSE_PANE_MIN, event.clientX - rect.left - padLeft),
      ),
    );
    this.browsePaneWidth = width;
  };

  private onSplitterPointerUp = (event: PointerEvent) => {
    if (!this.splitterDragging) return;
    this.splitterDragging = false;
    document.body.classList.remove("workspace-resizing");
    const splitter = event.currentTarget as HTMLElement;
    if (splitter.hasPointerCapture(event.pointerId)) {
      splitter.releasePointerCapture(event.pointerId);
    }
    localStorage.setItem(BROWSE_PANE_WIDTH_KEY, String(this.browsePaneWidth));
  };

  private focusSearchField(selectAll = false) {
    const input = this.querySelector<HTMLInputElement>("#search-input");
    if (!input) return;
    input.focus({ preventScroll: true });
    if (selectAll) input.select();
  }

  private focusActiveBrowseField() {
    requestAnimationFrame(() => {
      if (this.browseMode === "search") this.focusSearchField();
    });
  }

  // ── Library / data ─────────────────────────────────────────────────────

  private async refreshLibraryStatus() {
    this.libraryStatus = await api.getLibraryStatus();
  }

  private async refreshSongs() {
    const generation = ++this.songsRefreshGeneration;
    try {
      let songs: SongRow[];
      if (this.browseMode === "favorites") {
        songs = await api.searchSongs("", true);
      } else if (this.browseMode === "history") {
        const history = await api.getHistory(50);
        songs = history.map(([filename, title], index) => syntheticRow(index, filename, title));
      } else if (this.browseMode === "setlist") {
        songs = await this.setlistRows();
      } else {
        if (this.query.includes("#")) await this.loadKeyOptions();
        const { key, text } = parseSearch(this.query, this.keys);
        if (key) {
          const inKey = await api.listByKey(key);
          if (text) {
            const matching = new Set((await api.searchSongs(text, false)).map((row) => row.filename));
            songs = inKey.filter((row) => matching.has(row.filename));
          } else {
            songs = inKey;
          }
        } else {
          songs = await api.searchSongs(text, false);
        }
      }
      if (generation !== this.songsRefreshGeneration) return;
      this.songs = songs;
      if (this.browseMode === "search") {
        void this.selectOnlyHit();
        void this.maybeSearchWeb(generation);
      } else {
        this.webResults = [];
        this.webSearchLoading = false;
      }
    } catch {
      // Library may not be open yet (no songs folder selected, or still loading).
      if (generation !== this.songsRefreshGeneration) return;
      this.songs = [];
      if (this.browseMode === "search") {
        void this.maybeSearchWeb(generation);
      }
    }
  }

  /** A search with exactly one hit selects and shows it; focus stays in the field. */
  private async selectOnlyHit() {
    if (!this.query.trim() || this.songs.length !== 1) return;
    const only = this.songs[0].filename;
    if (only === this.currentFilename) return;
    if (this.editOpen || hasPendingEdits(this.adhocPendingEdits)) return;
    await this.selectSong(only);
  }

  /** Items of the current setlist in service order, with titles from the index. */
  private async setlistRows(): Promise<SongRow[]> {
    const files = (this.currentSetlist?.items ?? [])
      .filter((item) => item.type === "song" && item.file)
      .map((item) => item.file!);
    if (!files.length) return [];
    const library = new Map((await api.searchSongs("", false)).map((row) => [row.filename, row]));
    return files.map(
      (file, index) =>
        library.get(file) ?? syntheticRow(index, file, file.replace(/\.(pro|cho)$/i, "")),
    );
  }

  private cancelWebSearch() {
    if (this.webSearchTimer) {
      clearTimeout(this.webSearchTimer);
      this.webSearchTimer = null;
    }
    this.webSearchGeneration += 1;
    this.webResults = [];
    this.webSearchLoading = false;
    if (this.currentFilename && isWebResultId(this.currentFilename)) {
      this.currentFilename = null;
      this.currentSong = null;
    }
  }

  private maybeSearchWeb(songsGeneration: number) {
    if (!this.webSearchEnabled) {
      this.cancelWebSearch();
      return;
    }
    if (this.webSearchTimer) {
      clearTimeout(this.webSearchTimer);
      this.webSearchTimer = null;
    }
    this.webSearchGeneration += 1;
    const searchGeneration = this.webSearchGeneration;

    const { key, text: q } = parseSearch(this.query, this.keys);
    if (key || q.length < 3 || this.songs.length > 0) {
      this.webResults = [];
      this.webSearchLoading = false;
      if (this.currentFilename && isWebResultId(this.currentFilename)) {
        this.currentFilename = null;
        this.currentSong = null;
      }
      return;
    }

    this.webSearchLoading = false;
    this.webSearchTimer = setTimeout(() => {
      this.webSearchTimer = null;
      void this.runWebSearch(searchGeneration, songsGeneration);
    }, WEB_SEARCH_DEBOUNCE_MS);
  }

  private async runWebSearch(searchGeneration: number, songsGeneration: number) {
    if (searchGeneration !== this.webSearchGeneration) return;
    if (songsGeneration !== this.songsRefreshGeneration) return;

    const { key, text: q } = parseSearch(this.query, this.keys);
    if (key || q.length < 3 || this.songs.length > 0) return;

    this.webSearchLoading = true;
    try {
      const results = await api.searchWebSongs(q);
      if (searchGeneration !== this.webSearchGeneration) return;
      if (songsGeneration !== this.songsRefreshGeneration) return;
      this.webResults = results;
      if (results.length > 0) {
        await this.selectSong(webResultId(0));
      } else if (this.currentFilename && isWebResultId(this.currentFilename)) {
        this.currentFilename = null;
        this.currentSong = null;
      }
    } catch {
      if (searchGeneration !== this.webSearchGeneration) return;
      if (songsGeneration !== this.songsRefreshGeneration) return;
      this.webResults = [];
      this.showToast("Web search failed", "error");
    } finally {
      if (searchGeneration === this.webSearchGeneration) {
        this.webSearchLoading = false;
      }
    }
  }

  private async saveWebResult() {
    if (!this.currentFilename || !isWebResultId(this.currentFilename)) return;
    const candidate = this.webResults[webResultIndex(this.currentFilename)];
    if (!candidate) return;
    if (this.readOnly) {
      this.showToast("Library is read-only", "error");
      return;
    }
    const ok = await confirm(`Save "${candidate.title}" to your songs folder?`, {
      title: "Save song",
      kind: "info",
    });
    if (!ok) return;
    try {
      const saved = await api.saveWebSong(candidate.chordpro_content);
      await this.refreshLibraryStatus();
      await this.refreshSongs();
      this.currentSong = saved;
      this.currentFilename = saved.parsed.meta.filename as string;
      this.showToast(`Saved ${candidate.title}`, "success");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.showToast(message, "error");
    }
  }

  private async loadKeyOptions() {
    if (this.keysLoaded) return;
    try {
      this.keys = await api.listKeys();
      this.keysLoaded = true;
    } catch {
      // Library not open yet.
    }
  }

  private resetAdhocEdits() {
    this.adhocEditingBlockKey = null;
    this.adhocPendingEdits = new Map();
  }

  private canAdhocEdit(): boolean {
    if (!this.songEditsAllowed()) return false;
    if (!this.currentSong) return false;
    if (this.currentFilename && isWebResultId(this.currentFilename)) return false;
    return Boolean(this.currentSong.projection.filename);
  }

  /** Song edits save to the folder, or to the song server for a server library. */
  private songEditsAllowed(): boolean {
    return !this.readOnly || Boolean(this.serverLibrary);
  }

  private selectedSongIsActive(): boolean {
    return Boolean(this.currentFilename && this.currentFilename === this.activeSelectionId);
  }

  private async confirmDiscardPendingEdits(): Promise<boolean> {
    const fullEditChanged = Boolean(
      this.editOpen && this.currentSong && this.editorValue !== this.currentSong.parsed.raw,
    );
    if (!fullEditChanged && !hasPendingEdits(this.adhocPendingEdits)) return true;
    const save = await confirm(
      "This song has unsaved corrections. Save them before continuing?",
      {
        title: "Unsaved corrections",
        kind: "info",
        okLabel: "Save",
        cancelLabel: "More options",
      },
    );
    if (save) {
      const saved = fullEditChanged ? await this.saveSong() : await this.saveAdhocEdits();
      if (saved) this.editOpen = false;
      return saved;
    }
    const discard = await confirm("Discard the corrections?", {
      title: "Unsaved corrections",
      kind: "warning",
      okLabel: "Discard",
      cancelLabel: "Cancel",
    });
    if (discard) {
      this.editOpen = false;
      this.resetAdhocEdits();
    }
    return discard;
  }

  private async selectSong(file: string) {
    if (file === this.currentFilename) return;
    if (!(await this.confirmDiscardPendingEdits())) return;
    const generation = ++this.selectionGeneration;
    this.resetAdhocEdits();
    this.currentFilename = file;
    if (isWebResultId(file)) {
      const candidate = this.webResults[webResultIndex(file)];
      if (!candidate) {
        this.currentSong = null;
        return;
      }
      const loaded = await api.previewWebSong(candidate.chordpro_content);
      if (generation !== this.selectionGeneration || this.currentFilename !== file) return;
      this.currentSong = loaded;
      return;
    }
    const loaded = await api.loadSong(file);
    if (generation !== this.selectionGeneration || this.currentFilename !== file) return;
    this.currentSong = loaded;
  }

  private async pickFolder() {
    try {
      if (!(await this.confirmDiscardPendingEdits())) return;
      if (this.projecting) {
        await api.closeProjectionWindows();
      }
      this.libraryStatus = await api.pickSongsFolder();
      this.applyConfig(await api.getConfig());
      await this.refreshSongs();
      if (this.libraryStatus?.songs_folder) {
        this.showToast("Songs folder updated");
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.showToast(message, "error");
    }
  }

  private async rescan() {
    this.libraryStatus = await api.rescanSongs();
    await this.refreshSongs();
    this.showToast("Library rescanned");
  }

  // ── Projection ─────────────────────────────────────────────────────────

  private applyProjectionSnapshot(snapshot: ProjectionSnapshot) {
    if (!shouldAcceptProjectionSnapshot(this.projectionRevision, snapshot)) return;
    const structure = projectionStructureSignature(snapshot.projection.slides);
    const sessionChanged = snapshot.session_id !== this.projectionSessionId;
    if (shouldResetStanzaSequence(this.projectionSessionId, this.projectionStructure, snapshot)) {
      this.stanzaNumberInput.reset();
    }
    if (sessionChanged) {
      this.activeSelectionId = snapshot.session_id ? snapshot.projection.filename ?? null : null;
    }
    this.projectionRevision = snapshot.revision;
    this.projectionSessionId = snapshot.session_id;
    this.projectionStructure = structure;
    this.projection = snapshot.projection;
    this.activeProjectionTitle = snapshot.session_id
      ? snapshot.projection.title ?? "Untitled"
      : null;
  }

  private async projectLoadedSong() {
    this.stanzaNumberInput.reset();
    if (!this.currentFilename || !this.currentSong) return;

    const sourceId = this.currentFilename;
    const snapshot = isWebResultId(sourceId)
      ? await api.projectSong({ content: this.currentSong.parsed.raw })
      : await api.projectSong({ filename: sourceId });
    this.applyProjectionSnapshot(snapshot);
    this.activeSelectionId = sourceId;

    this.projecting = true;
    // Leave text fields so digits, arrows and B drive the projection at once
    // (Enter in the search field projects). Ctrl+F returns to searching.
    this.querySelector<HTMLElement>("psa150-song-list li:focus")?.blur();
    const focused = document.activeElement;
    if (focused instanceof HTMLElement && isTextEntryTarget(focused) && this.contains(focused)) {
      focused.blur();
    }
    this.keyToken = null;
    await this.updateComplete;

    await api.openAudienceWindow();
    if (this.projectToStage) {
      await api.openStageWindow();
    }
    if (this.audienceMonitor !== SIMULATED_DISPLAY_ID) {
      await getCurrentWebviewWindow().setFocus();
    }
    await this.updateComplete;
    this.scrollActiveStanzaIntoView();
  }

  private async advanceSlide(direction: "next" | "prev") {
    if (!this.projecting || !this.projection?.slides.length) return;
    this.applyProjectionSnapshot(
      direction === "next" ? await api.nextSlide() : await api.previousSlide(),
    );
  }

  private async advanceStanza(direction: "next" | "prev") {
    if (!this.projecting || !this.projection?.slides.length) return;
    const markers = buildStanzaMarkers(this.projection.slides);
    const slideIndex = stanzaStepSlideIndex(
      markers,
      this.projection.current_index,
      direction,
    );
    if (slideIndex === null) return;
    await this.jumpToStanza(slideIndex);
  }

  private async jumpToStanza(slideIndex: number) {
    this.stanzaNumberInput.reset();
    if (!this.projecting || !this.projection?.slides.length) return;
    this.applyProjectionSnapshot(await api.showSlide(slideIndex));
  }

  // ── Editing ────────────────────────────────────────────────────────────

  private openEdit() {
    if (!this.currentSong) return;
    if (hasPendingEdits(this.adhocPendingEdits)) {
      this.showToast("Save or discard the inline corrections before opening the raw editor", "info");
      return;
    }
    this.editorValue = this.currentSong.parsed.raw;
    this.editOpen = true;
    requestAnimationFrame(() => this.querySelector<HTMLTextAreaElement>("#editor")?.focus());
  }

  private async saveSong(): Promise<boolean> {
    if (!this.currentSong || !this.currentFilename || isWebResultId(this.currentFilename)) return false;
    try {
      this.currentSong = await api.saveSong(
        this.currentFilename,
        this.editorValue,
        this.currentSong.content_hash,
      );
      this.editorValue = this.currentSong.parsed.raw;
      this.editOpen = false;
      this.showToast(this.serverLibrary ? "Song saved to the song server" : "Song saved", "success");
      await this.refreshSongs();
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("FILE_SAVED_INDEX_FAILED")) {
        this.currentSong = await api.loadSong(this.currentFilename).catch(() => this.currentSong);
        if (this.currentSong) this.editorValue = this.currentSong.parsed.raw;
      }
      this.showToast(message, "error");
      return message.includes("FILE_SAVED_INDEX_FAILED");
    }
  }

  private enterAdhocEdit(blockKey: string, event?: Event) {
    if (!this.canAdhocEdit()) return;
    event?.stopPropagation();
    this.adhocEditingBlockKey = blockKey;
  }

  private exitAdhocEdit() {
    this.adhocEditingBlockKey = null;
  }

  private onAdhocLineInput(
    provenance: { sectionIndex: number; lineIndex: number },
    originalText: string,
    event: Event,
  ) {
    const text = (event.target as HTMLElement).textContent ?? "";
    const key = sourceLineKey(provenance.sectionIndex, provenance.lineIndex);
    const existing = this.adhocPendingEdits.get(key);
    const original = existing?.original ?? originalText;
    const next = new Map(this.adhocPendingEdits);
    if (text === original) {
      next.delete(key);
    } else {
      next.set(key, { original, text });
    }
    this.adhocPendingEdits = next;
  }

  private async saveAdhocEdits(): Promise<boolean> {
    if (!this.currentSong?.projection.filename || !hasPendingEdits(this.adhocPendingEdits)) {
      return false;
    }
    const filename = this.currentSong.projection.filename;
    try {
      this.currentSong = await api.saveSongLines(
        filename,
        this.currentSong.content_hash,
        collectLineEdits(this.adhocPendingEdits),
      );
      this.resetAdhocEdits();
      this.showToast(this.serverLibrary ? "Corrections saved to the song server" : "Corrections saved", "success");
      await this.refreshSongs();
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("FILE_SAVED_INDEX_FAILED")) {
        this.currentSong = await api.loadSong(filename).catch(() => this.currentSong);
        this.resetAdhocEdits();
      }
      this.showToast(message, "error");
      return message.includes("FILE_SAVED_INDEX_FAILED");
    }
  }

  private displayLineText(
    provenance: { sectionIndex: number; lineIndex: number },
    originalText: string,
  ): string {
    return applyPendingEditsToLineText(
      provenance.sectionIndex,
      provenance.lineIndex,
      originalText,
      this.adhocPendingEdits,
    );
  }

  private lineHasPendingEdit(provenance: { sectionIndex: number; lineIndex: number }): boolean {
    const edit = this.adhocPendingEdits.get(
      sourceLineKey(provenance.sectionIndex, provenance.lineIndex),
    );
    return Boolean(edit && edit.text !== edit.original);
  }

  private async deleteSong() {
    if (!this.currentSong || !this.currentFilename || isWebResultId(this.currentFilename)) return;
    const filename = this.currentFilename;
    const title = (this.currentSong.parsed.meta.title as string) || "Untitled";
    const ok = await confirm(`Delete "${title}" (${filename})? A recovery copy will be kept.`, {
      title: "Delete song",
      kind: "warning",
      okLabel: "Delete",
      cancelLabel: "Cancel",
    });
    if (!ok) return;
    try {
      await api.deleteSong(filename);
      this.currentSong = null;
      this.currentFilename = null;
      this.editOpen = false;
      await this.refreshSongs();
      if (this.duplicatesOpen) await this.refreshDuplicates();
      this.showToast("Song deleted; recovery copy retained", "success");
    } catch (err) {
      this.showToast(err instanceof Error ? err.message : String(err), "error");
    }
  }

  private async transpose(delta: number) {
    this.applyProjectionSnapshot(
      await api.setTranspose((this.projection?.transpose_semitones ?? 0) + delta),
    );
  }

  // ── Import ─────────────────────────────────────────────────────────────

  private async ensureSongsFolder(): Promise<boolean> {
    if (this.libraryStatus?.songs_folder) return true;
    const proceed = await confirm(
      "Choose a folder where ChordPro (.pro) song files will be stored before importing.",
      {
        title: "Select songs folder",
        kind: "info",
        okLabel: "Choose folder",
        cancelLabel: "Cancel",
      },
    );
    if (!proceed) return false;
    this.libraryStatus = await api.pickSongsFolder();
    if (!this.libraryStatus?.songs_folder) {
      this.showToast("Import cancelled — no songs folder selected.", "error");
      return false;
    }
    await this.refreshSongs();
    return true;
  }

  private async runImportMdb() {
    if (this.importBusy) return;
    try {
      if (!(await this.ensureSongsFolder())) return;
      this.unlistenImport = await listen<ImportProgress>("import-progress", (event) => {
        this.updateImportProgress(event.payload);
      });
      this.importBusy = true;
      this.updateImportProgress({ current: 0, total: 0, song_title: "Preparing…" });
      this.importOpen = true;

      const report = await api.importMdb();
      await this.closeImport();
      this.importReport = report;
      this.importReportOpen = true;
      this.showToast(
        this.formatImportReport(report),
        report.failed > 0 ? "error" : report.cancelled || report.aborted_reason ? "info" : "success",
      );
      await this.refreshLibraryStatus();
      await this.refreshSongs();
    } catch (err) {
      await this.closeImport();
      const message = err instanceof Error ? err.message : String(err);
      if (message !== "Import cancelled") this.showToast(message, "error");
    }
  }

  private updateImportProgress(progress: ImportProgress) {
    this.importCurrent = progress.current;
    this.importTotal = progress.total;
    this.importSong = progress.song_title || "Preparing…";
  }

  private async closeImport() {
    this.importBusy = false;
    this.importOpen = false;
    if (this.unlistenImport) {
      await this.unlistenImport();
      this.unlistenImport = null;
    }
  }

  private formatImportReport(report: ImportReport): string {
    const warningNote = report.warnings.length > 0 ? ` (${report.warnings.length} warnings)` : "";
    const totals = `${report.written} imported, ${report.skipped} skipped, ${report.failed} failed`;
    if (report.aborted_reason) {
      return `Import stopped: ${report.aborted_reason}. ${totals}${warningNote}.`;
    }
    if (report.cancelled) {
      return `Import cancelled: ${totals}${warningNote}.`;
    }
    return `Import complete: ${totals}${warningNote}.`;
  }

  // ── Settings persistence ───────────────────────────────────────────────

  private async openSettings() {
    this.settingsQuery = "";
    this.activeSettingsSection = "library";
    this.settingsOpen = true;
    try {
      const [config, displays, remote] = await Promise.all([
        api.getConfig(),
        api.listDisplays(),
        api.getRemoteStatus().catch(() => null),
      ]);
      this.applyConfig(config);
      this.displays = displays;
      this.remoteStatus = remote;
    } catch {
      // Config not loaded yet.
    }
  }

  private applyConfig(config: AppConfig) {
    this.projectToStage = Boolean(config.project_to_stage);
    this.serverLibrary = config.server_library ?? null;
    this.lastLocalSongsFolder = config.last_local_songs_folder ?? null;
    this.serverUrl = this.serverLibrary?.url ?? "";
    this.readOnly = Boolean(config.read_only) || Boolean(this.serverLibrary);
    this.webSearchEnabled = config.web_search_enabled !== false;
    this.audienceMonitor = config.audience_monitor ?? "";
    this.stageMonitor = config.stage_monitor ?? "";
    this.showSongNumbers = config.show_song_numbers !== false;
    this.vsbSync = config.vsb_sync ?? null;
    this.serverRemoteEnabled = Boolean(config.server_remote_enabled);
    if (!this.webSearchEnabled) {
      this.cancelWebSearch();
    }
  }

  private async onAudienceMonitorChange(monitorId: string) {
    this.audienceMonitor = monitorId;
    await api.setAudienceMonitor(monitorId || null);
  }

  private async onStageMonitorChange(monitorId: string) {
    this.stageMonitor = monitorId;
    await api.setStageMonitor(monitorId || null);
  }

  private async onProjectToStageChange(checked: boolean) {
    this.projectToStage = checked;
    await api.setProjectToStage(checked);
  }

  private async onReadOnlyChange(checked: boolean) {
    if (this.serverLibrary) return;
    this.readOnly = checked;
    await api.setReadOnly(checked);
    this.showToast(checked ? "Library is read-only" : "Edits enabled");
  }

  private async beginServerSyncProgress() {
    this.serverSyncing = true;
    this.serverSyncProgress = {
      phase: "preparing",
      label: "Preparing the connection",
      current: 0,
      total: null,
      unit: "steps",
    };
    try {
      await this.unlistenServerSync?.();
      this.unlistenServerSync = await listen<ServerSyncProgress>("server-sync-progress", (event) => {
        this.serverSignInWaiting = false;
        this.serverSyncProgress = event.payload;
      });
    } catch (error) {
      console.error("Could not subscribe to server synchronization progress", error);
      this.unlistenServerSync = null;
    }
  }

  private async endServerSyncProgress() {
    this.serverSyncing = false;
    this.serverSyncProgress = null;
    try {
      await this.unlistenServerSync?.();
    } catch (error) {
      console.error("Could not remove the server synchronization progress listener", error);
    } finally {
      this.unlistenServerSync = null;
    }
  }

  private async connectServerLibrary() {
    const url = this.serverUrl.trim();
    const token = this.serverToken.trim();
    if (!url || !token) {
      this.showToast("Enter the server URL and a desktop token", "error");
      return;
    }
    if (!(await this.confirmDiscardPendingEdits())) return;
    if (!(await this.confirmServerMerge())) return;
    await this.beginServerSyncProgress();
    try {
      this.libraryStatus = await api.connectServerLibrary(url, token);
      this.serverToken = "";
      this.applyConfig(await api.getConfig());
      await this.refreshSongs();
      this.showToast(`Library merged: ${this.libraryStatus.song_count} songs available offline`, "success");
    } catch (error) {
      this.showToast(error instanceof Error ? error.message : String(error), "error");
    } finally {
      await this.endServerSyncProgress();
    }
  }

  /** Connecting uploads local-only songs; ask first when there are any. */
  private async confirmServerMerge(): Promise<boolean> {
    if (this.serverLibrary || (this.libraryStatus?.song_count ?? 0) === 0) return true;
    return confirm(
      `Connecting will add any of these ${this.libraryStatus?.song_count} local songs that the server does not already have, then download the merged library. Exact matches are skipped; differing versions remain separate. Your original files stay unchanged. Continue?`,
      { title: "Merge with server library", kind: "warning" },
    );
  }

  /** Server URL field: check it is a song server shortly after typing stops. */
  private onServerUrlInput(value: string) {
    this.serverUrl = value;
    if (this.serverProbeTimer) clearTimeout(this.serverProbeTimer);
    const generation = ++this.serverProbeGeneration;
    if (!value.trim()) {
      this.serverProbe = { status: "idle" };
      return;
    }
    this.serverProbe = { status: "checking" };
    this.serverProbeTimer = setTimeout(async () => {
      this.serverProbeTimer = null;
      try {
        const probe = await api.probeSongServer(value);
        if (generation !== this.serverProbeGeneration) return;
        this.serverProbe = {
          status: "ok",
          desktopSignIn: probe.desktop_sign_in,
          initialized: probe.initialized,
        };
      } catch (error) {
        if (generation !== this.serverProbeGeneration) return;
        this.serverProbe = {
          status: "error",
          message: error instanceof Error ? error.message : String(error),
        };
      }
    }, SERVER_PROBE_DELAY_MS);
  }

  /** Sign in on the server in the browser; the desktop receives its token. */
  private async signInServerLibrary() {
    const url = this.serverUrl.trim();
    if (!url) return;
    if (!(await this.confirmDiscardPendingEdits())) return;
    if (!(await this.confirmServerMerge())) return;
    await this.beginServerSyncProgress();
    this.serverSignInWaiting = true;
    this.serverSyncProgress = {
      phase: "signing in",
      label: "Finish signing in in your browser",
      current: 0,
      total: null,
      unit: "steps",
    };
    try {
      this.libraryStatus = await api.signInServerLibrary(url);
      this.applyConfig(await api.getConfig());
      await this.refreshSongs();
      this.showToast(`Connected: ${this.libraryStatus.song_count} songs available offline`, "success");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.startsWith("SIGN_IN_CANCELLED")) {
        this.showToast("Sign-in cancelled");
      } else {
        this.showToast(message, "error");
      }
    } finally {
      this.serverSignInWaiting = false;
      await this.endServerSyncProgress();
    }
  }

  private async syncServerLibrary() {
    if (!(await this.confirmDiscardPendingEdits())) return;
    await this.beginServerSyncProgress();
    try {
      this.libraryStatus = await api.syncServerLibrary();
      this.applyConfig(await api.getConfig());
      await this.refreshSongs();
      this.showToast(`Library synchronized: ${this.libraryStatus.song_count} songs available offline`, "success");
    } catch (error) {
      this.showToast(error instanceof Error ? error.message : String(error), "error");
    } finally {
      await this.endServerSyncProgress();
    }
  }

  private async disconnectServerLibrary() {
    const returnsToLocal = Boolean(this.lastLocalSongsFolder);
    const accepted = await confirm(
      returnsToLocal
        ? "Return to your previous local ChordPro library? The server cache will remain on this computer."
        : "Disconnect this server library? Its cached song files will remain on this computer, but the library will close.",
      { title: returnsToLocal ? "Return to local library" : "Disconnect song server", kind: "warning" },
    );
    if (!accepted) return;
    try {
      await api.disconnectServerLibrary();
      this.applyConfig(await api.getConfig());
      await this.refreshLibraryStatus();
      await this.refreshSongs();
      this.showToast(returnsToLocal ? "Returned to local song library" : "Song server disconnected");
    } catch (error) {
      this.showToast(error instanceof Error ? error.message : String(error), "error");
    }
  }

  private formatServerSyncTime(value: string): string {
    const date = new Date(value);
    return Number.isNaN(date.valueOf()) ? value : date.toLocaleString();
  }

  /** Settings, Church server, not connected: URL check, browser sign-in, token fallback. */
  private renderServerConnect(): TemplateResult {
    const probe = this.serverProbe;
    const signInReady = probe.status === "ok" && probe.desktopSignIn && probe.initialized;
    const needsToken = probe.status === "ok" && !probe.desktopSignIn;
    let status: TemplateResult | typeof nothing = nothing;
    if (probe.status === "checking") {
      status = html`<p class="server-probe" role="status">Checking the address…</p>`;
    } else if (probe.status === "error") {
      status = html`<p class="server-probe error" role="status">${probe.message}</p>`;
    } else if (probe.status === "ok" && !probe.initialized) {
      status = html`<p class="server-probe error" role="status">This song server has not been set up yet. Open it in a browser to create the church first.</p>`;
    } else if (probe.status === "ok") {
      status = html`<p class="server-probe ok" role="status">Psalm150 song server found${needsToken ? " · this server needs a desktop token" : ""}</p>`;
    }
    return html`
      <p class="settings-hint">Connect to your church's Psalm150 song server. You sign in with your server username and password in the browser. Local-only songs are then added to the server and the merged library is downloaded for offline use; exact content matches are not duplicated.</p>
      <label class="settings-field server-url-field">
        <span>Server URL</span>
        <input
          type="url"
          inputmode="url"
          placeholder="https://songs.example.org"
          .value=${this.serverUrl}
          ?disabled=${this.serverSyncing}
          @input=${(event: Event) => this.onServerUrlInput((event.target as HTMLInputElement).value)}
        />
      </label>
      ${status}
      <div class="settings-actions">
        ${this.serverSignInWaiting
          ? html`<button class="ghost" @click=${() => api.cancelServerSignIn()}>Cancel sign-in</button>`
          : html`<button class="primary" ?disabled=${!signInReady || this.serverSyncing} @click=${() => this.signInServerLibrary()}>${this.serverSyncing ? "Connecting…" : "Sign in with browser"}</button>`}
      </div>
      ${this.renderServerSyncProgress()}
      <details class="server-token-fallback" ?open=${needsToken}>
        <summary>Use a desktop token instead</summary>
        <p class="settings-hint">Paste a desktop token created under Connect desktop on the server.</p>
        <label class="settings-field"><span>Desktop token</span><input type="password" autocomplete="off" placeholder="psa_d_…" .value=${this.serverToken} @input=${(event: Event) => (this.serverToken = (event.target as HTMLInputElement).value)} /></label>
        <button class="secondary" ?disabled=${this.serverSyncing || !this.serverUrl.trim()} @click=${() => this.connectServerLibrary()}>Connect with token</button>
      </details>`;
  }

  private renderServerSyncProgress() {
    if (!this.serverSyncing) return nothing;
    const progress = this.serverSyncProgress;
    const total = progress?.total ?? 0;
    const determinate = total > 0;
    const percentage = determinate
      ? Math.min(100, Math.round(((progress?.current ?? 0) / total) * 100))
      : 0;
    const amount = !determinate
      ? "One moment…"
      : progress?.unit === "bytes"
        ? `${this.formatByteCount(progress.current)} / ${this.formatByteCount(total)}`
        : progress?.unit === "songs"
          ? `${progress.current.toLocaleString()} / ${total.toLocaleString()} songs`
          : `${percentage}%`;

    return html`
      <div class="server-sync-status" role="status" aria-live="polite">
        <div class="server-sync-heading">
          <span class="server-sync-kicker">${progress?.phase ?? "preparing"}</span>
          <strong>${progress?.label ?? "Preparing the connection"}</strong>
          <span class="server-sync-amount">${determinate ? `${amount} · ${percentage}%` : amount}</span>
        </div>
        ${determinate
          ? html`<div
              class="server-sync-track"
              role="progressbar"
              aria-label=${progress?.label ?? "Synchronizing library"}
              aria-valuemin="0"
              aria-valuemax="100"
              aria-valuenow=${String(percentage)}
            ><span class="server-sync-fill" style="width:${percentage}%"></span></div>`
          : html`<div class="server-sync-waiting"><span class="server-sync-loader" aria-hidden="true"></span><span>Establishing a secure library session</span></div>`}
      </div>`;
  }

  private formatByteCount(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  // ── Visual Song Book sync ──────────────────────────────────────────────

  private async linkVsbDatabase() {
    try {
      const linked = await api.chooseVsbDatabase();
      if (linked === undefined) return;
      this.vsbSync = linked;
      this.showToast("Visual Song Book linked; synchronizing…", "success");
      await this.syncVsbNow();
    } catch (err) {
      this.showToast(err instanceof Error ? err.message : String(err), "error");
    }
  }

  private async unlinkVsbDatabase() {
    const ok = await confirm(
      "Stop synchronizing with this Visual Song Book database? Neither the database nor your songs are changed.",
      { title: "Unlink Visual Song Book", kind: "warning", okLabel: "Unlink", cancelLabel: "Cancel" },
    );
    if (!ok) return;
    this.vsbSync = await api.unlinkVsbDatabase();
    this.showToast("Visual Song Book unlinked");
  }

  /** On-demand run. The backend reports progress and the result as events. */
  private async syncVsbNow() {
    if (!this.vsbSync || this.vsbSyncing) return;
    this.vsbSyncing = true;
    this.vsbProgress = { label: "Synchronizing with Visual Song Book", current: 0, total: 0 };
    try {
      const report = await api.syncVsbDatabase(true);
      if (report === null) {
        this.vsbSyncing = false;
        this.vsbProgress = null;
      }
    } catch {
      // The finished event carries the error.
    }
  }

  private async onVsbSyncFinished(result: VsbSyncFinished) {
    this.vsbSyncing = false;
    this.vsbProgress = null;
    // Background runs retry every minute; the icon keeps showing a lasting error.
    const previousError = this.vsbSync?.last_error ?? null;
    this.applyConfig(await api.getConfig());
    if (result.error) {
      if (result.error !== previousError) this.showToast(`VSB sync: ${result.error}`, "error");
      return;
    }
    const report = result.report;
    if (!report) return;
    const moved =
      report.files_written + report.files_created + report.files_deleted +
      report.rows_written + report.rows_inserted + report.rows_deleted + report.sent_to_server;
    if (moved > 0 || report.errors.length > 0) {
      this.showToast(
        `VSB sync: ${this.vsbSync?.last_summary ?? "done"}`,
        report.errors.length ? "error" : "success",
      );
    }
  }

  private renderVsbProgress() {
    if (!this.vsbSyncing) return nothing;
    const progress = this.vsbProgress;
    const total = progress?.total ?? 0;
    const percentage = total > 0 ? Math.min(100, Math.round(((progress?.current ?? 0) / total) * 100)) : null;
    return html`<div
      class="vsb-progress ${percentage === null ? "indeterminate" : ""}"
      role="progressbar"
      aria-label=${progress?.label || "Synchronizing with Visual Song Book"}
      aria-valuemin="0"
      aria-valuemax="100"
      aria-valuenow=${percentage ?? nothing}
    ><span style=${percentage === null ? "" : `width:${percentage}%`}></span></div>`;
  }

  private vsbStatusTitle(): string {
    if (this.vsbSyncing) {
      const p = this.vsbProgress;
      return p && p.total > 0
        ? `${p.label || "Synchronizing with Visual Song Book"} (${p.current} / ${p.total})`
        : "Synchronizing with Visual Song Book…";
    }
    if (this.vsbSync?.last_error) return `Visual Song Book: ${this.vsbSync.last_error}`;
    const when = this.vsbSync?.last_synced_at
      ? ` · ${this.formatServerSyncTime(this.vsbSync.last_synced_at)}`
      : "";
    return `Synchronize with Visual Song Book now${this.vsbSync?.last_summary ? `\nLast: ${this.vsbSync.last_summary}${when}` : ""}`;
  }

  private async onWebSearchEnabledChange(checked: boolean) {
    this.webSearchEnabled = checked;
    await api.setWebSearchEnabled(checked);
    if (!checked) {
      this.cancelWebSearch();
    } else if (this.browseMode === "search" && this.songs.length === 0) {
      void this.maybeSearchWeb(this.songsRefreshGeneration);
    }
  }

  private async onShowSongNumbersChange(checked: boolean) {
    this.showSongNumbers = checked;
    await api.setShowSongNumbers(checked);
  }

  // ── Song list ordering ─────────────────────────────────────────────────

  /** Only library views sort by column; History keeps recency and Setlist keeps service order. */
  private isSortableView(): boolean {
    return this.browseMode === "search" || this.browseMode === "favorites";
  }

  private setSongSort(column: SongSortColumn) {
    this.songSort = toggleSongSort(this.songSort, column);
    localStorage.setItem(SONG_SORT_KEY, JSON.stringify(this.songSort));
  }

  /** Rows in display order: what the list shows and what keyboard navigation walks. */
  private get visibleSongs(): SongRow[] {
    if (!this.isSortableView()) return this.songs;
    const cache = this.sortedSongsCache;
    if (cache && cache.songs === this.songs && cache.sort === this.songSort) {
      return cache.sorted;
    }
    const sorted = sortSongs(this.songs, this.songSort);
    this.sortedSongsCache = { songs: this.songs, sort: this.songSort, sorted };
    return sorted;
  }

  private async onRemoteEnabledChange(checked: boolean) {
    try {
      if (checked) {
        this.remoteStatus = await api.startRemote();
        this.showToast(`Phone remote listening on port ${this.remoteStatus.port}`, "success");
      } else {
        await api.stopRemote();
        this.remoteStatus = null;
        this.showToast("Phone remote stopped");
      }
    } catch (err) {
      this.remoteStatus = null;
      this.showToast(err instanceof Error ? err.message : String(err), "error");
    }
  }

  private async printSongbook() {
    const htmlDoc = await api.printSongbookHtml("Songbook", true);
    const win = window.open("", "_blank");
    win?.document.write(htmlDoc);
    win?.document.close();
  }

  private async exportCcli() {
    const csv = await api.exportCcliReport("2000-01-01T00:00:00Z", "2100-01-01T00:00:00Z");
    this.showToast("CCLI report copied to console");
    console.log(csv);
  }

  // ── Setlists ──────────────────────────────────────────────────────────

  /**
   * Reload setlists and keep the active one (remembered per PC). There is no
   * automatic default: a setlist becomes active when it is picked in the
   * Setlist view, or when a song is added while none is active.
   */
  private async refreshSetlists() {
    try {
      this.setlists = await api.listSetlists();
    } catch {
      this.setlists = [];
      this.currentSetlist = null;
      return;
    }
    const wanted = this.currentSetlist?.id ?? readLocal(CURRENT_SETLIST_KEY);
    this.currentSetlist = this.setlists.find((setlist) => setlist.id === wanted) ?? null;
    void api.setActiveSetlist(this.currentSetlist?.id ?? null).catch(() => undefined);
  }

  /** Sets changed on the song server (or this PC's edits were uploaded). */
  private async onSetlistsChanged(report: SetSyncReport) {
    await this.refreshSetlists();
    if (this.browseMode === "setlist") await this.refreshSongs();
    for (const name of report.conflicts) {
      this.showToast(`“${name}” was changed elsewhere; your changes are kept as a copy`, "info");
    }
    if (report.skipped_items) {
      this.showToast(`${report.skipped_items} setlist song(s) are not on the song server and were removed from the set`, "info");
    }
  }

  /** A leader's phone asked to project a song or a set item. */
  private async onRemoteProject(request: RemoteProject) {
    try {
      if (request.set_id) {
        await this.refreshSetlists();
        const setlist = this.setlists.find((candidate) => candidate.id === request.set_id);
        if (setlist && this.currentSetlist?.id !== setlist.id) await this.chooseSetlist(setlist);
      }
      await this.selectSong(request.filename);
      if (this.currentFilename !== request.filename) return;
      await this.projectLoadedSong();
      if (request.transpose) this.applyProjectionSnapshot(await api.setTranspose(request.transpose));
      if (request.issued_by) this.showToast(`Projected from ${request.issued_by}'s phone`, "info");
    } catch (err) {
      this.showToast(err instanceof Error ? err.message : String(err), "error");
    }
  }

  private async onServerRemoteChange(enabled: boolean) {
    try {
      await api.setServerRemoteEnabled(enabled);
      this.serverRemoteEnabled = enabled;
      this.showToast(enabled ? "Leaders can now steer this PC from their phones" : "Remote control through the song server is off", enabled ? "success" : "info");
    } catch (err) {
      this.showToast(err instanceof Error ? err.message : String(err), "error");
    }
  }

  private async chooseSetlist(setlist: Setlist | null) {
    this.currentSetlist = setlist;
    writeLocal(CURRENT_SETLIST_KEY, setlist?.id ?? null);
    void api.setActiveSetlist(setlist?.id ?? null).catch(() => undefined);
    if (this.browseMode === "setlist") await this.refreshSongs();
  }

  private setlistHasSong(setlist: Setlist | null, filename: string | null): boolean {
    if (!setlist || !filename) return false;
    return setlist.items.some((item) => item.file === filename);
  }

  /** Songs that can go in a setlist: library files, not web previews. */
  private setlistCandidate(): string | null {
    if (!this.currentSong || !this.currentFilename || isWebResultId(this.currentFilename)) return null;
    return this.currentFilename;
  }

  private async toggleSetlistMenu() {
    if (this.setlistMenuOpen) {
      this.setlistMenuOpen = false;
      return;
    }
    this.newSetlistName = await defaultSetlistName();
    await this.refreshSetlists();
    this.setlistMenuOpen = true;
    await this.updateComplete;
    this.querySelector<HTMLElement>(".setlist-menu-item, .setlist-menu input")?.focus();
  }

  private replaceSetlist(updated: Setlist) {
    this.setlists = this.setlists.map((setlist) => (setlist.id === updated.id ? updated : setlist));
    if (this.currentSetlist?.id === updated.id) this.currentSetlist = updated;
  }

  private async toggleSongInSetlist(setlist: Setlist) {
    const filename = this.setlistCandidate();
    if (!filename) return;
    try {
      if (this.setlistHasSong(setlist, filename)) {
        this.replaceSetlist(await api.removeFromSetlist(setlist.id, filename));
        this.showToast(`Removed from ${setlist.name}`);
      } else {
        const updated = await api.addToSetlist(setlist.id, filename);
        this.replaceSetlist(updated);
        if (!this.currentSetlist) await this.chooseSetlist(updated);
        this.setlistMenuOpen = false;
        this.showToast(`Added to ${setlist.name}`, "success");
      }
      if (this.browseMode === "setlist") await this.refreshSongs();
    } catch (err) {
      this.showToast(err instanceof Error ? err.message : String(err), "error");
    }
  }

  private async createSetlistWithSong() {
    const filename = this.setlistCandidate();
    if (!filename) return;
    const name = this.newSetlistName.trim() || (await defaultSetlistName());
    try {
      const created = await api.createSetlist(name, localIsoDate(new Date()));
      const updated = await api.addToSetlist(created.id, filename);
      this.setlists = [updated, ...this.setlists];
      if (!this.currentSetlist) await this.chooseSetlist(updated);
      this.setlistMenuOpen = false;
      this.showToast(`Added to ${name}`, "success");
    } catch (err) {
      this.showToast(err instanceof Error ? err.message : String(err), "error");
    }
  }

  /**
   * Keyboard add (Alt+S by default): into the active setlist, or, with none
   * active, open the menu to pick or create one.
   */
  private async addSelectedToSetlist() {
    const filename = this.setlistCandidate();
    if (!filename) {
      this.showToast("Select a song from the library first");
      return;
    }
    const active = this.currentSetlist;
    if (!active) {
      if (!this.setlistMenuOpen) await this.toggleSetlistMenu();
      return;
    }
    if (this.setlistHasSong(active, filename)) {
      this.showToast(`Already in ${active.name}`);
      return;
    }
    await this.toggleSongInSetlist(active);
  }

  /** Project the setlist song after the one on screen (or the first). */
  private async projectNextInSetlist() {
    const songs = (this.currentSetlist?.items ?? []).filter((item) => item.type === "song" && item.file);
    const index = songs.findIndex((item) => item.file === this.activeSelectionId);
    const next = songs[index + 1];
    if (!next) {
      this.showToast(songs.length ? "End of the setlist" : "The setlist is empty");
      return;
    }
    await this.selectSong(next.file!);
    if (this.currentFilename !== next.file) return;
    await this.projectLoadedSong();
    // The set's key for this song (a leader may have transposed it).
    if (next.transpose) this.applyProjectionSnapshot(await api.setTranspose(next.transpose));
  }

  // ── Favourites ─────────────────────────────────────────────────────────

  private async refreshFavorites() {
    try {
      this.favoriteFiles = new Set(await api.listFavorites());
    } catch {
      this.favoriteFiles = new Set();
    }
  }

  private async toggleFavorite(filename: string) {
    try {
      const favorite = await api.toggleFavorite(filename);
      const next = new Set(this.favoriteFiles);
      if (favorite) next.add(filename);
      else next.delete(filename);
      this.favoriteFiles = next;
      this.showToast(favorite ? "Added to favourites" : "Removed from favourites", favorite ? "success" : "info");
      await this.refreshSongs();
    } catch (err) {
      this.showToast(err instanceof Error ? err.message : String(err), "error");
    }
  }

  // ── Browse views ───────────────────────────────────────────────────────

  /** Search button: back to the search view with the field focused. */
  private async showSearch() {
    if (this.browseMode !== "search") await this.setBrowseMode("search");
    requestAnimationFrame(() => this.focusSearchField(true));
  }

  /** Ctrl+E and Ctrl+1–4: open a view (never toggles back to Search). */
  private async showBrowseMode(mode: BrowseMode) {
    if (mode === "search") {
      await this.showSearch();
    } else if (this.browseMode !== mode) {
      await this.setBrowseMode(mode);
    }
  }

  /** Toolbar views toggle: pressing the active one returns to search. */
  private async setBrowseMode(mode: BrowseMode) {
    this.browseMode = this.browseMode === mode ? "search" : mode;
    this.keyToken = null;
    if (this.browseMode === "setlist") await this.refreshSetlists();
    await this.refreshSongs();
    await this.updateComplete;
    this.focusActiveBrowseField();
  }

  /** The search field selects its text whenever it gains focus, so typing replaces it. */
  private onSearchFocus(event: FocusEvent) {
    (event.target as HTMLInputElement).select();
  }

  /** A click that focuses the field would collapse the selection on mouseup; keep it. */
  private onSearchMouseDown(event: MouseEvent) {
    this.searchClickFocuses = document.activeElement !== event.target;
  }

  private onSearchMouseUp(event: MouseEvent) {
    if (!this.searchClickFocuses) return;
    this.searchClickFocuses = false;
    const input = event.target as HTMLInputElement;
    if (input.selectionStart === input.selectionEnd) {
      event.preventDefault();
      input.select();
    }
  }

  private async onSearchInput(event: Event) {
    const input = event.target as HTMLInputElement;
    this.query = input.value;
    void this.refreshSongs();
    await this.updateKeyToken(input);
  }

  private async updateKeyToken(input: HTMLInputElement) {
    const token = keyTokenAt(input.value, input.selectionStart ?? input.value.length);
    if (token) await this.loadKeyOptions();
    this.keyToken = token && matchingKeys(this.keys, token.partial).length > 0 ? token : null;
    this.keyMenuIndex = 0;
  }

  private chooseKey(key: string) {
    if (!this.keyToken) return;
    const next = applyKey(this.query, this.keyToken, key);
    this.query = next.query;
    this.keyToken = null;
    void this.refreshSongs();
    requestAnimationFrame(() => {
      const input = this.querySelector<HTMLInputElement>("#search-input");
      if (!input) return;
      input.focus({ preventScroll: true });
      input.setSelectionRange(next.caret, next.caret);
    });
  }

  // ── Toast ──────────────────────────────────────────────────────────────

  private anyModalOpen(): boolean {
    return this.editOpen || this.settingsOpen || this.importOpen ||
      this.importReportOpen || this.duplicatesOpen;
  }

  private showToast(msg: string, tone: ToastTone = "info") {
    this.toastMsg = msg;
    this.toastTone = tone;
    this.toastVisible = true;
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => (this.toastVisible = false), 4000);
  }

  // ── Bootstrap ──────────────────────────────────────────────────────────

  private async bootstrapLibrary() {
    const config = await api.getConfig();
    this.applyConfig(config);
    const configuredFolder =
      typeof config.last_songs_folder === "string" ? config.last_songs_folder : null;

    await this.refreshLibraryStatus();
    await this.refreshSetlists();
    await this.refreshFavorites();
    await this.refreshSongs();

    // The backend attaches the remembered folder immediately, then rescans on a
    // background thread (large libraries can take 15s+). Poll until the folder or
    // song index is ready, and keep listening for library-changed in init().
    if (configuredFolder && !this.libraryStatus?.songs_folder) {
      for (let attempt = 0; attempt < 120; attempt++) {
        await delay(250);
        await this.refreshLibraryStatus();
        if (this.libraryStatus?.songs_folder) {
          await this.refreshSongs();
          break;
        }
      }
    }

    if (this.libraryStatus?.songs_folder && this.libraryStatus.song_count === 0) {
      for (let attempt = 0; attempt < 120; attempt++) {
        await delay(250);
        await this.refreshLibraryStatus();
        if ((this.libraryStatus?.song_count ?? 0) > 0) {
          await this.refreshSongs();
          break;
        }
      }
    } else if (this.libraryStatus?.songs_folder) {
      await this.refreshSongs();
    }

    if (!this.libraryStatus?.songs_folder) {
      this.showToast(
        configuredFolder
          ? "Could not reopen your songs folder — choose it again in Settings"
          : config.first_run_complete
            ? "Open Settings to select your songs folder"
            : "Welcome! Open Settings to select your songs folder",
        configuredFolder ? "error" : config.first_run_complete ? "info" : "success",
      );
    }
  }

  // ── Keyboard ───────────────────────────────────────────────────────────

  private allSelectableFiles(): string[] {
    return [
      ...this.visibleSongs.map((song) => song.filename),
      ...this.webResults.map((_, index) => webResultId(index)),
    ];
  }

  private async focusSongListRow(file: string) {
    await this.updateComplete;
    const row = this.querySelector<HTMLElement>(
      `psa150-song-list li[data-file="${CSS.escape(file)}"]`,
    );
    row?.focus({ preventScroll: true });
    row?.scrollIntoView({ block: "nearest" });
  }

  private async navigateFilteredSongs(direction: "next" | "prev") {
    const files = this.allSelectableFiles();
    if (files.length === 0) return;

    const index = this.currentFilename ? files.indexOf(this.currentFilename) : -1;

    if (direction === "next") {
      const next = index < 0 ? files[0] : files[index + 1];
      if (!next) return;
      await this.selectSong(next);
      await this.focusSongListRow(next);
      return;
    }

    if (index <= 0) {
      if (index === 0) {
        this.focusActiveBrowseField();
        return;
      }
      const last = files[files.length - 1];
      await this.selectSong(last);
      await this.focusSongListRow(last);
      return;
    }

    const prev = files[index - 1];
    await this.selectSong(prev);
    await this.focusSongListRow(prev);
  }

  private async stopProjection() {
    if (!this.projecting) return;
    await api.closeProjectionWindows();
    this.projecting = false;
    await this.startFreshSearch();
  }

  /** After Esc ends a projection: empty search field, focused, ready for the next song. */
  private async startFreshSearch() {
    this.keyToken = null;
    const changed = this.query !== "" || this.browseMode !== "search";
    this.query = "";
    this.browseMode = "search";
    if (changed) await this.refreshSongs();
    await this.updateComplete;
    requestAnimationFrame(() => this.focusSearchField());
  }

  private onGlobalKeydown = async (event: KeyboardEvent) => {
    const target = event.target;
    const digit = /^[0-9]$/.test(event.key);
    const numberShortcut = digit && !event.ctrlKey && !event.metaKey && !event.altKey &&
      !event.shiftKey && !event.isComposing && !event.defaultPrevented &&
      !isTextEntryTarget(target) && !isContentEditableTarget(target) &&
      !this.editOpen && !this.settingsOpen && !this.importOpen &&
      !this.importReportOpen && !this.duplicatesOpen &&
      this.projecting && this.projection?.slides.length;
    if (numberShortcut) {
      event.preventDefault();
      if (!event.repeat) {
        this.stanzaNumberInput.push(event.key, this.projection!.slides, (slideIndex) => {
          void this.jumpToStanza(slideIndex).catch((err) => this.showToast(String(err), "error"));
        });
      }
      return;
    }
    this.stanzaNumberInput.reset();

    if (event.key === "Escape") {
      if (this.setlistMenuOpen) {
        this.setlistMenuOpen = false;
        return;
      }
      if (this.adhocEditingBlockKey) {
        this.exitAdhocEdit();
        return;
      }
      if (this.editOpen) {
        this.editOpen = false;
        return;
      }
      if (this.settingsOpen) {
        this.settingsOpen = false;
        return;
      }
      if (this.duplicatesOpen) {
        this.duplicatesOpen = false;
        return;
      }
      if (this.importReportOpen) {
        this.importReportOpen = false;
        return;
      }
      await this.stopProjection();
      return;
    }

    // Configurable shortcuts. Combos with Ctrl, Alt or Meta also work while
    // typing; plain keys (B, arrows) only outside text fields.
    const combo = comboFromEvent(event);
    const action = combo ? actionForCombo(this.shortcuts, combo) : null;
    const modalOpen = this.editOpen || this.settingsOpen || this.importOpen ||
      this.importReportOpen || this.duplicatesOpen;
    const view = combo ? VIEW_SHORTCUTS[combo] : undefined;
    if (view && !modalOpen) {
      event.preventDefault();
      await this.showBrowseMode(view);
      return;
    }
    const typing = isTextEntryTarget(target) || isContentEditableTarget(target);
    if (action && combo && !modalOpen && (hasCommandModifier(combo) || !typing)) {
      if (await this.runShortcut(action)) {
        event.preventDefault();
        return;
      }
    }

    if (event.key === "Enter" && this.currentSong) {
      if (isTextEntryTarget(target) && !(target as HTMLElement).matches("#search-input")) {
        return;
      }
      event.preventDefault();
      await this.projectLoadedSong();
      return;
    }

    if (isTextEntryTarget(target) || isContentEditableTarget(target)) return;

    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (this.projecting && this.projection?.slides.length) {
        await this.advanceStanza("next");
      } else if (!this.projecting) {
        await this.navigateFilteredSongs("next");
      }
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      if (this.projecting && this.projection?.slides.length) {
        await this.advanceStanza("prev");
      } else if (!this.projecting) {
        await this.navigateFilteredSongs("prev");
      }
    }
  };

  /** Run a configurable shortcut; false when it does not apply right now. */
  private async runShortcut(action: ShortcutAction): Promise<boolean> {
    const projectingSlides = Boolean(this.projecting && this.projection?.slides.length);
    switch (action) {
      case "add_to_setlist":
        await this.addSelectedToSetlist();
        return true;
      case "toggle_favorite": {
        const filename = this.setlistCandidate();
        if (!filename) {
          this.showToast("Select a song from the library first");
          return true;
        }
        await this.toggleFavorite(filename);
        return true;
      }
      case "focus_search":
        await this.showSearch();
        return true;
      case "blank":
        if (!this.projecting) return false;
        this.applyProjectionSnapshot(await api.blankScreen());
        return true;
      case "next_slide":
        if (!projectingSlides) return false;
        await this.advanceSlide("next");
        return true;
      case "previous_slide":
        if (!projectingSlides) return false;
        await this.advanceSlide("prev");
        return true;
    }
  }

  /** Settings: the next key combination becomes the recorded action's shortcut. */
  private onRecordShortcutKeydown = (event: KeyboardEvent) => {
    const action = this.recordingShortcut;
    if (!action) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (event.key === "Escape") {
      this.recordingShortcut = null;
      this.shortcutError = null;
      return;
    }
    const noModifiers = !event.ctrlKey && !event.altKey && !event.metaKey && !event.shiftKey;
    if (noModifiers && (event.key === "Backspace" || event.key === "Delete")) {
      void this.setShortcut(action, "");
      return;
    }
    const combo = comboFromEvent(event);
    if (!combo) return;
    const problem = shortcutProblem(this.shortcuts, action, combo);
    if (problem) {
      this.shortcutError = problem;
      return;
    }
    void this.setShortcut(action, combo);
  };

  private async setShortcut(action: ShortcutAction, combo: string) {
    this.shortcuts = { ...this.shortcuts, [action]: combo };
    this.recordingShortcut = null;
    this.shortcutError = null;
    try {
      await api.saveShortcuts(this.shortcuts);
    } catch (err) {
      this.showToast(err instanceof Error ? err.message : String(err), "error");
    }
  }

  private async resetShortcuts() {
    this.shortcuts = { ...DEFAULT_SHORTCUTS };
    this.recordingShortcut = null;
    this.shortcutError = null;
    await api.saveShortcuts(this.shortcuts);
    this.showToast("Keyboard shortcuts reset");
  }

  private async onSearchKeydown(event: KeyboardEvent) {
    const keyOptions = this.keyToken ? matchingKeys(this.keys, this.keyToken.partial) : [];
    if (keyOptions.length > 0) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const step = event.key === "ArrowDown" ? 1 : -1;
        this.keyMenuIndex = (this.keyMenuIndex + step + keyOptions.length) % keyOptions.length;
        return;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault();
        event.stopPropagation();
        this.chooseKey(keyOptions[this.keyMenuIndex] ?? keyOptions[0]);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        this.keyToken = null;
        return;
      }
    }
    if (event.key === "ArrowDown") {
      const first = this.visibleSongs[0];
      if (!first) return;
      event.preventDefault();
      await this.selectSong(first.filename);
      await this.updateComplete;
      const row = this.querySelector<HTMLElement>("psa150-song-list li[data-file]");
      row?.focus({ preventScroll: true });
      row?.scrollIntoView({ block: "nearest" });
      return;
    }
    if (event.key === "ArrowUp") {
      const last = this.visibleSongs[this.visibleSongs.length - 1];
      if (!last) return;
      event.preventDefault();
      await this.selectSong(last.filename);
      await this.updateComplete;
      const rows = this.querySelectorAll<HTMLElement>("psa150-song-list li[data-file]");
      rows[rows.length - 1]?.focus({ preventScroll: true });
      rows[rows.length - 1]?.scrollIntoView({ block: "nearest" });
      return;
    }
    if (event.key === "Enter") {
      const first = this.visibleSongs[0];
      if (!first) return;
      event.preventDefault();
      event.stopPropagation();
      if (this.currentFilename !== first.filename) {
        await this.selectSong(first.filename);
      }
      await this.projectLoadedSong();
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────

  render() {
    return html`
      ${this.renderHeader()}
      <div class="app-body">
      ${this.renderActivityBar()}
      <main class="workspace" style="--browse-pane-width: ${this.browsePaneWidth}px">
        ${this.renderBrowsePane()}
        ${this.renderSongPane()}
        <div
          class="workspace-splitter"
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize song list"
          @pointerdown=${this.onSplitterPointerDown}
          @pointermove=${this.onSplitterPointerMove}
          @pointerup=${this.onSplitterPointerUp}
          @pointercancel=${this.onSplitterPointerUp}
        ></div>
      </main>
      </div>
      <psa150-modal
        class="settings-modal"
        heading="Settings"
        variant="wide"
        ?open=${this.settingsOpen}
        .content=${this.renderSettingsContent()}
        @psa150-close=${() => {
          this.settingsOpen = false;
          this.recordingShortcut = null;
        }}
      ></psa150-modal>
      <psa150-modal
        class="duplicate-modal"
        heading="Possible duplicates"
        variant="wide"
        ?open=${this.duplicatesOpen}
        .content=${this.renderDuplicateReviewContent()}
        @psa150-close=${() => (this.duplicatesOpen = false)}
      ></psa150-modal>
      <psa150-modal
        heading=${(this.currentSong?.parsed.meta.title as string) || "Edit song"}
        variant="tall"
        ?open=${this.editOpen}
        .content=${this.renderEditContent()}
        @psa150-close=${() => (this.editOpen = false)}
      ></psa150-modal>
      <psa150-modal
        heading="Importing songbook"
        ?open=${this.importOpen}
        .content=${this.renderImportContent()}
      ></psa150-modal>
      <psa150-modal
        heading="Import report"
        variant="tall"
        ?open=${this.importReportOpen}
        .content=${this.renderImportReportContent()}
        @psa150-close=${() => (this.importReportOpen = false)}
      ></psa150-modal>
      ${this.anyModalOpen() ? this.renderToast() : nothing}
    `;
  }

  /**
   * The toast lives in the title bar; while a dialog is open it is drawn after
   * the dialogs instead, because the title bar's stacking context would keep
   * it under the dialog backdrop.
   */
  private renderToast() {
    return html`<span
      class="toast ${this.toastTone} ${this.toastVisible ? "" : "hidden"} ${this.anyModalOpen() ? "over-modal" : ""}"
      role="status"
    >${this.toastMsg}</span>`;
  }

  private renderHeader() {
    const song = this.currentSong;
    return html`
      <header class="app-header" data-tauri-drag-region @dblclick=${this.onTitlebarDblClick}>
        ${this.renderVsbProgress()}
        <div class="brand">
          <div class="brand-mark">
            <svg width="18" height="18" viewBox="200 180 700 680" fill="currentColor" stroke="none" aria-hidden="true">
              <rect x="352" y="196" width="104" height="632" rx="24" />
              <rect x="228" y="340" width="352" height="100" rx="24" />
              <ellipse cx="626" cy="742" rx="66" ry="52" transform="rotate(-22 626 742)" />
              <ellipse cx="800" cy="676" rx="66" ry="52" transform="rotate(-22 800 676)" />
              <rect x="662" y="498" width="34" height="240" />
              <rect x="836" y="432" width="34" height="240" />
              <path d="M662 498 L870 432 L870 512 L662 578 Z" />
            </svg>
          </div>
          <strong class="brand-name">Psalm150</strong>
        </div>
        <div class="header-end app-no-drag">
          ${this.anyModalOpen() ? nothing : this.renderToast()}
          <span class="badge ${this.libraryStatus?.library_dirty ? "" : "hidden"}">Changed</span>
          <div class="toolbar-group projection-toolbar" role="toolbar" aria-label="Projection and settings">
            <button
              class="ghost compact toolbar-btn ${this.projecting ? "pressed" : ""}"
              title="Project the selected song (Enter)"
              ?disabled=${!song}
              @click=${() => this.projectLoadedSong()}
            >${icon("project", 16)}<span>Project</span></button>
            ${this.projecting
              ? html`
                  <button
                    class="ghost compact toolbar-btn icon-only"
                    title="Previous slide (←)"
                    aria-label="Previous slide"
                    @click=${() => this.advanceSlide("prev")}
                  >${icon("prev", 16)}</button>
                  <button
                    class="ghost compact toolbar-btn icon-only"
                    title="Next slide (→)"
                    aria-label="Next slide"
                    @click=${() => this.advanceSlide("next")}
                  >${icon("next", 16)}</button>
                  <button
                    class="ghost compact toolbar-btn ${this.projection?.blank ? "pressed" : ""}"
                    title="Blank the screen (B)"
                    aria-pressed=${this.projection?.blank ? "true" : "false"}
                    @click=${async () => this.applyProjectionSnapshot(await api.blankScreen())}
                  >${icon("blank", 16)}<span>Blank</span></button>
                `
              : nothing}
            <button
              class="icon-btn toolbar-icon"
              type="button"
              title="Settings"
              aria-label="Settings"
              @click=${() => this.openSettings()}
            >${icon("settings", 16)}</button>
          </div>
        </div>
        <div class="window-controls app-no-drag">
          <button
            class="window-control"
            type="button"
            title="Minimize"
            aria-label="Minimize"
            @click=${() => void this.minimizeWindow()}
          >
            <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
              <path d="M0 5h10" stroke="currentColor" stroke-width="1" />
            </svg>
          </button>
          <button
            class="window-control"
            type="button"
            title=${this.windowMaximized ? "Restore" : "Maximize"}
            aria-label=${this.windowMaximized ? "Restore" : "Maximize"}
            @click=${() => void this.toggleWindowMaximize()}
          >
            ${this.windowMaximized
              ? html`
                  <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
                    <path
                      d="M2.5 2.5V0.5h7v7h-2"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="1"
                    />
                    <rect
                      x="0.5"
                      y="2.5"
                      width="7"
                      height="7"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="1"
                    />
                  </svg>
                `
              : html`
                  <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
                    <rect
                      x="0.5"
                      y="0.5"
                      width="9"
                      height="9"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="1"
                    />
                  </svg>
                `}
          </button>
          <button
            class="window-control close"
            type="button"
            title="Close"
            aria-label="Close"
            @click=${() => void this.closeWindow()}
          >
            <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
              <path d="M1 1l8 8M9 1L1 9" stroke="currentColor" stroke-width="1.2" />
            </svg>
          </button>
        </div>
      </header>
    `;
  }

  /**
   * Activity bar (as in VS Code): what the song list shows. The VSB sync
   * status sits at the bottom, like VS Code's account and manage icons.
   */
  private renderActivityBar() {
    const mode = (
      name: BrowseMode,
      label: string,
      iconName: "search" | "setlist" | "history" | "favorites",
      onClick: () => unknown,
    ) => html`
      <button
        class="activity-btn ${this.browseMode === name ? "active" : ""}"
        type="button"
        title=${label}
        aria-label=${label}
        aria-pressed=${this.browseMode === name ? "true" : "false"}
        @click=${onClick}
      >${icon(iconName, 22)}</button>
    `;
    return html`
      <nav class="activity-bar" aria-label="Song list views">
        ${mode("search", "Search (Ctrl+E or Ctrl+1)", "search", () => this.showSearch())}
        ${mode("setlist", "Setlist (Ctrl+2)", "setlist", () => this.setBrowseMode("setlist"))}
        ${mode("history", "History (Ctrl+3)", "history", () => this.setBrowseMode("history"))}
        ${mode("favorites", "Favourites (Ctrl+4)", "favorites", () => this.setBrowseMode("favorites"))}
        <span class="activity-spacer"></span>
        ${this.vsbSync
          ? html`<button
              class="activity-btn ${this.vsbSyncing ? "spinning" : ""} ${this.vsbSync.last_error ? "attention" : ""}"
              type="button"
              title=${this.vsbStatusTitle()}
              aria-label="Synchronize with Visual Song Book"
              ?disabled=${this.vsbSyncing}
              @click=${() => this.syncVsbNow()}
            >${icon("sync", 20)}</button>`
          : nothing}
      </nav>
    `;
  }

  private renderBrowsePane() {
    return html`
      <aside class="browse-pane" style="width: ${this.browsePaneWidth}px">
        ${this.browseMode === "search" ? this.renderSearchToolbar() : this.renderViewToolbar()}
        <psa150-song-list
          class="song-list-host"
          .songs=${this.visibleSongs}
          .showNumbers=${this.showSongNumbers}
          .sort=${this.isSortableView() ? this.songSort : null}
          @psa150-sort=${(e: CustomEvent<SongSortColumn>) => this.setSongSort(e.detail)}
          .webResults=${this.webResults}
          .webSearchLoading=${this.webSearchLoading}
          .currentFile=${this.currentFilename}
          .projecting=${this.projecting}
          @psa150-select=${(e: CustomEvent<string>) => this.selectSong(e.detail)}
          @psa150-focus-search=${() => this.focusActiveBrowseField()}
          @psa150-project=${async (e: CustomEvent<string>) => {
            if (this.currentFilename !== e.detail) await this.selectSong(e.detail);
            await this.projectLoadedSong();
          }}
        ></psa150-song-list>
      </aside>
    `;
  }

  private renderSearchToolbar() {
    const keyOptions = this.keyToken ? matchingKeys(this.keys, this.keyToken.partial) : [];
    const { key } = parseSearch(this.query, this.keys);
    return html`
      <div class="browse-toolbar">
        <form class="search-wrap" autocomplete="off" @submit=${(e: Event) => e.preventDefault()}>
          <span class="search-icon">${icon("search")}</span>
          <input
            id="search-input"
            type="text"
            name="psa150-library-query"
            placeholder="Search songs, numbers, or # for key…"
            autocomplete="off"
            autocorrect="off"
            autocapitalize="off"
            spellcheck="false"
            role="combobox"
            aria-expanded=${keyOptions.length > 0 ? "true" : "false"}
            aria-controls="key-menu"
            aria-autocomplete="list"
            .value=${this.query}
            @focus=${(e: FocusEvent) => this.onSearchFocus(e)}
            @mousedown=${(e: MouseEvent) => this.onSearchMouseDown(e)}
            @mouseup=${(e: MouseEvent) => this.onSearchMouseUp(e)}
            @input=${(e: Event) => this.onSearchInput(e)}
            @click=${(e: Event) => this.updateKeyToken(e.target as HTMLInputElement)}
            @keydown=${(e: KeyboardEvent) => this.onSearchKeydown(e)}
          />
          ${key ? html`<span class="search-key-chip" title="Showing songs in ${key}">${icon("key", 13)}${key}</span>` : nothing}
          ${keyOptions.length > 0
            ? html`
                <div class="combobox-list key-menu">
                  <div class="key-menu-heading">Songs in key</div>
                  <ul id="key-menu" class="dropdown-scroll" role="listbox" aria-label="Keys">
                    ${keyOptions.map(
                      (option, index) => html`
                        <li
                          role="option"
                          aria-selected=${index === this.keyMenuIndex ? "true" : "false"}
                          class=${index === this.keyMenuIndex ? "highlighted" : ""}
                          @mousedown=${(event: MouseEvent) => {
                            event.preventDefault();
                            this.chooseKey(option);
                          }}
                        >${option}</li>
                      `,
                    )}
                  </ul>
                </div>
              `
            : nothing}
        </form>
      </div>
    `;
  }

  /** History, Favourites and Setlist: a title bar that closes back to search. */
  /**
   * History, Favourites and Setlist: one row as tall as the search heading.
   * The Setlist view puts its picker and Next song in that row.
   */
  private renderViewToolbar() {
    const mode = this.browseMode as Exclude<BrowseMode, "search">;
    const iconName = mode === "favorites" ? "favorites" : mode;
    return html`
      <div class="browse-toolbar view-toolbar">
        <span class="view-title-icon" title=${BROWSE_TITLES[mode]}>${icon(iconName, 16)}</span>
        ${mode === "setlist" ? this.renderSetlistPicker() : html`<strong class="view-title">${BROWSE_TITLES[mode]}</strong>`}
        <button
          class="icon-btn view-close"
          type="button"
          title="Back to search (Ctrl+F)"
          aria-label="Back to search"
          @click=${() => this.setBrowseMode("search")}
        >${icon("close", 16)}</button>
      </div>
    `;
  }

  private renderSetlistPicker() {
    if (!this.setlists.length) {
      return html`<p class="setlist-empty">No setlists yet. Use the add-to-setlist button on a song to start one.</p>`;
    }
    return html`
      <psa150-select
        class="setlist-picker"
        .options=${[
          ...(this.currentSetlist ? [] : [{ value: "", label: "Choose a setlist…" }]),
          ...this.setlists.map((setlist) => ({
            value: setlist.id,
            label: `${setlist.name} · ${setlist.items.length} ${setlist.items.length === 1 ? "song" : "songs"}`,
          })),
        ]}
        .value=${this.currentSetlist?.id ?? ""}
        @psa150-change=${(e: CustomEvent<string>) =>
          this.chooseSetlist(this.setlists.find((setlist) => setlist.id === e.detail) ?? null)}
      ></psa150-select>
      <button
        class="icon-btn view-close"
        type="button"
        title="Project the next song in the setlist"
        aria-label="Project the next song in the setlist"
        ?disabled=${!this.currentSetlist?.items.length}
        @click=${() => this.projectNextInSetlist()}
      >${icon("skipForward", 16)}</button>
    `;
  }

  private renderSongPane() {
    return html`
      <section class="song-pane ${this.projecting ? "projecting" : ""}">
        <header class="song-pane-header">
          <div class="song-pane-header-row">
            <h1 class="song-title">
              ${this.currentSong
                ? (this.currentSong.parsed.meta.title as string) || "Untitled"
                : "Select a song"}
            </h1>
            ${this.renderSongPaneSaveButton()}
            ${this.renderSongActions()}
          </div>
        </header>
        <div class="song-body scroll-region">
          ${this.renderSongNotices()}
          <div class="song-content ${this.isProjectionActive() ? "projecting" : ""}">
            ${this.currentSong
              ? html`<div class="song-title-meta">
                  <div class="song-title-meta-line">${this.renderSongTitleMeta()}</div>
                  ${this.renderSongSecondaryMeta()}
                </div>`
              : nothing}
            ${this.renderSongContent()}
          </div>
        </div>
      </section>
    `;
  }

  /** Ad hoc edit bar and the "On screen" line, pinned at the top of the song body. */
  private renderSongNotices() {
    const adhoc = this.renderAdhocEditBar();
    const onScreen = this.renderStanzaNavigation();
    if (adhoc === nothing && onScreen === nothing) return nothing;
    return html`<div class="song-notices">${adhoc}${onScreen}</div>`;
  }

  /**
   * Stanzas are switched with the number keys (and by clicking a stanza), so
   * there are no stanza buttons. While another song is previewed, say which
   * song the number keys still control.
   */
  private renderStanzaNavigation() {
    if (!this.projecting || !this.projection?.slides.length || this.selectedSongIsActive()) {
      return nothing;
    }
    return html`<div class="stanza-navigation">
      <span class="stanza-navigation-title">On screen: ${this.activeProjectionTitle ?? "—"}</span>
    </div>`;
  }

  private async openDuplicateReview() {
    this.settingsOpen = false;
    this.duplicatesOpen = true;
    await this.refreshDuplicates();
  }

  private async refreshDuplicates() {
    try {
      const [groups, recoveryItems] = await Promise.all([
        api.listDuplicateGroups(this.includeReviewedDuplicates),
        api.listRecoveryItems(),
      ]);
      this.duplicateGroups = groups;
      this.recoveryItems = recoveryItems;
      this.duplicatesStale = false;
      const selected = groups.find((group) => group.id === this.duplicateGroupId) ?? groups[0];
      if (selected) {
        this.selectDuplicateGroup(selected.id);
      } else {
        this.duplicateGroupId = null;
        this.duplicateLeft = null;
        this.duplicateRight = null;
      }
    } catch (err) {
      this.showToast(err instanceof Error ? err.message : String(err), "error");
    }
  }

  private selectDuplicateGroup(groupId: string) {
    const group = this.duplicateGroups.find((candidate) => candidate.id === groupId);
    if (!group) return;
    this.duplicateGroupId = groupId;
    const filenames = group.candidates.map((candidate) => candidate.filename);
    if (!this.duplicateLeft || !filenames.includes(this.duplicateLeft)) {
      this.duplicateLeft = filenames[0] ?? null;
    }
    if (
      !this.duplicateRight ||
      !filenames.includes(this.duplicateRight) ||
      this.duplicateRight === this.duplicateLeft
    ) {
      this.duplicateRight = filenames.find((filename) => filename !== this.duplicateLeft) ?? null;
    }
  }

  private selectedDuplicateCandidate(filename: string | null): DuplicateCandidate | null {
    const group = this.duplicateGroups.find((candidate) => candidate.id === this.duplicateGroupId);
    return group?.candidates.find((candidate) => candidate.filename === filename) ?? null;
  }

  private async keepDuplicatePair() {
    const left = this.selectedDuplicateCandidate(this.duplicateLeft);
    const right = this.selectedDuplicateCandidate(this.duplicateRight);
    if (!left || !right || left.filename === right.filename) return;
    await api.markDuplicateKeepBoth(left.contentHash, right.contentHash);
    this.showToast("File pair marked as reviewed; both are kept", "success");
    await this.refreshDuplicates();
  }

  private async deleteDuplicateCandidate(candidate: DuplicateCandidate) {
    const ok = await confirm(
      `Delete "${candidate.title}" (${candidate.filename})? A verified recovery copy will be kept.`,
      {
        title: "Delete possible duplicate",
        kind: "warning",
        okLabel: "Delete file",
        cancelLabel: "Cancel",
      },
    );
    if (!ok) return;
    try {
      await api.deleteSong(candidate.filename);
      this.showToast("File deleted; recovery copy retained", "success");
      await this.refreshDuplicates();
      await this.refreshSongs();
    } catch (err) {
      this.showToast(err instanceof Error ? err.message : String(err), "error");
    }
  }

  private async restoreRecovery(item: RecoveryItem) {
    try {
      const filename = await api.restoreRecoveryItem(item.id);
      this.showToast(`Restored as ${filename}`, "success");
      await this.refreshDuplicates();
      await this.refreshSongs();
    } catch (err) {
      this.showToast(err instanceof Error ? err.message : String(err), "error");
    }
  }

  private duplicateCandidateOptions(group: DuplicateGroup | undefined) {
    return (group?.candidates ?? []).map(
      (candidate) => html`<option value=${candidate.filename}>${candidate.filename}</option>`,
    );
  }

  private renderDuplicateCandidate(candidate: DuplicateCandidate | null) {
    if (!candidate) return html`<p class="empty-copy">Select a file to compare.</p>`;
    const lyrics = candidate.raw
      .split(/\r?\n/)
      .filter((line) => {
        const value = line.trim();
        return value !== "" && !value.startsWith("{") && !value.startsWith("#");
      })
      .map((line) => line.replace(/\[[^\]]+\]/g, ""))
      .join("\n");
    const chords = candidate.raw.match(/\[[^\]]+\]/g)?.join("  ") ?? "No chords";
    return html`
      <div class="duplicate-meta">
        <strong>${candidate.title || "Untitled"}</strong>
        <span>#${candidate.songNum ?? "—"}</span>
        <span>Key ${candidate.key ?? "—"}</span>
        <span>${candidate.modifiedAt ? new Date(candidate.modifiedAt).toLocaleString() : "Unknown date"}</span>
      </div>
      <h4>Lyrics</h4>
      <pre class="duplicate-text">${lyrics}</pre>
      <h4>Chords</h4>
      <pre class="duplicate-chords">${chords}</pre>
      <h4>Raw ChordPro</h4>
      <pre class="duplicate-raw">${candidate.raw}</pre>
      <button
        class="secondary compact"
        ?disabled=${this.readOnly}
        @click=${() => this.deleteDuplicateCandidate(candidate)}
      >Delete ${candidate.filename}</button>
    `;
  }

  private renderDuplicateReviewContent(): TemplateResult {
    const group = this.duplicateGroups.find((candidate) => candidate.id === this.duplicateGroupId);
    const left = this.selectedDuplicateCandidate(this.duplicateLeft);
    const right = this.selectedDuplicateCandidate(this.duplicateRight);
    return html`
      <div class="duplicate-toolbar">
        <label class="settings-check">
          <input
            type="checkbox"
            .checked=${this.includeReviewedDuplicates}
            @change=${(event: Event) => {
              this.includeReviewedDuplicates = (event.target as HTMLInputElement).checked;
              void this.refreshDuplicates();
            }}
          />
          <span>Show reviewed matches</span>
        </label>
        <div class="duplicate-refresh">
          ${this.duplicatesStale ? html`<span class="badge">Files changed — refresh needed</span>` : nothing}
          <button class="ghost compact" @click=${() => this.refreshDuplicates()}>Refresh</button>
        </div>
      </div>
      <div class="duplicate-layout">
        <aside class="duplicate-groups">
          ${this.duplicateGroups.length === 0
            ? html`<p class="empty-copy">No possible duplicates found.</p>`
            : this.duplicateGroups.map(
                (candidate) => html`
                  <button
                    class=${candidate.id === this.duplicateGroupId ? "active" : ""}
                    @click=${() => this.selectDuplicateGroup(candidate.id)}
                  >
                    <strong>${candidate.candidates.map((item) => item.title || item.filename).join(" / ")}</strong>
                    <span>${candidate.reasons.join(" · ")}</span>
                    ${candidate.reviewed ? html`<em>Reviewed</em>` : nothing}
                  </button>
                `,
              )}
        </aside>
        <section class="duplicate-review">
          ${group
            ? html`
                <div class="duplicate-reasons">Why flagged: ${group.reasons.join(" · ")}</div>
                <div class="duplicate-selectors">
                  <select
                    .value=${this.duplicateLeft ?? ""}
                    @change=${(event: Event) =>
                      (this.duplicateLeft = (event.target as HTMLSelectElement).value)}
                  >${this.duplicateCandidateOptions(group)}</select>
                  <select
                    .value=${this.duplicateRight ?? ""}
                    @change=${(event: Event) =>
                      (this.duplicateRight = (event.target as HTMLSelectElement).value)}
                  >${this.duplicateCandidateOptions(group)}</select>
                </div>
                <div class="duplicate-columns">
                  <article>${this.renderDuplicateCandidate(left)}</article>
                  <article>${this.renderDuplicateCandidate(right)}</article>
                </div>
                <div class="duplicate-actions">
                  <button class="primary" @click=${() => this.keepDuplicatePair()}>
                    Keep both and mark this pair reviewed
                  </button>
                </div>
              `
            : nothing}
        </section>
      </div>
      <section class="recovery-list">
        <h3>Recovery copies</h3>
        ${this.recoveryItems.length === 0
          ? html`<p class="empty-copy">No recovery copies yet.</p>`
          : this.recoveryItems.map(
              (item) => html`
                <div>
                  <span>${item.original_filename} · ${new Date(item.created_at).toLocaleString()}</span>
                  <button
                    class="secondary compact"
                    ?disabled=${this.readOnly}
                    @click=${() => this.restoreRecovery(item)}
                  >Restore</button>
                </div>
              `,
            )}
      </section>
    `;
  }

  private renderSongTitleMeta() {
    if (!this.currentSong) return nothing;
    const meta = this.currentSong.parsed.meta;
    const hasNum = meta.song_num != null && meta.song_num !== "";
    const hasKey = Boolean(meta.key);
    if (!hasNum && !hasKey) return nothing;
    return html`
      ${hasNum ? html`<span class="song-title-meta-num">#${meta.song_num}</span>` : nothing}
      ${hasKey ? html`<span class="song-title-meta-key">${meta.key}</span>` : nothing}
    `;
  }

  /** Edit, favourite star and add-to-setlist, right-aligned on the title row. */
  private renderSongActions() {
    if (!this.currentSong) return nothing;
    const filename = this.setlistCandidate();
    const favorite = Boolean(filename && this.favoriteFiles.has(filename));
    return html`
      <div class="toolbar-group song-actions" role="toolbar" aria-label="Song">
        <button
          type="button"
          class="song-action-btn"
          title="Edit the ChordPro source"
          aria-label="Edit the ChordPro source"
          @click=${() => this.openEdit()}
        >${icon("edit")}</button>
        ${filename
          ? html`
              <button
                type="button"
                class="song-action-btn star-btn ${favorite ? "active" : ""}"
                title=${`${favorite ? "Remove from favourites" : "Add to favourites"} (${formatCombo(this.shortcuts.toggle_favorite)})`}
                aria-label=${favorite ? "Remove from favourites" : "Add to favourites"}
                aria-pressed=${favorite ? "true" : "false"}
                @click=${() => this.toggleFavorite(filename)}
              >${icon("favorites")}</button>
              ${this.renderSetlistButton(filename)}
            `
          : nothing}
      </div>
    `;
  }

  private renderSetlistButton(filename: string) {
    const current = this.currentSetlist;
    const inSetlist = this.setlistHasSong(current, filename);
    // In the setlist (check): one click takes the song out of the active setlist.
    // Not in it (plus): open the menu to pick a setlist or start a new one.
    const label = inSetlist && current
      ? `Remove from ${current.name}`
      : `Add to a setlist (${formatCombo(this.shortcuts.add_to_setlist)})`;
    return html`
      <div class="setlist-anchor">
        <button
          type="button"
          class="song-action-btn setlist-btn ${inSetlist ? "active" : ""}"
          title=${label}
          aria-label=${label}
          aria-pressed=${inSetlist ? "true" : "false"}
          aria-haspopup=${inSetlist ? nothing : "menu"}
          aria-expanded=${inSetlist ? nothing : this.setlistMenuOpen ? "true" : "false"}
          @click=${() => {
            if (inSetlist && current) {
              this.setlistMenuOpen = false;
              void this.toggleSongInSetlist(current);
            } else {
              void this.toggleSetlistMenu();
            }
          }}
        >${icon(inSetlist ? "check" : "plus")}</button>
        ${this.setlistMenuOpen ? this.renderSetlistMenu(filename) : nothing}
      </div>
    `;
  }

  private renderSetlistMenu(filename: string) {
    return html`
      <div class="setlist-menu" role="menu" aria-label="Add to setlist">
        ${this.setlists.length
          ? html`<div class="setlist-menu-heading">Add to setlist</div>
            <div class="setlist-menu-list">
              ${this.setlists.map((setlist) => {
                const has = this.setlistHasSong(setlist, filename);
                return html`
                  <button
                    type="button"
                    role="menuitemcheckbox"
                    aria-checked=${has ? "true" : "false"}
                    class="setlist-menu-item ${has ? "checked" : ""} ${this.currentSetlist?.id === setlist.id ? "current" : ""}"
                    @click=${() => this.toggleSongInSetlist(setlist)}
                  >
                    <span class="setlist-menu-check">${has ? icon("check", 14) : nothing}</span>
                    <span class="setlist-menu-name">${setlist.name}</span>
                    <span class="setlist-menu-count">${setlist.items.length}</span>
                  </button>
                `;
              })}
            </div>`
          : nothing}
        <form
          class="setlist-menu-new"
          @submit=${(event: Event) => {
            event.preventDefault();
            void this.createSetlistWithSong();
          }}
        >
          <label class="setlist-menu-label" for="new-setlist-name">New setlist</label>
          <div class="setlist-menu-new-row">
            <input
              id="new-setlist-name"
              type="text"
              autocomplete="off"
              spellcheck="false"
              .value=${this.newSetlistName}
              @input=${(e: Event) => (this.newSetlistName = (e.target as HTMLInputElement).value)}
              @keydown=${(e: KeyboardEvent) => {
                if (e.key === "Escape") {
                  e.stopPropagation();
                  this.setlistMenuOpen = false;
                }
              }}
            />
            <button type="submit" class="primary compact toolbar-btn" title="Create the setlist and add this song">
              ${icon("plus", 14)}<span>Create</span>
            </button>
          </div>
        </form>
      </div>
    `;
  }

  private renderSongPaneSaveButton() {
    if (!this.currentFilename || !isWebResultId(this.currentFilename) || !this.webSearchEnabled) {
      return nothing;
    }
    return html`
      <button
        type="button"
        class="secondary compact song-pane-save"
        @click=${() => this.saveWebResult()}
      >
        Save to library
      </button>
    `;
  }

  private renderAdhocEditBar() {
    const editing = this.adhocEditingBlockKey != null;
    const changed = hasPendingEdits(this.adhocPendingEdits);
    if (!editing && !changed) return nothing;
    return html`
      <div class="adhoc-edit-bar ${editing ? "active" : ""}">
        <span class="adhoc-edit-label">${editing ? "Ad hoc editing" : "Unsaved corrections"}</span>
        ${changed && this.canAdhocEdit()
          ? html`
              <button
                type="button"
                class="primary compact adhoc-save-btn"
                @click=${() => this.saveAdhocEdits()}
              >
                Save corrections
              </button>
            `
          : nothing}
        ${editing
          ? html`
              <button type="button" class="ghost compact" @click=${() => this.exitAdhocEdit()}>
                Done
              </button>
            `
          : nothing}
      </div>
    `;
  }

  private renderSongSecondaryMeta() {
    if (!this.currentSong) return nothing;
    if (this.currentFilename && isWebResultId(this.currentFilename)) {
      const candidate = this.webResults[webResultIndex(this.currentFilename)];
      if (!candidate) return nothing;
      return html`<div class="song-meta-bar">${candidate.source_name} · Web result</div>`;
    }
    const meta = this.currentSong.parsed.meta;
    const parts: string[] = [];
    if (meta.category) parts.push(String(meta.category));
    if (meta.ccli) parts.push(`CCLI ${meta.ccli}`);
    if (!parts.length) return nothing;
    return html`<div class="song-meta-bar">${parts.join(" · ")}</div>`;
  }

  private renderSongContent() {
    if (!this.currentSong) {
      return html`<p class="empty-state">
        Choose a song from the library to view the full lyrics here.
      </p>`;
    }
    const performanceSections = buildPerformanceSections(this.currentSong.parsed.sections);
    if (!performanceSections.length) {
      return html`<p class="empty-state">This song has no parsed content.</p>`;
    }
    const blocks = buildPreviewStanzaBlocksFromSections(performanceSections);
    if (this.isProjectionActive() && this.selectedSongIsActive()) {
      return this.renderStanzaPerformanceContent(performanceSections, blocks);
    }
    return this.renderFlatPerformanceContent(performanceSections);
  }

  private lineBlockKeys(sectionIndex: number, lines: LyricLine[]): (string | null)[] {
    const keys: (string | null)[] = [];
    let stanzaInSection = 0;
    let inStanza = false;

    for (const line of lines) {
      if (lineIsBlank(line)) {
        if (inStanza) {
          stanzaInSection += 1;
          inStanza = false;
        }
        keys.push(null);
        continue;
      }
      if (!inStanza) inStanza = true;
      keys.push(stanzaBlockKey(sectionIndex, stanzaInSection));
    }
    return keys;
  }

  private renderFlatPerformanceContent(
    performanceSections: ReturnType<typeof buildPerformanceSections>,
  ) {
    return performanceSections.map((section, sectionIndex) => {
      const blockKeys = this.lineBlockKeys(sectionIndex, section.lines);
      let previousBlockKey: string | null = null;

      return html`
        <section class="song-section ${section.kind}">
          <h3 class="song-section-label">${section.label}</h3>
          ${section.lines.map((line, lineIndex) => {
            const provenance = section.lineProvenance[lineIndex];
            if (!provenance || lineIsBlank(line)) {
              previousBlockKey = null;
              return nothing;
            }

            const blockKey = blockKeys[lineIndex]!;
            const isEditing = this.adhocEditingBlockKey === blockKey;
            const focusOnMount = isEditing && previousBlockKey !== blockKey;
            previousBlockKey = blockKey;

            return this.renderInteractiveLyricLine(
              line,
              provenance,
              blockKey,
              isEditing,
              this.canAdhocEdit(),
              focusOnMount,
              false,
            );
          })}
        </section>
      `;
    });
  }

  private renderStanzaPerformanceContent(
    performanceSections: ReturnType<typeof buildPerformanceSections>,
    blocks: PreviewStanzaBlock[],
  ) {
    const markers = buildStanzaMarkers(this.projection!.slides);
    const activeBlock = activeStanzaIndex(markers, this.projection!.current_index);

    return performanceSections.map((section, sectionIndex) => {
      const sectionBlocks = blocks
        .map((block, index) => ({ block, index }))
        .filter(({ block }) => block.sectionIndex === sectionIndex);
      if (!sectionBlocks.length) return nothing;

      return html`
        <section class="song-section ${section.kind}">
          <h3 class="song-section-label">${section.label}</h3>
          ${sectionBlocks.map(({ block, index }) => {
            const blockKey = stanzaBlockKey(sectionIndex, block.stanzaIndexInSection);
            const isActive = index === activeBlock;
            const slideIndex = markers[index]?.slideIndices[0];
            const isEditing = this.adhocEditingBlockKey === blockKey;
            const canEdit = this.canAdhocEdit() && isActive;

            return html`
              <div
                class="song-stanza ${isActive ? "active" : ""} ${isEditing ? "editing" : ""} ${canEdit ? "editable" : ""}"
                aria-current=${isActive ? "true" : "false"}
                @click=${(event: Event) => {
                  if (slideIndex == null || isEditing) return;
                  if (!this.canAdhocEdit() || !isActive) {
                    void this.jumpToStanza(slideIndex);
                    return;
                  }
                  const target = event.target as HTMLElement;
                  if (target.closest(".song-lyrics, .song-lyric-editable")) {
                    this.enterAdhocEdit(blockKey, event);
                    return;
                  }
                  void this.jumpToStanza(slideIndex);
                }}
              >
                ${this.renderStanzaLines(block, isEditing, canEdit && isActive)}
              </div>
            `;
          })}
        </section>
      `;
    });
  }

  private renderStanzaLines(block: PreviewStanzaBlock, editing: boolean, focusOnMount: boolean) {
    return block.lines.map((line, lineIndex) => {
      const provenance = block.lineProvenance[lineIndex];
      if (!provenance || lineIsBlank(line)) return nothing;

      return this.renderInteractiveLyricLine(
        line,
        provenance,
        stanzaBlockKey(block.sectionIndex, block.stanzaIndexInSection),
        editing,
        this.canAdhocEdit(),
        focusOnMount && lineIndex === 0,
        true,
      );
    });
  }

  private renderInteractiveLyricLine(
    line: LyricLine,
    provenance: { sectionIndex: number; lineIndex: number },
    blockKey: string,
    editing: boolean,
    canEdit: boolean,
    focusOnMount: boolean,
    inStanza: boolean,
  ) {
    const originalText = line.text;
    const displayText = this.displayLineText(provenance, originalText);
    const changed = this.lineHasPendingEdit(provenance);

    if (editing) {
      return html`
        <div class="song-line">
          <div
            class="song-lyrics song-lyric-editable"
            contenteditable="plaintext-only"
            spellcheck="false"
            @input=${(event: Event) => this.onAdhocLineInput(provenance, originalText, event)}
            @keydown=${(event: KeyboardEvent) => event.stopPropagation()}
            ${(el: HTMLElement) => this.bindEditableLine(el, displayText, focusOnMount)}>${displayText || "\u00a0"}</div>
        </div>
      `;
    }

    return html`
      <div
        class="song-line ${canEdit ? "editable-line" : ""}"
        @click=${(event: Event) => {
          if (!canEdit || inStanza) return;
          this.enterAdhocEdit(blockKey, event);
        }}
      >
        <div
          class="song-lyrics ${changed ? "adhoc-changed-line" : ""}"
          @click=${(event: Event) => {
            if (!canEdit || !inStanza) return;
            this.enterAdhocEdit(blockKey, event);
          }}>${changed ? this.renderDiffLine(originalText, displayText) : displayText || "\u00a0"}</div>
      </div>
    `;
  }

  private bindEditableLine(el: HTMLElement, displayText: string, shouldFocus: boolean) {
    if (document.activeElement !== el) {
      el.textContent = displayText || "\u00a0";
    }
    if (shouldFocus && document.activeElement !== el) {
      requestAnimationFrame(() => {
        el.focus();
        const range = document.createRange();
        range.selectNodeContents(el);
        range.collapse(false);
        const sel = window.getSelection();
        sel?.removeAllRanges();
        sel?.addRange(range);
      });
    }
  }

  private renderDiffLine(original: string, current: string) {
    const segments = diffLineSegments(original, current);
    return segments.map((segment) =>
      segment.changed
        ? html`<span class="adhoc-changed">${segment.text}</span>`
        : segment.text,
    );
  }

  private audienceDisplayOptions(): SelectOption[] {
    return [
      { value: "", label: "Primary display" },
      { value: SIMULATED_DISPLAY_ID, label: "Simulated display (window)" },
      ...this.displays.map((display) => ({ value: display.id, label: display.label })),
    ];
  }

  private stageDisplayOptions(): SelectOption[] {
    return [
      { value: "", label: "Default window" },
      { value: SIMULATED_DISPLAY_ID, label: "Simulated display (window)" },
      ...this.displays.map((display) => ({ value: display.id, label: display.label })),
    ];
  }

  private settingMatches(section: (typeof SETTINGS_SECTIONS)[number], query: string): boolean {
    const terms = query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
    const haystack = `${section.label} ${section.keywords}`.toLocaleLowerCase();
    return terms.every((term) => haystack.includes(term));
  }

  private selectSettingsSection(section: SettingsSectionId) {
    this.activeSettingsSection = section;
    this.settingsQuery = "";
  }

  private renderSettingsSection(id: SettingsSectionId): TemplateResult {
    const folderLabel = this.libraryStatus?.songs_folder ?? "No folder selected";
    const title = SETTINGS_SECTIONS.find((section) => section.id === id)?.label ?? "Settings";
    let content: TemplateResult;

    switch (id) {
      case "library":
        content = html`
          <p class="settings-hint">${this.serverLibrary
            ? "Using a read-only offline replica from your church server."
            : "Using ordinary ChordPro files from a folder on this computer."}</p>
          <p class="settings-path">${folderLabel}</p>
          <div class="settings-actions">
            <button class="secondary" @click=${() => this.pickFolder()}>Use local songs folder</button>
            <button class="secondary" ?disabled=${Boolean(this.serverLibrary)} @click=${() => this.runImportMdb()}>Import MDB</button>
            <button class="ghost" @click=${() => this.rescan()}>Rescan library</button>
            <button class="ghost" @click=${() => this.openDuplicateReview()}>Review possible duplicates</button>
          </div>
          <label class="settings-check">
            <input type="checkbox" .checked=${this.showSongNumbers} @change=${(e: Event) => this.onShowSongNumbersChange((e.target as HTMLInputElement).checked)} />
            <span>Show song numbers in the song list</span>
          </label>`;
        break;
      case "server":
        content = this.serverLibrary
          ? html`
              <p class="settings-path">${this.serverLibrary.url}</p>
              <p class="settings-hint">${this.serverLibrary.song_count} songs cached · Last synchronized ${this.formatServerSyncTime(this.serverLibrary.last_synced_at)}</p>
              <div class="settings-actions">
                <button class="primary" ?disabled=${this.serverSyncing} @click=${() => this.syncServerLibrary()}>${this.serverSyncing ? "Synchronizing…" : "Synchronize library"}</button>
                <button class="ghost" ?disabled=${this.serverSyncing} @click=${() => this.disconnectServerLibrary()}>${this.lastLocalSongsFolder ? "Return to local library" : "Disconnect"}</button>
              </div>
              ${this.renderServerSyncProgress()}
              <p class="settings-hint settings-note">Synchronization adds exact local-only songs from the remembered local folder, then downloads the complete server library. Projection and browsing continue from the cache when the server is offline.</p>
              <p class="settings-hint settings-note">Setlists are the church's shared sets: changes here are sent to the server, and sets made on a phone arrive within a minute. If a set was changed elsewhere at the same time, your version is kept as a copy.</p>
              <label class="settings-check"><input type="checkbox" .checked=${this.serverRemoteEnabled} @change=${(e: Event) => this.onServerRemoteChange((e.target as HTMLInputElement).checked)} /><span>Allow remote control through the song server</span></label>
              <p class="settings-hint">Leaders signed in to the song server can change slides, blank the screen and project songs from their phones, from anywhere. This PC stays in charge: everything also works without the server.</p>`
          : this.renderServerConnect();
        break;
      case "vsb":
        content = this.vsbSync
          ? html`
              <p class="settings-path">${this.vsbSync.mdb_path}</p>
              <p class="settings-hint">${this.vsbSync.last_synced_at
                ? `Last synchronized ${this.formatServerSyncTime(this.vsbSync.last_synced_at)} · ${this.vsbSync.last_summary ?? ""}`
                : "Not synchronized yet"}</p>
              ${this.vsbSync.last_error ? html`<p class="settings-hint settings-error">${this.vsbSync.last_error}</p>` : nothing}
              <div class="settings-actions">
                <button class="primary" ?disabled=${this.vsbSyncing} @click=${() => this.syncVsbNow()}>${this.vsbSyncing ? "Synchronizing…" : "Synchronize now"}</button>
                <button class="secondary" ?disabled=${this.vsbSyncing} @click=${() => this.linkVsbDatabase()}>Link another database</button>
                <button class="ghost" ?disabled=${this.vsbSyncing} @click=${() => this.unlinkVsbDatabase()}>Unlink</button>
              </div>
              <p class="settings-hint settings-note">Changes flow both ways at start-up, every minute when either side changed, and when you press Synchronize. A song edited on both sides keeps the Psalm150 version. The database is backed up before every write (the last 10 copies are kept).${this.serverLibrary ? " With a song server, VSB changes are sent to the server (a song edited there in the meantime keeps the server version), and syncing waits while something is projected." : ""}</p>`
          : html`
              <p class="settings-hint">Keep a Visual Song Book database and this library in step: songs added, edited or deleted on one side follow on the other. Works with a local songs folder and with a song server library.</p>
              <button class="primary" @click=${() => this.linkVsbDatabase()}>Link VSB database…</button>
              <p class="settings-hint settings-note">Writing to VSB uses the Microsoft Access Database Engine (64-bit), included with Office. Without it, VSB changes still reach Psalm150.</p>`;
        break;
      case "projection":
        content = html`
          <div class="settings-row"><span class="settings-row-label">Congregation</span><psa150-select .options=${this.audienceDisplayOptions()} .value=${this.audienceMonitor} @psa150-change=${(e: CustomEvent<string>) => this.onAudienceMonitorChange(e.detail)}></psa150-select></div>
          <div class="settings-row"><span class="settings-row-label">Stage</span><psa150-select .options=${this.stageDisplayOptions()} .value=${this.stageMonitor} @psa150-change=${(e: CustomEvent<string>) => this.onStageMonitorChange(e.detail)}></psa150-select></div>
          <label class="settings-check"><input type="checkbox" .checked=${this.projectToStage} @change=${(e: Event) => this.onProjectToStageChange((e.target as HTMLInputElement).checked)} /><span>Also show stage window when projecting (musician chords)</span></label>
          <label class="settings-check"><input type="checkbox" .checked=${this.readOnly} ?disabled=${Boolean(this.serverLibrary)} @change=${(e: Event) => this.onReadOnlyChange((e.target as HTMLInputElement).checked)} /><span>Read-only library (prevent edits and deletes)</span></label>`;
        break;
      case "search":
        content = html`<label class="settings-check"><input type="checkbox" .checked=${this.webSearchEnabled} @change=${(e: Event) => this.onWebSearchEnabledChange((e.target as HTMLInputElement).checked)} /><span>Search the web when no local songs match</span></label>`;
        break;
      case "remote":
        content = html`
          <label class="settings-check"><input type="checkbox" .checked=${Boolean(this.remoteStatus?.running)} @change=${(e: Event) => this.onRemoteEnabledChange((e.target as HTMLInputElement).checked)} /><span>Let a phone on the network (Wi-Fi or Tailscale) change slides</span></label>
          ${this.remoteStatus?.running ? html`<p class="settings-path">On the phone, open http://&lt;this PC&gt;:${this.remoteStatus.port}/ · PIN ${this.remoteStatus.pin}</p>` : nothing}`;
        break;
      case "reports":
        content = html`<div class="settings-actions"><button class="secondary" @click=${() => this.printSongbook()}>Print songbook HTML</button><button class="secondary" @click=${() => this.exportCcli()}>Export CCLI CSV</button></div>`;
        break;
      case "shortcuts":
        content = html`
          <p class="settings-hint">Click a shortcut, then press the new keys. Esc cancels, Backspace removes it.</p>
          <div class="shortcut-list">
            ${SHORTCUT_ACTIONS.map(({ id, label }) => {
              const recording = this.recordingShortcut === id;
              return html`
                <div class="shortcut-row ${recording ? "recording" : ""}">
                  <span class="shortcut-label">${label}</span>
                  <button
                    type="button"
                    class="shortcut-key"
                    aria-label="Change the shortcut for ${label}"
                    @click=${() => {
                      this.shortcutError = null;
                      this.recordingShortcut = recording ? null : id;
                    }}
                  >${recording ? "Press keys…" : formatCombo(this.shortcuts[id])}</button>
                </div>
              `;
            })}
          </div>
          ${this.shortcutError ? html`<p class="settings-hint settings-error">${this.shortcutError}</p>` : nothing}
          <div class="settings-actions">
            <button class="ghost" @click=${() => this.resetShortcuts()}>Reset to defaults</button>
          </div>
          <h4 class="shortcut-fixed-heading">Fixed keys</h4>
          <div class="shortcuts">
            <span><kbd>Enter</kbd> project</span><span><kbd>↑</kbd> <kbd>↓</kbd> songs, or stanzas while projecting</span>
            <span><kbd>1</kbd>–<kbd>9</kbd> jump to stanza; type <kbd>10</kbd>, <kbd>11</kbd>… quickly</span>
            <span><kbd>#</kbd> in search: pick a key</span><span><kbd>Esc</kbd> close projection</span>
            <span><kbd>Ctrl</kbd> + <kbd>E</kbd> search</span>
            <span><kbd>Ctrl</kbd> + <kbd>1</kbd>–<kbd>4</kbd> Search, Setlist, History, Favourites</span>
          </div>`;
        break;
    }

    return html`<section class="settings-section" id="settings-${id}"><h3>${title}</h3>${content}</section>`;
  }

  private renderSettingsContent(): TemplateResult {
    const query = this.settingsQuery.trim();
    const matchingSections = SETTINGS_SECTIONS.filter((section) => this.settingMatches(section, query));
    const sectionsToRender = query
      ? matchingSections.map((section) => section.id)
      : [this.activeSettingsSection];

    return html`
      <div class="settings-layout">
        <aside class="settings-nav" aria-label="Settings categories">
          <label class="settings-search">
            <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6"></circle><path d="m16 16 4 4"></path></svg>
            <input type="search" placeholder="Find a setting" .value=${this.settingsQuery} @input=${(event: Event) => (this.settingsQuery = (event.target as HTMLInputElement).value)} />
            ${query ? html`<button type="button" aria-label="Clear settings search" @click=${() => (this.settingsQuery = "")}>×</button>` : nothing}
          </label>
          <span class="settings-nav-label">Settings</span>
          <nav>
            ${SETTINGS_SECTIONS.map((section) => html`
              <button class="${!query && this.activeSettingsSection === section.id ? "active" : ""}" type="button" @click=${() => this.selectSettingsSection(section.id)}>
                <span class="settings-nav-icon" aria-hidden="true">${section.icon}</span>${section.label}
                ${query && this.settingMatches(section, query) ? html`<span class="settings-match" aria-label="Matches search">•</span>` : nothing}
              </button>`)}
          </nav>
        </aside>
        <div class="settings-panel" aria-live="polite">
          ${query ? html`<div class="settings-results-heading"><span>Search results</span><strong>${matchingSections.length} ${matchingSections.length === 1 ? "section" : "sections"} match “${query}”</strong></div>` : nothing}
          ${sectionsToRender.length ? sectionsToRender.map((id) => this.renderSettingsSection(id)) : html`<div class="settings-empty"><strong>No matching settings</strong><span>Try terms like “display”, “songs”, “remote”, or “import”.</span></div>`}
        </div>
      </div>`;
  }

  private renderEditContent(): TemplateResult {
    return html`
      <textarea
        id="editor"
        class="editor"
        placeholder="ChordPro content…"
        .value=${this.editorValue}
        @input=${(e: Event) => (this.editorValue = (e.target as HTMLTextAreaElement).value)}
      ></textarea>
      <div class="edit-toolbar">
        <button class="primary compact" @click=${() => this.saveSong()}>Save</button>
        <button class="secondary compact" @click=${() => this.deleteSong()}>Delete</button>
        <span class="edit-divider"></span>
        <button class="ghost compact" @click=${() => this.transpose(1)}>Transpose +</button>
        <button class="ghost compact" @click=${() => this.transpose(-1)}>Transpose −</button>
      </div>
    `;
  }

  private renderImportContent(): TemplateResult {
    const total = Math.max(this.importTotal, 1);
    const pct = this.importTotal > 0 ? Math.round((this.importCurrent / total) * 100) : 0;
    return html`
      <p>Converting songs from the MDB file into ChordPro files.</p>
      <div class="progress-track" aria-hidden="true">
        <div class="progress-fill" style="width: ${pct}%"></div>
      </div>
      <div class="progress-meta">
        <span>${this.importTotal > 0 ? `${this.importCurrent} / ${this.importTotal} songs` : "Reading songbook…"}</span>
        <span>${this.importTotal > 0 ? `${pct}%` : "…"}</span>
      </div>
      <div class="progress-song">${this.importSong || "Preparing…"}</div>
      <div class="modal-actions">
        <button
          class="secondary"
          type="button"
          @click=${() => {
            void api.cancelImport();
            this.importSong = "Cancelling…";
          }}
        >
          Cancel
        </button>
      </div>
    `;
  }

  private renderImportReportContent(): TemplateResult {
    const report = this.importReport;
    if (!report) return html`<p>No import report is available.</p>`;
    return html`
      <p>${this.formatImportReport(report)}</p>
      <div class="import-report-list scroll-region">
        ${report.files.map(
          (file) => html`
            <div class="import-report-row ${file.status}">
              <span class="import-report-status">${file.status}</span>
              <strong>${file.filename ?? file.title}</strong>
              ${file.reason ? html`<span>${file.reason}</span>` : nothing}
            </div>
          `,
        )}
      </div>
    `;
  }
}

function isContentEditableTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && target.isContentEditable;
}

function isTextEntryTarget(
  target: EventTarget | null,
): target is HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement
  );
}

function readLocal(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeLocal(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // Storage unavailable; the choice just is not remembered.
  }
}

function localIsoDate(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Today in the PC's short date format (e.g. 23.09.26 with Norwegian settings). */
async function defaultSetlistName(): Promise<string> {
  const fromSystem = await api.formatShortDate().catch(() => null);
  return fromSystem || new Intl.DateTimeFormat(undefined, { dateStyle: "short" }).format(new Date());
}

function syntheticRow(id: number, filename: string, title: string): SongRow {
  return {
    id,
    filename,
    title,
    title_sort: title.toUpperCase(),
    song_num: null,
    key: null,
    category: null,
    tags: null,
    ccli: null,
    modified_at: null,
    favorite: false,
  };
}

function delay(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

customElements.define("psa150-app", Psa150App);

declare global {
  interface HTMLElementTagNameMap {
    "psa150-app": Psa150App;
  }
}
