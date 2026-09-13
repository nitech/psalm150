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
  type RemoteStatus,
  type Setlist,
  type SongDetail,
  type SongRow,
  type WebSearchCandidate,
} from "../api";
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
import type { Psa150Combobox } from "./combobox";
import "./combobox";
import type { SelectOption } from "./select";
import "./select";
import "./modal";
import "./song-list";
import { isWebResultId, webResultId, webResultIndex } from "./song-list-ids";

type Tab = "search" | "key" | "history" | "favorites" | "setlist";
type ToastTone = "info" | "success" | "error";

const TAB_LABELS: Record<Tab, string> = {
  search: "Search",
  key: "Key",
  history: "History",
  favorites: "Favourites",
  setlist: "Setlist",
};

const BROWSE_PANE_WIDTH_KEY = "psa150-browse-pane-width";
const BROWSE_PANE_MIN = 280;
const BROWSE_PANE_MAX = 720;
const BROWSE_PANE_DEFAULT = 340;
const WEB_SEARCH_DEBOUNCE_MS = 650;
const SONG_SORT_KEY = "psa150-song-sort";

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
    activeTab: { state: true },
    currentSetlist: { state: true },
    projectToStage: { state: true },
    readOnly: { state: true },
    webSearchEnabled: { state: true },
    displays: { state: true },
    audienceMonitor: { state: true },
    stageMonitor: { state: true },
    keys: { state: true },
    query: { state: true },
    keySelected: { state: true },
    setlistName: { state: true },
    setlistDate: { state: true },
    editorValue: { state: true },
    settingsOpen: { state: true },
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
  declare activeTab: Tab;
  declare currentSetlist: Setlist | null;
  declare projectToStage: boolean;
  declare readOnly: boolean;
  declare webSearchEnabled: boolean;
  declare displays: DisplayInfo[];
  declare audienceMonitor: string;
  declare stageMonitor: string;
  declare keys: string[];
  declare query: string;
  declare keySelected: string;
  declare setlistName: string;
  declare setlistDate: string;
  declare editorValue: string;
  declare settingsOpen: boolean;
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
  private unlistenLibrary: UnlistenFn | null = null;
  private unlistenProjection: UnlistenFn | null = null;
  private unlistenProjectionClosed: UnlistenFn | null = null;
  private unlistenExternalLibrary: UnlistenFn | null = null;
  private unlistenWindowResize: UnlistenFn | null = null;
  private importBusy = false;
  private keysLoaded = false;
  private songsRefreshGeneration = 0;
  private splitterDragging = false;
  private tabIndicatorObserver: ResizeObserver | null = null;
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
    this.activeTab = "search";
    this.currentSetlist = null;
    this.projectToStage = false;
    this.readOnly = false;
    this.webSearchEnabled = true;
    this.displays = [];
    this.audienceMonitor = "";
    this.stageMonitor = "";
    this.keys = [];
    this.query = "";
    this.keySelected = "";
    this.setlistName = "";
    this.setlistDate = "";
    this.editorValue = "";
    this.settingsOpen = false;
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
    window.addEventListener("keydown", this.onGlobalKeydown);
    window.addEventListener("blur", this.stanzaNumberInput.reset);
    window.addEventListener("focusin", this.stanzaNumberInput.reset);
    window.addEventListener("pointerdown", this.stanzaNumberInput.reset);
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
        requestAnimationFrame(() => this.updateTabIndicator());
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
        await this.refreshLibraryStatus();
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
      this.applyProjectionSnapshot(await api.getProjectionSnapshot());
    } catch (err) {
      console.error(err);
    }
    await this.bootstrapLibrary();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    window.removeEventListener("keydown", this.onGlobalKeydown);
    window.removeEventListener("blur", this.stanzaNumberInput.reset);
    window.removeEventListener("focusin", this.stanzaNumberInput.reset);
    window.removeEventListener("pointerdown", this.stanzaNumberInput.reset);
    this.stanzaNumberInput.reset();
    this.unlistenLibrary?.();
    this.unlistenProjection?.();
    this.unlistenProjectionClosed?.();
    this.unlistenExternalLibrary?.();
    this.unlistenWindowResize?.();
    this.tabIndicatorObserver?.disconnect();
    void this.unlistenImport?.();
  }

  firstUpdated() {
    this.focusActiveBrowseField();
    this.updateTabIndicator();
    this.observeTabIndicator();
  }

  private observeTabIndicator() {
    const nav = this.querySelector<HTMLElement>(".tabs.segmented");
    if (!nav) return;
    this.tabIndicatorObserver?.disconnect();
    this.tabIndicatorObserver = new ResizeObserver(() => {
      requestAnimationFrame(() => this.updateTabIndicator());
    });
    this.tabIndicatorObserver.observe(nav);
    for (const button of nav.querySelectorAll("button")) {
      this.tabIndicatorObserver.observe(button);
    }
  }

  updated(changed: Map<string, unknown>) {
    if (changed.has("activeTab")) {
      requestAnimationFrame(() => {
        this.updateTabIndicator();
        this.observeTabIndicator();
      });
    }
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

  private updateTabIndicator() {
    const nav = this.querySelector<HTMLElement>(".tabs.segmented");
    const active = nav?.querySelector<HTMLElement>("button.active");
    const indicator = nav?.querySelector<HTMLElement>(".tabs-indicator");
    if (!nav || !active || !indicator) return;
    const navRect = nav.getBoundingClientRect();
    const activeRect = active.getBoundingClientRect();
    indicator.style.width = `${activeRect.width}px`;
    indicator.style.transform = `translateX(${activeRect.left - navRect.left}px)`;
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
    requestAnimationFrame(() => this.updateTabIndicator());
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
    requestAnimationFrame(() => this.updateTabIndicator());
  };

  private focusSearchField(selectAll = false) {
    const input = this.querySelector<HTMLInputElement>("#search-input");
    if (!input) return;
    input.focus({ preventScroll: true });
    if (selectAll) input.select();
  }

  private focusActiveBrowseField() {
    requestAnimationFrame(() => {
      if (this.activeTab === "search") {
        this.focusSearchField();
      } else if (this.activeTab === "key") {
        this.querySelector<Psa150Combobox>("psa150-combobox")?.focusInput();
      }
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
      if (this.activeTab === "search") {
        songs = await api.searchSongs(this.query.trim(), false);
      } else if (this.activeTab === "favorites") {
        songs = await api.searchSongs("", true);
      } else if (this.activeTab === "history") {
        const history = await api.getHistory(50);
        songs = history.map(([filename, title], index) => ({
          id: index,
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
        }));
      } else if (this.activeTab === "key") {
        songs = this.keySelected ? await api.listByKey(this.keySelected) : [];
      } else if (this.activeTab === "setlist") {
        songs =
          this.currentSetlist?.items
            .filter((item) => item.type === "song" && item.file)
            .map((item, index) => ({
              id: index,
              filename: item.file!,
              title: item.file!.replace(/\.(pro|cho)$/i, ""),
              title_sort: item.file!.toUpperCase(),
              song_num: null,
              key: null,
              category: null,
              tags: null,
              ccli: null,
              modified_at: null,
              favorite: false,
            })) ?? [];
      } else {
        songs = await api.searchSongs("", false);
      }
      if (generation !== this.songsRefreshGeneration) return;
      this.songs = songs;
      if (this.activeTab === "search") {
        void this.maybeSearchWeb(generation);
      } else {
        this.webResults = [];
        this.webSearchLoading = false;
      }
    } catch {
      // Library may not be open yet (no songs folder selected, or still loading).
      if (generation !== this.songsRefreshGeneration) return;
      this.songs = [];
      if (this.activeTab === "search") {
        void this.maybeSearchWeb(generation);
      }
    }
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

    const q = this.query.trim();
    if (q.length < 3 || this.songs.length > 0) {
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

    const q = this.query.trim();
    if (q.length < 3 || this.songs.length > 0) return;

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
    if (this.readOnly) return false;
    if (!this.currentSong) return false;
    if (this.currentFilename && isWebResultId(this.currentFilename)) return false;
    return Boolean(this.currentSong.projection.filename);
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
    this.querySelector<HTMLElement>("psa150-song-list li:focus")?.blur();
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
      this.showToast("Song saved", "success");
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
      this.showToast("Corrections saved", "success");
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
    this.readOnly = Boolean(config.read_only);
    this.webSearchEnabled = config.web_search_enabled !== false;
    this.audienceMonitor = config.audience_monitor ?? "";
    this.stageMonitor = config.stage_monitor ?? "";
    this.showSongNumbers = config.show_song_numbers !== false;
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
    this.readOnly = checked;
    await api.setReadOnly(checked);
    this.showToast(checked ? "Library is read-only" : "Edits enabled");
  }

  private async onWebSearchEnabledChange(checked: boolean) {
    this.webSearchEnabled = checked;
    await api.setWebSearchEnabled(checked);
    if (!checked) {
      this.cancelWebSearch();
    } else if (this.activeTab === "search" && this.songs.length === 0) {
      void this.maybeSearchWeb(this.songsRefreshGeneration);
    }
  }

  private async onShowSongNumbersChange(checked: boolean) {
    this.showSongNumbers = checked;
    await api.setShowSongNumbers(checked);
  }

  // ── Song list ordering ─────────────────────────────────────────────────

  /** Only library views sort by column; History keeps recency and Setlist keeps service order. */
  private isSortableTab(): boolean {
    return this.activeTab === "search" || this.activeTab === "key" || this.activeTab === "favorites";
  }

  private setSongSort(column: SongSortColumn) {
    this.songSort = toggleSongSort(this.songSort, column);
    localStorage.setItem(SONG_SORT_KEY, JSON.stringify(this.songSort));
  }

  /** Rows in display order: what the list shows and what keyboard navigation walks. */
  private get visibleSongs(): SongRow[] {
    if (!this.isSortableTab()) return this.songs;
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

  // ── Setlist ────────────────────────────────────────────────────────────

  private async createSetlist() {
    const name = this.setlistName || "Service";
    const date = this.setlistDate || new Date().toISOString().slice(0, 10);
    this.currentSetlist = await api.createSetlist(name, date);
    this.showToast(`Setlist: ${this.currentSetlist.name}`);
  }

  private async advanceSetlist() {
    const item = await api.setlistAdvance();
    if (item?.type === "song" && item.file) {
      this.currentFilename = item.file;
      this.currentSong = await api.loadSong(item.file);
      await this.projectLoadedSong();
    }
  }

  // ── Tabs ───────────────────────────────────────────────────────────────

  private async selectTab(tab: Tab) {
    this.activeTab = tab;
    if (tab === "key") await this.loadKeyOptions();
    await this.refreshSongs();
    await this.updateComplete;
    if (tab === "search" || tab === "key") this.focusActiveBrowseField();
    requestAnimationFrame(() => this.updateTabIndicator());
  }

  // ── Toast ──────────────────────────────────────────────────────────────

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

    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "f") {
      event.preventDefault();
      if (this.activeTab !== "search") {
        await this.selectTab("search");
      }
      requestAnimationFrame(() => this.focusSearchField(true));
      return;
    }

    if (event.key === "Enter" && this.currentSong) {
      // Let Enter activate the focused stanza button through its native click.
      if (target instanceof HTMLElement && target.closest(".stanza-navigation button")) return;
      if (isTextEntryTarget(target) && !(target as HTMLElement).matches("#search-input")) {
        return;
      }
      event.preventDefault();
      await this.projectLoadedSong();
      return;
    }

    if (isTextEntryTarget(target) || isContentEditableTarget(target)) return;

    if (event.key === "ArrowRight") {
      if (!this.projecting || !this.projection?.slides.length) return;
      event.preventDefault();
      await this.advanceSlide("next");
    } else if (event.key === "ArrowLeft") {
      if (!this.projecting || !this.projection?.slides.length) return;
      event.preventDefault();
      await this.advanceSlide("prev");
    } else if (event.key === "ArrowDown") {
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
    } else if (event.key.toLowerCase() === "b") {
      if (this.projecting) this.applyProjectionSnapshot(await api.blankScreen());
    }
  };

  private async onSearchKeydown(event: KeyboardEvent) {
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
      <psa150-modal
        heading="Settings"
        variant="wide"
        ?open=${this.settingsOpen}
        .content=${this.renderSettingsContent()}
        @psa150-close=${() => (this.settingsOpen = false)}
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
    `;
  }

  private renderHeader() {
    return html`
      <header class="app-header" data-tauri-drag-region @dblclick=${this.onTitlebarDblClick}>
        <div class="brand">
          <div class="brand-mark">
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2.5"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path d="M9 18V5l12-2v13" />
              <circle cx="6" cy="18" r="3" />
              <circle cx="18" cy="16" r="3" />
            </svg>
          </div>
          <strong class="brand-name">Psalm150</strong>
        </div>
        <div class="live-bar app-no-drag">
          <span class="live-song" title=${this.activeProjectionTitle ?? "Nothing is being shown"}>
            Now showing: ${this.activeProjectionTitle ?? "—"}
          </span>
          <button class="primary compact" @click=${() => this.projectLoadedSong()}>Project</button>
          <button class="secondary compact" @click=${() => this.advanceSlide("prev")}>Prev</button>
          <button class="secondary compact" @click=${() => this.advanceSlide("next")}>Next</button>
          <button
            class="secondary compact"
            @click=${async () => {
              this.applyProjectionSnapshot(await api.blankScreen());
            }}
          >
            Blank
          </button>
          <button class="ghost compact" ?disabled=${!this.currentSong} @click=${() => this.openEdit()}>
            Edit
          </button>
        </div>
        <div class="header-end app-no-drag">
          <span class="toast ${this.toastTone} ${this.toastVisible ? "" : "hidden"}" role="status">
            ${this.toastMsg}
          </span>
          <span class="badge ${this.libraryStatus?.library_dirty ? "" : "hidden"}">Changed</span>
          <button
            class="icon-btn"
            type="button"
            title="Settings"
            aria-label="Settings"
            @click=${() => this.openSettings()}
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <path
                d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.1a2 2 0 0 1-1-1.72v-.51a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"
              />
              <circle cx="12" cy="12" r="3" />
            </svg>
          </button>
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
                      d="M1 1h5v4H2V2H1V1"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="1"
                    />
                    <rect
                      x="4"
                      y="4"
                      width="5"
                      height="5"
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

  private renderBrowsePane() {
    const tabs: Tab[] = ["search", "key", "history", "favorites", "setlist"];
    return html`
      <aside class="browse-pane" style="width: ${this.browsePaneWidth}px">
        <nav class="tabs segmented" role="tablist">
          <div class="tabs-indicator" aria-hidden="true"></div>
          ${tabs.map(
            (tab) => html`
              <button
                class=${this.activeTab === tab ? "active" : ""}
                role="tab"
                aria-selected=${this.activeTab === tab ? "true" : "false"}
                @click=${() => this.selectTab(tab)}
              >
                ${TAB_LABELS[tab]}
              </button>
            `,
          )}
        </nav>
        ${this.activeTab === "search"
          ? html`
              <div class="browse-toolbar">
                <form class="search-wrap" autocomplete="off" @submit=${(e: Event) => e.preventDefault()}>
                  <svg
                    class="search-icon"
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    aria-hidden="true"
                  >
                    <circle cx="11" cy="11" r="8" />
                    <path d="m21 21-4.3-4.3" />
                  </svg>
                  <input
                    id="search-input"
                    type="text"
                    name="psa150-library-query"
                    placeholder="Search songs, tags, or numbers..."
                    autocomplete="off"
                    autocorrect="off"
                    autocapitalize="off"
                    spellcheck="false"
                    .value=${this.query}
                    @input=${(e: Event) => {
                      this.query = (e.target as HTMLInputElement).value;
                      void this.refreshSongs();
                    }}
                    @keydown=${(e: KeyboardEvent) => this.onSearchKeydown(e)}
                  />
                </form>
              </div>
            `
          : nothing}
        ${this.activeTab === "key"
          ? html`
              <div class="browse-toolbar">
                <psa150-combobox
                  placeholder="Select key"
                  .options=${this.keys}
                  .value=${this.keySelected}
                  @psa150-change=${(e: CustomEvent<string>) => {
                    this.keySelected = e.detail;
                    void this.refreshSongs();
                  }}
                ></psa150-combobox>
              </div>
            `
          : nothing}
        ${this.activeTab === "setlist"
          ? html`
              <div class="browse-toolbar">
                <div class="setlist-fields">
                  <input
                    placeholder="Service name"
                    .value=${this.setlistName}
                    @input=${(e: Event) => (this.setlistName = (e.target as HTMLInputElement).value)}
                  />
                  <input
                    type="date"
                    .value=${this.setlistDate}
                    @input=${(e: Event) => (this.setlistDate = (e.target as HTMLInputElement).value)}
                  />
                </div>
                <div class="setlist-actions">
                  <button class="secondary compact" @click=${() => this.createSetlist()}>Create</button>
                  <button class="secondary compact" @click=${() => this.advanceSetlist()}>Advance</button>
                </div>
              </div>
            `
          : nothing}
        <psa150-song-list
          class="song-list scroll-region ${this.showSongNumbers ? "" : "hide-numbers"}"
          role="listbox"
          .songs=${this.visibleSongs}
          .showNumbers=${this.showSongNumbers}
          .sort=${this.isSortableTab() ? this.songSort : null}
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
            ${this.currentSong
              ? html`<div class="song-title-meta">${this.renderSongTitleMeta()}</div>`
              : nothing}
            ${this.renderSongPaneSaveButton()}
          </div>
          ${this.renderSongSecondaryMeta()}
          ${this.renderAdhocEditBar()}
          ${this.renderStanzaNavigation()}
        </header>
        <div class="song-body scroll-region">
          <div class="song-content ${this.isProjectionActive() ? "projecting" : ""}">
            ${this.renderSongContent()}
          </div>
        </div>
      </section>
    `;
  }

  private renderStanzaNavigation() {
    if (!this.projecting || !this.projection?.slides.length) return nothing;
    const markers = buildStanzaMarkers(this.projection.slides);
    const active = this.projection.blank ? -1 : activeStanzaIndex(markers, this.projection.current_index);
    return html`
      <nav class="stanza-navigation" aria-label="Jump to stanza">
        <span class="stanza-navigation-title">Now showing: ${this.activeProjectionTitle ?? "—"}</span>
        ${markers.map((marker, index) => html`
          <button
            type="button"
            class="${active === index ? "primary" : "secondary"} compact"
            aria-label="Stanza ${index + 1}"
            aria-pressed=${active === index ? "true" : "false"}
            title="Stanza ${index + 1}: ${marker.fullText.split("\n")[0]}"
            @click=${() => this.jumpToStanza(marker.slideIndices[0])}
          >${index + 1}</button>
        `)}
      </nav>
    `;
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

  private renderSettingsContent(): TemplateResult {
    const folderLabel = this.libraryStatus?.songs_folder ?? "No folder selected";
    return html`
      <div class="settings-section">
        <h3>Library</h3>
        <p class="settings-path">${folderLabel}</p>
        <div class="settings-actions">
          <button class="secondary" @click=${() => this.pickFolder()}>Choose Songs Folder</button>
          <button class="secondary" @click=${() => this.runImportMdb()}>Import MDB</button>
          <button class="ghost" @click=${() => this.rescan()}>Rescan library</button>
          <button class="ghost" @click=${() => this.openDuplicateReview()}>
            Review possible duplicates
          </button>
        </div>
        <label class="settings-check">
          <input
            type="checkbox"
            .checked=${this.showSongNumbers}
            @change=${(e: Event) =>
              this.onShowSongNumbersChange((e.target as HTMLInputElement).checked)}
          />
          <span>Show song numbers in the song list</span>
        </label>
      </div>
      <div class="settings-section">
        <h3>Projection</h3>
        <div class="settings-row">
          <span class="settings-row-label">Congregation</span>
          <psa150-select
            .options=${this.audienceDisplayOptions()}
            .value=${this.audienceMonitor}
            @psa150-change=${(e: CustomEvent<string>) => this.onAudienceMonitorChange(e.detail)}
          ></psa150-select>
        </div>
        <div class="settings-row">
          <span class="settings-row-label">Stage</span>
          <psa150-select
            .options=${this.stageDisplayOptions()}
            .value=${this.stageMonitor}
            @psa150-change=${(e: CustomEvent<string>) => this.onStageMonitorChange(e.detail)}
          ></psa150-select>
        </div>
        <label class="settings-check">
          <input
            type="checkbox"
            .checked=${this.projectToStage}
            @change=${(e: Event) => this.onProjectToStageChange((e.target as HTMLInputElement).checked)}
          />
          <span>Also show stage window when projecting (musician chords)</span>
        </label>
        <label class="settings-check">
          <input
            type="checkbox"
            .checked=${this.readOnly}
            @change=${(e: Event) => this.onReadOnlyChange((e.target as HTMLInputElement).checked)}
          />
          <span>Read-only library (prevent edits and deletes)</span>
        </label>
      </div>
      <div class="settings-section">
        <h3>Search</h3>
        <label class="settings-check">
          <input
            type="checkbox"
            .checked=${this.webSearchEnabled}
            @change=${(e: Event) =>
              this.onWebSearchEnabledChange((e.target as HTMLInputElement).checked)}
          />
          <span>Search the web when no local songs match</span>
        </label>
      </div>
      <div class="settings-section">
        <h3>Phone remote</h3>
        <label class="settings-check">
          <input
            type="checkbox"
            .checked=${Boolean(this.remoteStatus?.running)}
            @change=${(e: Event) =>
              this.onRemoteEnabledChange((e.target as HTMLInputElement).checked)}
          />
          <span>Let a phone on the network (Wi-Fi or Tailscale) change slides</span>
        </label>
        ${this.remoteStatus?.running
          ? html`<p class="settings-path">
              On the phone, open http://&lt;this PC&gt;:${this.remoteStatus.port}/ · PIN ${this.remoteStatus.pin}
            </p>`
          : nothing}
      </div>
      <div class="settings-section">
        <h3>Reports</h3>
        <div class="settings-actions">
          <button class="secondary" @click=${() => this.printSongbook()}>Print songbook HTML</button>
          <button class="secondary" @click=${() => this.exportCcli()}>Export CCLI CSV</button>
        </div>
      </div>
      <div class="shortcuts">
        <span><kbd>Enter</kbd> project</span>
        <span><kbd>↑</kbd> <kbd>↓</kbd> stanzas</span>
        <span><kbd>1</kbd>–<kbd>9</kbd> jump to stanza; type <kbd>10</kbd>, <kbd>11</kbd>… quickly</span>
        <span><kbd>←</kbd> <kbd>→</kbd> slides</span>
        <span><kbd>B</kbd> blank</span>
        <span><kbd>Esc</kbd> close projection</span>
      </div>
    `;
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

function delay(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

customElements.define("psa150-app", Psa150App);

declare global {
  interface HTMLElementTagNameMap {
    "psa150-app": Psa150App;
  }
}
