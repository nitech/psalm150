import { html, nothing } from "lit";
import { Psa150Element } from "./base";
import type { SongRow, WebSearchCandidate } from "../api";
import type { SongSort, SongSortColumn } from "../song-sort";
import { webResultId } from "./song-list-ids";

export { WEB_RESULT_PREFIX, isWebResultId, webResultId } from "./song-list-ids";

/**
 * Library song list. Presentational: it renders rows and emits `psa150-select`
 * (single click / focus) and `psa150-project` (Enter on a focused row) events.
 *
 * The column header sits above the scrolling body, so the scrollbar starts
 * below it. The body is one grid with subgrid rows; after each layout the
 * header copies the body's resolved column widths (and leaves room for the
 * scrollbar), while the header labels set the body's minimum column widths.
 */
export class Psa150SongList extends Psa150Element {
  static properties = {
    songs: { attribute: false },
    webResults: { attribute: false },
    webSearchLoading: { type: Boolean },
    currentFile: {},
    projecting: { type: Boolean },
    showNumbers: { type: Boolean },
    sort: { attribute: false },
    label: {},
  };

  declare songs: SongRow[];
  declare webResults: WebSearchCandidate[];
  declare webSearchLoading: boolean;
  declare currentFile: string | null;
  declare projecting: boolean;
  declare showNumbers: boolean;
  /** Active column sort; null hides the header (History and Setlist keep their own order). */
  declare sort: SongSort | null;
  /** Accessible name of the list (the view it shows). */
  declare label: string;

  private pendingFocus: string | null = null;
  private resizeObserver: ResizeObserver | null = null;

  constructor() {
    super();
    this.songs = [];
    this.webResults = [];
    this.webSearchLoading = false;
    this.currentFile = null;
    this.projecting = false;
    this.showNumbers = true;
    this.sort = null;
    this.label = "Songs";
  }

  protected firstUpdated() {
    const body = this.body();
    if (!body) return;
    this.resizeObserver = new ResizeObserver(() => this.syncHeader());
    this.resizeObserver.observe(body);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
  }

  private body() {
    return this.querySelector<HTMLElement>(":scope > ul.song-list");
  }

  /** Align the fixed header with the body's columns. */
  private syncHeader() {
    const body = this.body();
    const head = this.querySelector<HTMLElement>(":scope > .song-list-head");
    if (!body || !head) return;
    const labelWidth = (cell: HTMLElement | null) => {
      if (!cell) return 0;
      const parts = [...cell.children] as HTMLElement[];
      const gap = parts.length > 1 ? 4 * (parts.length - 1) : 0;
      return Math.ceil(parts.reduce((sum, part) => sum + part.getBoundingClientRect().width, gap));
    };
    body.style.setProperty("--num-min", `${labelWidth(head.querySelector(".song-list-header-cell.num"))}px`);
    body.style.setProperty("--key-min", `${labelWidth(head.querySelector(".song-list-header-cell.key"))}px`);
    const tracks = getComputedStyle(body).gridTemplateColumns.split(" ");
    if (tracks.length < 2) return;
    tracks[0] = "minmax(0, 1fr)";
    head.style.gridTemplateColumns = tracks.join(" ");
    head.style.setProperty("--scrollbar-width", `${body.offsetWidth - body.clientWidth}px`);
  }

  protected updated(changed: Map<PropertyKey, unknown>) {
    super.updated(changed);
    this.syncHeader();
    if (!this.pendingFocus || this.currentFile !== this.pendingFocus) return;
    const file = this.pendingFocus;
    this.pendingFocus = null;
    const row = this.querySelector<HTMLElement>(`li[data-file="${CSS.escape(file)}"]`);
    row?.focus({ preventScroll: true });
    row?.scrollIntoView({ block: "nearest" });
  }

  private emit(name: "psa150-select" | "psa150-project", file: string) {
    this.dispatchEvent(new CustomEvent(name, { detail: file, bubbles: true, composed: true }));
  }

  private allSelectableFiles(): string[] {
    return [
      ...this.songs.map((song) => song.filename),
      ...this.webResults.map((_, index) => webResultId(index)),
    ];
  }

  private navigateTo(file: string) {
    this.pendingFocus = file;
    this.emit("psa150-select", file);
  }

  private onRowKeydown(event: KeyboardEvent, file: string) {
    if (this.projecting && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
      return;
    }

    const files = this.allSelectableFiles();
    const index = files.indexOf(file);

    if (event.key === "ArrowDown") {
      const next = files[index + 1];
      if (!next) return;
      event.preventDefault();
      event.stopPropagation();
      this.navigateTo(next);
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      event.stopPropagation();
      const prev = files[index - 1];
      if (prev) {
        this.navigateTo(prev);
      } else {
        this.dispatchEvent(new CustomEvent("psa150-focus-search", { bubbles: true, composed: true }));
      }
      return;
    }

    if (event.key !== "Enter") return;
    event.preventDefault();
    event.stopPropagation();
    if (this.currentFile !== file) this.emit("psa150-select", file);
    this.emit("psa150-project", file);
  }

  private emitSort(column: SongSortColumn) {
    this.dispatchEvent(
      new CustomEvent("psa150-sort", { detail: column, bubbles: true, composed: true }),
    );
  }

  /** Song / No / Key header above the scroll body; each cell sorts its column (rules in song-sort.ts). */
  private renderHeader() {
    const sort = this.sort;
    if (!sort) return nothing;
    const cell = (column: SongSortColumn, label: string, align: "start" | "end" | "center") => {
      const active = sort.column === column;
      const ascending = sort.direction === "asc";
      return html`
        <button
          type="button"
          class="song-list-header-cell ${column === "song_num" ? "num" : column} ${align} ${active ? "active" : ""}"
          title="Sort by ${label.toLowerCase()}"
          @click=${() => this.emitSort(column)}
        >
          <span>${label}</span>
          <span class="song-list-sort-arrow" aria-hidden="true">${active ? (ascending ? "↑" : "↓") : ""}</span>
          ${active
            ? html`<span class="visually-hidden">, sorted ${ascending ? "ascending" : "descending"}</span>`
            : nothing}
        </button>
      `;
    };
    return html`
      <div class="song-list-head">
        ${cell("title", "Song", "start")}
        ${this.showNumbers ? cell("song_num", "No", "end") : nothing}
        ${cell("key", "Key", "center")}
        <span aria-hidden="true"></span>
      </div>
    `;
  }

  private renderSongRow(
    file: string,
    title: string,
    key: string | null,
    favorite = false,
    songNum: number | null = null,
    webResult = false,
    tabStop = false,
  ) {
    const active = this.currentFile === file;
    const classes = [active ? "active" : "", webResult ? "web-result" : ""]
      .filter(Boolean)
      .join(" ");
    return html`
      <li
        data-file=${file}
        class=${classes}
        role="option"
        tabindex=${!this.projecting && tabStop ? "0" : "-1"}
        aria-selected=${active ? "true" : "false"}
        @click=${() => this.emit("psa150-select", file)}
        @keydown=${(event: KeyboardEvent) => this.onRowKeydown(event, file)}
      >
        <span class="song-list-title">${title}</span>
        ${this.showNumbers && !webResult
          ? html`<span class="song-list-num">${songNum ?? ""}</span>`
          : nothing}
        <span class="song-list-key">${key ?? ""}</span>
        ${webResult
          ? nothing
          : html`<span class="song-list-star"
              >${favorite
                ? html`<span aria-hidden="true">★</span><span class="visually-hidden">, favourite</span>`
                : ""}</span
            >`}
      </li>
    `;
  }

  private renderWebResults(tabStop: string | undefined) {
    if (this.webSearchLoading) {
      return html`
        <li class="web-results-header" role="presentation">
          <span class="web-results-label">Web results</span>
          <span class="web-results-loading">Searching…</span>
        </li>
      `;
    }
    if (this.webResults.length === 0) return nothing;

    return html`
      <li class="web-results-header" role="presentation">
        <span class="web-results-label">Web results</span>
      </li>
      ${this.webResults.map((result, index) => {
        const id = webResultId(index);
        return this.renderSongRow(id, result.title, result.source_name, false, null, true, id === tabStop);
      })}
    `;
  }

  private renderRows() {
    const hasLocal = this.songs.length > 0;
    const hasWeb = this.webSearchLoading || this.webResults.length > 0;
    if (!hasLocal && !hasWeb) {
      return html`
        <li class="empty-list" role="presentation">
          <svg
            aria-hidden="true"
            width="48"
            height="48"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.5"
            style="opacity: 0.4; margin-bottom: 12px;"
          >
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.3-4.3" />
          </svg>
          <div>No songs found</div>
        </li>
      `;
    }
    // One row is in the Tab order (roving tabindex): the selected song, else
    // the first; the arrow keys move between rows.
    const files = this.allSelectableFiles();
    const tabStop =
      this.currentFile && files.includes(this.currentFile) ? this.currentFile : files[0];
    return html`
      ${this.songs.map((song) =>
        this.renderSongRow(
          song.filename,
          song.title,
          song.key,
          song.favorite,
          song.song_num,
          false,
          song.filename === tabStop,
        ),
      )}
      ${this.renderWebResults(tabStop)}
    `;
  }

  /** Result count for screen readers (WCAG 4.1.3), announced without moving focus. */
  private statusText(): string {
    if (this.webSearchLoading) return "Searching the web…";
    const songs = this.songs.length;
    const web = this.webResults.length;
    if (songs === 0 && web === 0) return "No songs found";
    const parts: string[] = [];
    if (songs > 0) parts.push(`${songs} ${songs === 1 ? "song" : "songs"}`);
    if (web > 0) parts.push(`${web} web ${web === 1 ? "result" : "results"}`);
    return parts.join(", ");
  }

  render() {
    // With no rows the list is only a message, not an empty listbox.
    const hasRows = this.songs.length > 0 || this.webResults.length > 0;
    return html`
      ${this.songs.length > 0 ? this.renderHeader() : nothing}
      <ul
        class="song-list scroll-region ${this.showNumbers ? "" : "hide-numbers"}"
        role=${hasRows ? "listbox" : "none"}
        aria-label=${hasRows ? this.label : nothing}
      >
        ${this.renderRows()}
      </ul>
      <p class="visually-hidden" role="status">${this.statusText()}</p>
    `;
  }
}

customElements.define("psa150-song-list", Psa150SongList);

declare global {
  interface HTMLElementTagNameMap {
    "psa150-song-list": Psa150SongList;
  }
}
