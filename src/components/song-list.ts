import { html, nothing } from "lit";
import { PraiseElement } from "./base";
import type { SongRow, WebSearchCandidate } from "../api";
import { webResultId } from "./song-list-ids";

export { WEB_RESULT_PREFIX, isWebResultId, webResultId } from "./song-list-ids";

/**
 * Library song list. Presentational: it renders rows and emits `praise-select`
 * (single click / focus) and `praise-project` (Enter on a focused row) events.
 */
export class PraiseSongList extends PraiseElement {
  static properties = {
    songs: { attribute: false },
    webResults: { attribute: false },
    webSearchLoading: { type: Boolean },
    currentFile: {},
    projecting: { type: Boolean },
  };

  declare songs: SongRow[];
  declare webResults: WebSearchCandidate[];
  declare webSearchLoading: boolean;
  declare currentFile: string | null;
  declare projecting: boolean;

  private pendingFocus: string | null = null;

  constructor() {
    super();
    this.songs = [];
    this.webResults = [];
    this.webSearchLoading = false;
    this.currentFile = null;
    this.projecting = false;
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

  private emit(name: "praise-select" | "praise-project", file: string) {
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
    this.emit("praise-select", file);
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
        this.dispatchEvent(new CustomEvent("praise-focus-search", { bubbles: true, composed: true }));
      }
      return;
    }

    if (event.key !== "Enter") return;
    event.preventDefault();
    event.stopPropagation();
    if (this.currentFile !== file) this.emit("praise-select", file);
    this.emit("praise-project", file);
  }

  private renderSongRow(file: string, title: string, key: string | null, favorite = false) {
    const active = this.currentFile === file;
    return html`
      <li
        data-file=${file}
        class=${active ? "active" : ""}
        role="option"
        tabindex=${this.projecting ? "-1" : "0"}
        aria-selected=${active ? "true" : "false"}
        @click=${() => this.emit("praise-select", file)}
        @keydown=${(event: KeyboardEvent) => this.onRowKeydown(event, file)}
      >
        <span class="song-list-title">${title}</span>
        <span class="song-list-num"></span>
        ${key ? html`<span class="song-list-key">${key}</span>` : html`<span class="song-list-key"></span>`}
        ${favorite ? html`<span class="song-list-star">★</span>` : nothing}
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
        this.renderSongRow(webResultId(index), result.title, result.source_name),
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
      ${hasLocal
        ? this.songs.map((song) =>
            this.renderSongRow(song.filename, song.title, song.key, song.favorite),
          )
        : nothing}
      ${this.renderWebResults()}
    `;
  }
}

customElements.define("praise-song-list", PraiseSongList);

declare global {
  interface HTMLElementTagNameMap {
    "praise-song-list": PraiseSongList;
  }
}
