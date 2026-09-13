import { html, nothing } from "lit";
import { Psa150Element } from "./base";
import type { SongRow, WebSearchCandidate } from "../api";
import type { SongSort, SongSortColumn } from "../song-sort";
import { webResultId } from "./song-list-ids";

export { WEB_RESULT_PREFIX, isWebResultId, webResultId } from "./song-list-ids";

/**
 * Library song list. Presentational: it renders rows and emits `psa150-select`
 * (single click / focus) and `psa150-project` (Enter on a focused row) events.
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
  };

  declare songs: SongRow[];
  declare webResults: WebSearchCandidate[];
  declare webSearchLoading: boolean;
  declare currentFile: string | null;
  declare projecting: boolean;
  declare showNumbers: boolean;
  /** Active column sort; null hides the header (History and Setlist keep their own order). */
  declare sort: SongSort | null;

  private pendingFocus: string | null = null;

  constructor() {
    super();
    this.songs = [];
    this.webResults = [];
    this.webSearchLoading = false;
    this.currentFile = null;
    this.projecting = false;
    this.showNumbers = true;
    this.sort = null;
  }

  protected updated(changed: Map<PropertyKey, unknown>) {
    super.updated(changed);
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

  /** Sticky Song / No / Key header; each cell sorts its column (rules in song-sort.ts). */
  private renderHeader() {
    const sort = this.sort;
    if (!sort) return nothing;
    const cell = (column: SongSortColumn, label: string, align: "start" | "end" | "center") => {
      const active = sort.column === column;
      const ascending = sort.direction === "asc";
      return html`
        <button
          type="button"
          class="song-list-header-cell ${align} ${active ? "active" : ""}"
          title="Sort by ${label.toLowerCase()}"
          @click=${() => this.emitSort(column)}
        >
          <span>${label}</span>
          <span class="song-list-sort-arrow" aria-hidden="true">${active ? (ascending ? "↑" : "↓") : ""}</span>
        </button>
      `;
    };
    return html`
      <li class="song-list-header" role="presentation">
        ${cell("title", "Song", "start")}
        ${this.showNumbers ? cell("song_num", "No", "end") : nothing}
        ${cell("key", "Key", "center")}
        <span aria-hidden="true"></span>
      </li>
    `;
  }

  private renderSongRow(
    file: string,
    title: string,
    key: string | null,
    favorite = false,
    songNum: number | null = null,
    webResult = false,
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
        tabindex=${this.projecting ? "-1" : "0"}
        aria-selected=${active ? "true" : "false"}
        @click=${() => this.emit("psa150-select", file)}
        @keydown=${(event: KeyboardEvent) => this.onRowKeydown(event, file)}
      >
        <span class="song-list-title">${title}</span>
        ${this.showNumbers && !webResult
          ? html`<span class="song-list-num">${songNum ?? ""}</span>`
          : nothing}
        <span class="song-list-key">${key ?? ""}</span>
        ${webResult ? nothing : html`<span class="song-list-star">${favorite ? "★" : ""}</span>`}
      </li>
    `;
  }

  private renderWebResults() {
    if (this.webSearchLoading) {
      return html`
        <li class="web-results-header">
          <span class="web-results-label">Web results</span>
          <span class="web-results-loading">Searching…</span>
        </li>
      `;
    }
    if (this.webResults.length === 0) return nothing;

    return html`
      <li class="web-results-header">
        <span class="web-results-label">Web results</span>
      </li>
      ${this.webResults.map((result, index) =>
        this.renderSongRow(webResultId(index), result.title, result.source_name, false, null, true),
      )}
    `;
  }

  render() {
    const hasLocal = this.songs.length > 0;
    const hasWeb = this.webSearchLoading || this.webResults.length > 0;

    if (!hasLocal && !hasWeb) {
      return html`
        <li class="empty-list">
          <svg
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

    return html`
      ${hasLocal ? this.renderHeader() : nothing}
      ${hasLocal
        ? this.songs.map((song) =>
            this.renderSongRow(song.filename, song.title, song.key, song.favorite, song.song_num),
          )
        : nothing}
      ${this.renderWebResults()}
    `;
  }
}

customElements.define("psa150-song-list", Psa150SongList);

declare global {
  interface HTMLElementTagNameMap {
    "psa150-song-list": Psa150SongList;
  }
}
