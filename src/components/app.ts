import { html, nothing, type TemplateResult } from "lit";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { confirm } from "@tauri-apps/plugin-dialog";
import {
  api,
  type ImportProgress,
  type ImportReport,
  type LibraryStatus,
  type ProjectionState,
  type Setlist,
  type SongDetail,
  type SongRow,
} from "../api";
import { PraiseElement } from "./base";
import "./modal";
import "./song-list";

type Tab = "search" | "key" | "history" | "favorites" | "setlist";
type ToastTone = "info" | "success" | "error";

/**
 * Root component for the main window. Owns all application state and IPC
 * orchestration, and composes the presentational components (`praise-song-list`,
 * `praise-modal`).
 */
export class PraiseApp extends PraiseElement {
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
    keys: { state: true },
    query: { state: true },
    keySelected: { state: true },
    setlistName: { state: true },
    setlistDate: { state: true },
    editorValue: { state: true },
    nextPreviewText: { state: true },
    settingsOpen: { state: true },
    editOpen: { state: true },
    importOpen: { state: true },
    importCurrent: { state: true },
    importTotal: { state: true },
    importSong: { state: true },
    toastMsg: { state: true },
    toastTone: { state: true },
    toastVisible: { state: true },
    windowMaximized: { state: true },
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
  declare keys: string[];
  declare query: string;
  declare keySelected: string;
  declare setlistName: string;
  declare setlistDate: string;
  declare editorValue: string;
  declare nextPreviewText: string;
  declare settingsOpen: boolean;
  declare editOpen: boolean;
  declare importOpen: boolean;
  declare importCurrent: number;
  declare importTotal: number;
  declare importSong: string;
  declare toastMsg: string;
  declare toastTone: ToastTone;
  declare toastVisible: boolean;
  declare windowMaximized: boolean;

  private toastTimer: ReturnType<typeof setTimeout> | null = null;
  private unlistenImport: UnlistenFn | null = null;
  private unlistenLibrary: UnlistenFn | null = null;
  private unlistenWindowResize: UnlistenFn | null = null;
  private importBusy = false;
  private keysLoaded = false;
  private songsRefreshGeneration = 0;

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
    this.keys = [];
    this.query = "";
    this.keySelected = "";
    this.setlistName = "";
    this.setlistDate = "";
    this.editorValue = "";
    this.nextPreviewText = "—";
    this.settingsOpen = false;
    this.editOpen = false;
    this.importOpen = false;
    this.importCurrent = 0;
    this.importTotal = 0;
    this.importSong = "";
    this.toastMsg = "";
    this.toastTone = "info";
    this.toastVisible = false;
    this.windowMaximized = false;
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────

  connectedCallback() {
    super.connectedCallback();
    window.addEventListener("keydown", this.onGlobalKeydown);
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
        await this.refreshLibraryStatus();
        await this.refreshSongs();
      });
    } catch (err) {
      console.error(err);
    }
    await this.bootstrapLibrary();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    window.removeEventListener("keydown", this.onGlobalKeydown);
    this.unlistenLibrary?.();
    this.unlistenWindowResize?.();
    void this.unlistenImport?.();
  }

  firstUpdated() {
    this.focusSearchField();
  }

  // ── Derived helpers ────────────────────────────────────────────────────

  private get nowPreviewText(): string {
    const projection = this.projection ?? this.currentSong?.projection ?? null;
    if (projection && projection.slides.length > 0) {
      const slide = projection.slides[projection.current_index];
      if (slide) return slide.lines.map((l) => l.text).join("\n");
    }
    return "—";
  }

  private isProjectionActive(): boolean {
    return Boolean(
      this.projection && this.projection.slides.length > 0 && !this.projection.blank,
    );
  }

  private focusSearchField() {
    requestAnimationFrame(() => {
      this.querySelector<HTMLInputElement>("#search-input")?.focus({ preventScroll: true });
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
    } catch {
      // Library may not be open yet (no songs folder selected, or still loading).
      if (generation !== this.songsRefreshGeneration) return;
      this.songs = [];
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

  private async selectSong(file: string) {
    this.currentFilename = file;
    this.currentSong = await api.loadSong(file);
  }

  private async pickFolder() {
    try {
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

  private async projectLoadedSong() {
    if (!this.currentSong) return;
    this.projection = this.currentSong.projection;
    await api.openAudienceWindow();
    if (this.projectToStage) {
      await api.openStageWindow();
    }
    if (this.projection.slides.length > 0) {
      this.projection = await api.showSlide(0);
    }
    await api.logProjection();
    await this.updatePreview();
    await getCurrentWebviewWindow().setFocus();
  }

  private async advanceSlide(direction: "next" | "prev") {
    if (!this.isProjectionActive()) return;
    this.projection =
      direction === "next" ? await api.nextSlide() : await api.previousSlide();
    await this.updatePreview();
  }

  private async updatePreview() {
    const next = await api.getNextSlidePreview();
    this.nextPreviewText = next ? next.lines.map((l) => l.text).join("\n") : "End of song";
  }

  // ── Editing ────────────────────────────────────────────────────────────

  private openEdit() {
    if (!this.currentSong) return;
    this.editorValue = this.currentSong.parsed.raw;
    this.editOpen = true;
    requestAnimationFrame(() => this.querySelector<HTMLTextAreaElement>("#editor")?.focus());
  }

  private async saveSong() {
    if (!this.currentSong?.projection.filename) return;
    this.currentSong = await api.saveSong(
      this.currentSong.projection.filename,
      this.editorValue,
    );
    this.showToast("Song saved");
    await this.refreshSongs();
  }

  private async deleteSong() {
    if (!this.currentSong?.projection.filename) return;
    const ok = await confirm("Delete this song from the library?", {
      title: "Delete song",
      kind: "warning",
      okLabel: "Delete",
      cancelLabel: "Cancel",
    });
    if (!ok) return;
    await api.deleteSong(this.currentSong.projection.filename);
    this.currentSong = null;
    this.currentFilename = null;
    this.editOpen = false;
    await this.refreshSongs();
  }

  private async transpose(delta: number) {
    this.projection = await api.setTranspose((this.projection?.transpose_semitones ?? 0) + delta);
    await this.updatePreview();
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
      this.showToast(this.formatImportReport(report), report.cancelled ? "info" : "success");
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
    if (report.cancelled) {
      return `Import cancelled after ${report.written} songs (${report.skipped} skipped)${warningNote}.`;
    }
    return `Imported ${report.written} songs (${report.skipped} skipped)${warningNote}.`;
  }

  // ── Settings persistence ───────────────────────────────────────────────

  private async openSettings() {
    this.settingsOpen = true;
    try {
      const config = await api.getConfig();
      this.projectToStage = Boolean(config.project_to_stage);
      this.readOnly = Boolean(config.read_only);
    } catch {
      // Config not loaded yet.
    }
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
      this.currentSong = await api.loadSong(item.file);
      await this.projectLoadedSong();
    }
  }

  // ── Tabs ───────────────────────────────────────────────────────────────

  private async selectTab(tab: Tab) {
    this.activeTab = tab;
    if (tab === "key") await this.loadKeyOptions();
    await this.refreshSongs();
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
    this.projectToStage = Boolean(config.project_to_stage);
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

  private onGlobalKeydown = async (event: KeyboardEvent) => {
    const target = event.target;

    if (event.key === "Escape") {
      if (this.editOpen) {
        this.editOpen = false;
        return;
      }
      if (this.settingsOpen) {
        this.settingsOpen = false;
        return;
      }
      await api.closeProjectionWindows();
      return;
    }

    if (event.key === "Enter" && this.currentSong) {
      if (isTextEntryTarget(target) && !(target as HTMLElement).matches("#search-input")) {
        return;
      }
      event.preventDefault();
      await this.projectLoadedSong();
      return;
    }

    if (isTextEntryTarget(target)) return;

    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      if (!this.isProjectionActive()) return;
      event.preventDefault();
      await this.advanceSlide("next");
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      if (!this.isProjectionActive()) return;
      event.preventDefault();
      await this.advanceSlide("prev");
    } else if (event.key.toLowerCase() === "b") {
      this.projection = await api.blankScreen();
      await this.updatePreview();
    }
  };

  private async onSearchKeydown(event: KeyboardEvent) {
    if (event.key === "ArrowDown") {
      const first = this.songs[0];
      if (!first) return;
      event.preventDefault();
      await this.selectSong(first.filename);
      await this.updateComplete;
      this.querySelector<HTMLElement>("praise-song-list li")?.focus();
      return;
    }
    if (event.key === "Enter" && this.currentSong) {
      event.preventDefault();
      event.stopPropagation();
      await this.projectLoadedSong();
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────

  render() {
    return html`
      ${this.renderHeader()}
      <main class="workspace">
        ${this.renderBrowsePane()}
        ${this.renderSongPane()}
      </main>
      <praise-modal
        heading="Settings"
        variant="wide"
        ?open=${this.settingsOpen}
        .content=${this.renderSettingsContent()}
        @praise-close=${() => (this.settingsOpen = false)}
      ></praise-modal>
      <praise-modal
        heading=${(this.currentSong?.parsed.meta.title as string) || "Edit song"}
        variant="tall"
        ?open=${this.editOpen}
        .content=${this.renderEditContent()}
        @praise-close=${() => (this.editOpen = false)}
      ></praise-modal>
      <praise-modal
        heading="Importing songbook"
        ?open=${this.importOpen}
        .content=${this.renderImportContent()}
      ></praise-modal>
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
          <strong class="brand-name">Praise</strong>
        </div>
        <div class="live-bar app-no-drag">
          <button class="primary compact" @click=${() => this.projectLoadedSong()}>Project</button>
          <button class="secondary compact" @click=${() => this.advanceSlide("prev")}>Prev</button>
          <button class="secondary compact" @click=${() => this.advanceSlide("next")}>Next</button>
          <button
            class="secondary compact"
            @click=${async () => {
              this.projection = await api.blankScreen();
              await this.updatePreview();
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
      <aside class="browse-pane">
        <nav class="tabs" role="tablist">
          ${tabs.map(
            (tab) => html`
              <button
                class=${this.activeTab === tab ? "active" : ""}
                role="tab"
                @click=${() => this.selectTab(tab)}
              >
                ${tab.charAt(0).toUpperCase() + tab.slice(1)}
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
                    name="praise-library-query"
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
                <select
                  .value=${this.keySelected}
                  @change=${(e: Event) => {
                    this.keySelected = (e.target as HTMLSelectElement).value;
                    void this.refreshSongs();
                  }}
                >
                  <option value="">Select key</option>
                  ${this.keys.map((key) => html`<option value=${key}>${key}</option>`)}
                </select>
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
        <praise-song-list
          class="song-list scroll-region"
          role="listbox"
          .songs=${this.songs}
          .currentFile=${this.currentFilename}
          @praise-select=${(e: CustomEvent<string>) => this.selectSong(e.detail)}
          @praise-project=${async (e: CustomEvent<string>) => {
            if (this.currentFilename !== e.detail) await this.selectSong(e.detail);
            await this.projectLoadedSong();
          }}
        ></praise-song-list>
      </aside>
    `;
  }

  private renderSongPane() {
    return html`
      <section class="song-pane">
        <header class="song-pane-header">
          <h1 class="song-title">
            ${this.currentSong
              ? (this.currentSong.parsed.meta.title as string) || "Untitled"
              : "Select a song"}
          </h1>
          <div class="song-meta-bar">${this.renderSongMeta()}</div>
        </header>
        <div class="song-body scroll-region">
          <div class="song-content">${this.renderSongContent()}</div>
        </div>
        <footer class="live-preview">
          <div class="slide-preview">
            <span class="preview-label">Now</span>
            <div class="preview-text">${this.nowPreviewText}</div>
          </div>
          <div class="slide-preview next">
            <span class="preview-label">Next</span>
            <div class="preview-text">${this.nextPreviewText}</div>
          </div>
        </footer>
      </section>
    `;
  }

  private renderSongMeta() {
    if (!this.currentSong) return nothing;
    const meta = this.currentSong.parsed.meta;
    const parts: string[] = [];
    if (meta.key) parts.push(String(meta.key));
    if (meta.song_num) parts.push(`#${meta.song_num}`);
    if (meta.category) parts.push(String(meta.category));
    if (meta.ccli) parts.push(`CCLI ${meta.ccli}`);
    return parts.join(" · ");
  }

  private renderSongContent() {
    if (!this.currentSong) {
      return html`<p class="empty-state">
        Choose a song from the library to view the full lyrics here.
      </p>`;
    }
    return this.currentSong.parsed.raw.split("\n").map((line) => {
      if (line.startsWith("{")) {
        return html`<div class="chordpro-directive">${line}</div>`;
      }
      if (/^\[.+\]$/.test(line.trim())) {
        return html`<div class="chordpro-section">${line}</div>`;
      }
      return html`<div class="chordpro-line">${line}</div>`;
    });
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
        </div>
      </div>
      <div class="settings-section">
        <h3>Projection</h3>
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
        <h3>Reports</h3>
        <div class="settings-actions">
          <button class="secondary" @click=${() => this.printSongbook()}>Print songbook HTML</button>
          <button class="secondary" @click=${() => this.exportCcli()}>Export CCLI CSV</button>
        </div>
      </div>
      <div class="shortcuts">
        <span><kbd>Enter</kbd> project</span>
        <span><kbd>↑</kbd> <kbd>↓</kbd> slides</span>
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

customElements.define("praise-app", PraiseApp);

declare global {
  interface HTMLElementTagNameMap {
    "praise-app": PraiseApp;
  }
}
