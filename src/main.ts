import { listen, UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { confirm } from "@tauri-apps/plugin-dialog";
import { api, ImportProgress, ImportReport, LibraryStatus, ProjectionState, Setlist, SongDetail, SongRow } from "./api";
import "./styles.css";

const state = {
  songs: [] as SongRow[],
  currentSong: null as SongDetail | null,
  currentFilename: null as string | null,
  projection: null as ProjectionState | null,
  libraryStatus: null as LibraryStatus | null,
  activeTab: "search" as "search" | "key" | "history" | "favorites" | "setlist",
  currentSetlist: null as Setlist | null,
};

const el = {
  app: document.getElementById("app")!,
  folderStatus: null as HTMLElement | null,
  libraryBadge: null as HTMLElement | null,
  songList: null as HTMLUListElement | null,
  preview: null as HTMLElement | null,
  nextPreview: null as HTMLElement | null,
  searchInput: null as HTMLInputElement | null,
  editor: null as HTMLTextAreaElement | null,
};

const importModal = {
  root: null as HTMLElement | null,
  fill: null as HTMLElement | null,
  count: null as HTMLElement | null,
  song: null as HTMLElement | null,
  unlistenProgress: null as UnlistenFn | null,
  active: false,
};

function renderShell() {
  el.app.innerHTML = `
    <header class="app-header">
      <div class="brand">
        <div class="brand-mark">V</div>
        <div class="brand-copy">
          <strong>Visual Song Book</strong>
          <span>Operator Console</span>
        </div>
      </div>
      <div class="header-actions">
        <button id="pick-folder" class="secondary">Open Songs Folder</button>
        <button id="import-mdb" class="secondary">Import MDB</button>
        <button id="rescan" class="ghost">Rescan</button>
      </div>
      <div class="header-status">
        <span id="folder-status" class="status-pill">No songs folder selected</span>
        <span id="library-badge" class="badge hidden">Library changed</span>
      </div>
    </header>
    <main class="app-main">
      <section class="panel library-panel">
        <div class="panel-header">
          <h2>Library</h2>
          <p>Search, browse keys, history, and favorites</p>
        </div>
        <div class="panel-body">
          <div class="tabs">
            <button data-tab="search" class="active">Search</button>
            <button data-tab="key">Key</button>
            <button data-tab="history">History</button>
            <button data-tab="favorites">Favorites</button>
            <button data-tab="setlist">Setlist</button>
          </div>
          <div id="tab-search">
            <form class="search-wrap" autocomplete="off" onsubmit="return false">
              <span class="search-icon">⌕</span>
              <input
                id="search-input"
                type="text"
                name="vsb-library-query"
                placeholder="Search title, tags, number…"
                autocomplete="off"
                autocorrect="off"
                autocapitalize="off"
                spellcheck="false"
              />
            </form>
          </div>
          <div id="tab-key" class="hidden">
            <select id="key-select"><option value="">Select key</option></select>
          </div>
          <ul id="song-list" class="song-list"></ul>
        </div>
      </section>

      <section class="panel live-panel">
        <div class="panel-header">
          <h2>Live</h2>
          <p>Project to audience and stage · arrow keys to advance</p>
        </div>
        <div class="panel-body">
          <div class="live-toolbar">
            <button id="project" class="live">▶ Project song</button>
            <button id="audience" class="secondary">Audience</button>
            <button id="stage" class="secondary">Stage</button>
            <button id="prev-slide" class="secondary">Prev</button>
            <button id="next-slide" class="secondary">Next</button>
            <button id="blank" class="secondary">Blank</button>
            <button id="transpose-up" class="ghost">Transpose +</button>
            <button id="transpose-down" class="ghost">Transpose −</button>
          </div>
          <h2 id="song-title" class="song-title">Select a song</h2>
          <div class="preview-card">
            <h3>Current slide</h3>
            <div id="preview" class="preview">Choose a song from the library to preview lyrics here.</div>
          </div>
          <div class="next-card">
            <h3>Next slide</h3>
            <div id="next-preview" class="preview">Upcoming slide preview appears here.</div>
          </div>
          <div class="quick-card">
            <h3>Quick paste</h3>
            <textarea id="quick-text" rows="5" placeholder="Paste ChordPro or plain lyrics for spontaneous songs…"></textarea>
            <div class="control-group" style="margin-top: 8px">
              <button id="quick-project" class="primary">Project now</button>
              <button id="quick-save" class="secondary">Project & save</button>
            </div>
          </div>
          <div class="shortcuts">
            <span><kbd>Enter</kbd> project song</span>
            <span><kbd>↑</kbd> <kbd>↓</kbd> slides</span>
            <span><kbd>B</kbd> blank</span>
            <span><kbd>Esc</kbd> close projection</span>
          </div>
        </div>
      </section>

      <section class="panel editor-panel">
        <div class="panel-header">
          <h2>Editor & tools</h2>
          <p>ChordPro source, export, and service setlists</p>
        </div>
        <div class="panel-body" style="display:flex;flex-direction:column;gap:12px">
          <textarea id="editor" class="editor" placeholder="Song ChordPro content…"></textarea>
          <div class="control-group">
            <label>Library</label>
            <button id="save-song" class="primary">Save</button>
            <button id="delete-song" class="secondary">Delete</button>
            <button id="toggle-readonly" class="ghost">Read-only</button>
          </div>
          <div class="control-group">
            <label>Reports</label>
            <button id="print-book" class="secondary">Print HTML</button>
            <button id="export-ccli" class="secondary">Export CCLI CSV</button>
          </div>
          <div id="setlist-panel" class="hidden">
            <div class="control-group">
              <label>Setlist</label>
            </div>
            <div class="setlist-fields">
              <input id="setlist-name" placeholder="Service name" />
              <input id="setlist-date" type="date" />
            </div>
            <div class="control-group">
              <button id="create-setlist" class="primary">Create setlist</button>
              <button id="advance-setlist" class="secondary">Advance setlist</button>
            </div>
          </div>
          <div id="messages" class="messages">Ready.</div>
        </div>
      </section>
    </main>
  `;

  el.folderStatus = document.getElementById("folder-status");
  el.libraryBadge = document.getElementById("library-badge");
  el.songList = document.getElementById("song-list") as HTMLUListElement;
  el.preview = document.getElementById("preview");
  el.nextPreview = document.getElementById("next-preview");
  el.searchInput = document.getElementById("search-input") as HTMLInputElement;
  el.editor = document.getElementById("editor") as HTMLTextAreaElement;

  bindEvents();
  focusSearchField();
}

function focusSearchField() {
  requestAnimationFrame(() => {
    el.searchInput?.focus({ preventScroll: true });
  });
}

async function loadKeyOptions() {
  const select = document.getElementById("key-select") as HTMLSelectElement;
  if (select.options.length > 1) return;
  try {
    const keys = await api.listKeys();
    keys.forEach((key) => {
      const opt = document.createElement("option");
      opt.value = key;
      opt.textContent = key;
      select.appendChild(opt);
    });
  } catch {
    // Library not open yet.
  }
}

function bindEvents() {
  document.getElementById("pick-folder")!.onclick = async () => {
    state.libraryStatus = await api.pickSongsFolder();
    updateLibraryStatus();
    await refreshSongs();
  };
  document.getElementById("import-mdb")!.onclick = () => void runImportMdb();
  document.getElementById("rescan")!.onclick = async () => {
    state.libraryStatus = await api.rescanSongs();
    updateLibraryStatus();
    await refreshSongs();
  };
  el.searchInput!.oninput = () => refreshSongs();
  el.searchInput!.addEventListener("keydown", async (event) => {
    if (event.key === "ArrowDown") {
      const first = state.songs[0];
      if (!first) return;
      event.preventDefault();
      await selectSong(first.filename);
      (el.songList!.querySelector("li") as HTMLElement | null)?.focus();
      return;
    }
    if (event.key === "Enter" && state.currentSong) {
      event.preventDefault();
      await projectLoadedSong();
    }
  });
  document.querySelectorAll(".tabs button").forEach((btn) => {
    btn.addEventListener("click", async () => {
      document.querySelectorAll(".tabs button").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      state.activeTab = (btn as HTMLElement).dataset.tab as typeof state.activeTab;
      document.getElementById("tab-search")!.classList.toggle("hidden", state.activeTab !== "search");
      document.getElementById("tab-key")!.classList.toggle("hidden", state.activeTab !== "key");
      document.getElementById("setlist-panel")!.classList.toggle("hidden", state.activeTab !== "setlist");
      if (state.activeTab === "key") {
        await loadKeyOptions();
      }
      await refreshSongs();
    });
  });
  document.getElementById("project")!.onclick = () => projectCurrent();
  document.getElementById("audience")!.onclick = () => api.openAudienceWindow();
  document.getElementById("stage")!.onclick = () => api.openStageWindow();
  document.getElementById("next-slide")!.onclick = async () => {
    await advanceSlide("next");
  };
  document.getElementById("prev-slide")!.onclick = async () => {
    await advanceSlide("prev");
  };
  document.getElementById("blank")!.onclick = async () => {
    state.projection = await api.blankScreen();
  };
  document.getElementById("transpose-up")!.onclick = async () => {
    state.projection = await api.setTranspose((state.projection?.transpose_semitones ?? 0) + 1);
    await updatePreview();
  };
  document.getElementById("transpose-down")!.onclick = async () => {
    state.projection = await api.setTranspose((state.projection?.transpose_semitones ?? 0) - 1);
    await updatePreview();
  };
  document.getElementById("quick-project")!.onclick = async () => {
    const text = (document.getElementById("quick-text") as HTMLTextAreaElement).value;
    state.currentSong = await api.quickProject(text, false);
    await projectLoadedSong();
  };
  document.getElementById("quick-save")!.onclick = async () => {
    const text = (document.getElementById("quick-text") as HTMLTextAreaElement).value;
    state.currentSong = await api.quickProject(text, true);
    await projectLoadedSong();
    await refreshSongs();
  };
  document.getElementById("save-song")!.onclick = async () => {
    if (!state.currentSong?.projection.filename) return;
    state.currentSong = await api.saveSong(
      state.currentSong.projection.filename,
      el.editor!.value,
    );
    logMessage("Song saved");
    await refreshSongs();
  };
  document.getElementById("delete-song")!.onclick = async () => {
    if (!state.currentSong?.projection.filename) return;
    await api.deleteSong(state.currentSong.projection.filename);
    state.currentSong = null;
    await refreshSongs();
  };
  document.getElementById("toggle-readonly")!.onclick = async () => {
    const config = await api.getConfig();
    await api.setReadOnly(!(config.read_only as boolean));
    logMessage("Read-only toggled");
  };
  document.getElementById("print-book")!.onclick = async () => {
    const html = await api.printSongbookHtml("Songbook", true);
    const win = window.open("", "_blank");
    win?.document.write(html);
    win?.document.close();
  };
  document.getElementById("export-ccli")!.onclick = async () => {
    const csv = await api.exportCcliReport("2000-01-01T00:00:00Z", "2100-01-01T00:00:00Z");
    logMessage(csv);
  };
  document.getElementById("create-setlist")!.onclick = async () => {
    const name = (document.getElementById("setlist-name") as HTMLInputElement).value || "Service";
    const date = (document.getElementById("setlist-date") as HTMLInputElement).value || new Date().toISOString().slice(0, 10);
    state.currentSetlist = await api.createSetlist(name, date);
    logMessage(`Setlist created: ${state.currentSetlist.name}`);
  };
  document.getElementById("advance-setlist")!.onclick = async () => {
    const item = await api.setlistAdvance();
    if (item?.type === "song" && item.file) {
      state.currentSong = await api.loadSong(item.file);
      await projectLoadedSong();
    }
  };
}

async function refreshLibraryStatus() {
  state.libraryStatus = await api.getLibraryStatus();
  updateLibraryStatus();
}

function updateLibraryStatus() {
  const status = state.libraryStatus;
  if (!status?.songs_folder) {
    el.folderStatus!.textContent = "No songs folder selected";
    return;
  }
  el.folderStatus!.textContent = `${status.song_count} songs · ${status.songs_folder}`;
  el.libraryBadge!.classList.toggle("hidden", !status.library_dirty);
}

async function refreshSongs() {
  if (state.activeTab === "search") {
    state.songs = await api.searchSongs(el.searchInput!.value, false);
  } else if (state.activeTab === "favorites") {
    state.songs = await api.searchSongs("", true);
  } else if (state.activeTab === "history") {
    const history = await api.getHistory(50);
    state.songs = history.map(([filename, title], index) => ({
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
  } else if (state.activeTab === "key") {
    const key = (document.getElementById("key-select") as HTMLSelectElement).value;
    state.songs = key ? await api.listByKey(key) : [];
  } else {
    state.songs = await api.searchSongs("", false);
  }
  renderSongList();
}

function renderSongList() {
  el.songList!.innerHTML = state.songs
    .map(
      (song) => `
        <li data-file="${song.filename}" class="${state.currentFilename === song.filename ? "active" : ""}">
          <strong>${escapeHtml(song.title)}</strong>
          <span class="song-meta">${escapeHtml(song.key ?? "—")} · #${song.song_num ?? "—"}${song.favorite ? ' · <span class="star">★</span>' : ""}</span>
        </li>`,
    )
    .join("");
  el.songList!.querySelectorAll("li").forEach((li) => {
    li.tabIndex = 0;
    li.addEventListener("click", async () => {
      await selectSong((li as HTMLElement).dataset.file!);
    });
    li.addEventListener("keydown", async (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        event.stopPropagation();
        const file = (li as HTMLElement).dataset.file!;
        if (state.currentFilename !== file) {
          await selectSong(file);
        }
        await projectLoadedSong();
      }
    });
  });
}

async function selectSong(file: string) {
  state.currentFilename = file;
  state.currentSong = await api.loadSong(file);
  renderCurrentSong();
  renderSongList();
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderCurrentSong() {
  if (!state.currentSong) return;
  document.getElementById("song-title")!.textContent = state.currentSong.parsed.meta.title as string;
  el.editor!.value = state.currentSong.parsed.raw;
  const projection = state.projection ?? state.currentSong.projection;
  const slide = projection.slides[projection.current_index];
  el.preview!.textContent =
    slide?.lines.map((l) => l.text).join("\n") ?? state.currentSong.parsed.raw.slice(0, 600);
}

async function projectCurrent() {
  if (!state.currentSong) return;
  await projectLoadedSong();
}

async function projectLoadedSong() {
  if (!state.currentSong) return;
  state.projection = state.currentSong.projection;
  await api.openAudienceWindow();
  if (state.projection.slides.length > 0) {
    state.projection = await api.showSlide(0);
  }
  await api.logProjection();
  await updatePreview();
  renderCurrentSong();
  await getCurrentWebviewWindow().setFocus();
}

function isTextEntryTarget(target: EventTarget | null): target is HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement
  );
}

function isProjectionActive() {
  return Boolean(state.projection && state.projection.slides.length > 0 && !state.projection.blank);
}

async function advanceSlide(direction: "next" | "prev") {
  if (!isProjectionActive()) return;
  state.projection =
    direction === "next" ? await api.nextSlide() : await api.previousSlide();
  await updatePreview();
  renderCurrentSong();
}

async function updatePreview() {
  if (state.projection && state.projection.slides.length > 0) {
    const slide = state.projection.slides[state.projection.current_index];
    if (slide) {
      el.preview!.textContent = slide.lines.map((l) => l.text).join("\n");
    }
  }
  const next = await api.getNextSlidePreview();
  if (!next) {
    el.nextPreview!.textContent = "End of song";
    return;
  }
  el.nextPreview!.textContent = next.lines.map((l) => l.text).join("\n");
}

function logMessage(msg: string, tone: "info" | "success" | "error" = "info") {
  const target = document.getElementById("messages");
  if (!target) return;
  target.textContent = msg;
  target.classList.remove("success", "error");
  if (tone === "success") target.classList.add("success");
  if (tone === "error") target.classList.add("error");
}

async function ensureSongsFolder(): Promise<boolean> {
  if (state.libraryStatus?.songs_folder) {
    return true;
  }

  const proceed = await confirm(
    "Choose a folder where ChordPro (.pro) song files will be stored before importing.",
    {
      title: "Select songs folder",
      kind: "info",
      okLabel: "Choose folder",
      cancelLabel: "Cancel",
    },
  );
  if (!proceed) {
    return false;
  }

  state.libraryStatus = await api.pickSongsFolder();
  updateLibraryStatus();
  if (!state.libraryStatus?.songs_folder) {
    logMessage("Import cancelled — no songs folder selected.", "error");
    return false;
  }
  await refreshSongs();
  return true;
}

function showImportModal() {
  if (!importModal.root) {
    const backdrop = document.createElement("div");
    backdrop.id = "import-modal";
    backdrop.className = "modal-backdrop hidden";
    backdrop.innerHTML = `
      <div class="modal-card" role="dialog" aria-modal="true" aria-labelledby="import-modal-title">
        <h2 id="import-modal-title">Importing songbook</h2>
        <p>Converting songs from the MDB file into ChordPro files.</p>
        <div class="progress-track" aria-hidden="true">
          <div id="import-progress-fill" class="progress-fill" style="width: 0%"></div>
        </div>
        <div class="progress-meta">
          <span id="import-progress-count">0 / 0 songs</span>
          <span id="import-progress-percent">0%</span>
        </div>
        <div id="import-progress-song" class="progress-song">Preparing…</div>
        <div class="modal-actions">
          <button id="import-cancel" class="secondary" type="button">Cancel</button>
        </div>
      </div>
    `;
    document.body.appendChild(backdrop);
    importModal.root = backdrop;
    importModal.fill = backdrop.querySelector("#import-progress-fill");
    importModal.count = backdrop.querySelector("#import-progress-count");
    importModal.song = backdrop.querySelector("#import-progress-song");
    backdrop.querySelector("#import-cancel")!.addEventListener("click", () => {
      void api.cancelImport();
      importModal.song!.textContent = "Cancelling…";
    });
  }

  importModal.active = true;
  updateImportProgress({ current: 0, total: 0, song_title: "Preparing…" });
  importModal.root!.classList.remove("hidden");
}

function updateImportProgress(progress: ImportProgress) {
  if (!importModal.fill || !importModal.count || !importModal.song) return;
  const total = Math.max(progress.total, 1);
  const pct = progress.total > 0 ? Math.round((progress.current / total) * 100) : 0;
  importModal.fill.style.width = `${pct}%`;
  importModal.count.textContent =
    progress.total > 0
      ? `${progress.current} / ${progress.total} songs`
      : "Reading songbook…";
  const percent = document.getElementById("import-progress-percent");
  if (percent) {
    percent.textContent = progress.total > 0 ? `${pct}%` : "…";
  }
  importModal.song.textContent = progress.song_title || "Preparing…";
}

async function hideImportModal() {
  importModal.active = false;
  if (importModal.unlistenProgress) {
    await importModal.unlistenProgress();
    importModal.unlistenProgress = null;
  }
  importModal.root?.classList.add("hidden");
}

function formatImportReport(report: ImportReport): string {
  const warningNote = report.warnings.length > 0 ? ` (${report.warnings.length} warnings)` : "";
  if (report.cancelled) {
    return `Import cancelled after ${report.written} songs (${report.skipped} skipped)${warningNote}.`;
  }
  return `Imported ${report.written} songs (${report.skipped} skipped)${warningNote}.`;
}

async function runImportMdb() {
  if (importModal.active) {
    return;
  }

  try {
    if (!(await ensureSongsFolder())) {
      return;
    }

    importModal.unlistenProgress = await listen<ImportProgress>("import-progress", (event) => {
      updateImportProgress(event.payload);
    });
    showImportModal();

    const report = await api.importMdb();
    await hideImportModal();

    logMessage(formatImportReport(report), report.cancelled ? "info" : "success");
    await refreshLibraryStatus();
    await refreshSongs();
  } catch (err) {
    await hideImportModal();
    const message = err instanceof Error ? err.message : String(err);
    if (message !== "Import cancelled") {
      logMessage(message, "error");
    }
  }
}

async function bootstrapLibrary() {
  const config = await api.getConfig();
  if (!config.first_run_complete) {
    logMessage("Welcome! Select your songs folder, then import an MDB or start projecting.");
  }
  await refreshLibraryStatus();
  try {
    await refreshSongs();
  } catch {
    // Library may still be loading from the last session folder.
  }
  if (!state.libraryStatus?.songs_folder) {
    logMessage("Welcome! Select your songs folder to begin.");
  }
}

function registerGlobalShortcuts() {
  window.addEventListener("keydown", async (event) => {
    const target = event.target;

    if (event.key === "Enter" && state.currentSong) {
      if (isTextEntryTarget(target) && target !== el.searchInput) {
        return;
      }
      event.preventDefault();
      await projectLoadedSong();
      return;
    }

    if (isTextEntryTarget(target)) {
      return;
    }

    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      if (!isProjectionActive()) return;
      event.preventDefault();
      await advanceSlide("next");
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      if (!isProjectionActive()) return;
      event.preventDefault();
      await advanceSlide("prev");
    } else if (event.key.toLowerCase() === "b") {
      state.projection = await api.blankScreen();
    } else if (event.key === "Escape") {
      await api.closeProjectionWindows();
    }
  });
}

async function init() {
  renderShell();
  void getCurrentWebviewWindow().setFocus();
  registerGlobalShortcuts();
  (document.getElementById("key-select") as HTMLSelectElement).onchange = () => refreshSongs();
  listen("library-changed", async () => {
    await refreshLibraryStatus();
    el.libraryBadge!.classList.remove("hidden");
    await refreshSongs();
  }).catch(console.error);
  void bootstrapLibrary();
}

init().catch(console.error);
