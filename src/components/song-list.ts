import { html, nothing } from "lit";
import { PraiseElement } from "./base";
import type { SongRow } from "../api";

/**
 * Library song list. Presentational: it renders rows and emits `praise-select`
 * (single click / focus) and `praise-project` (Enter on a focused row) events.
 */
export class PraiseSongList extends PraiseElement {
  static properties = {
    songs: { attribute: false },
    currentFile: {},
  };

  declare songs: SongRow[];
  declare currentFile: string | null;

  constructor() {
    super();
    this.songs = [];
    this.currentFile = null;
  }

  private emit(name: "praise-select" | "praise-project", file: string) {
    this.dispatchEvent(new CustomEvent(name, { detail: file, bubbles: true, composed: true }));
  }

  private onRowKeydown(event: KeyboardEvent, file: string) {
    if (event.key !== "Enter") return;
    event.preventDefault();
    event.stopPropagation();
    if (this.currentFile !== file) this.emit("praise-select", file);
    this.emit("praise-project", file);
  }

  render() {
    if (this.songs.length === 0) {
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

    return this.songs.map((song) => {
      const active = this.currentFile === song.filename;
      return html`
        <li
          data-file=${song.filename}
          class=${active ? "active" : ""}
          role="option"
          tabindex="0"
          aria-selected=${active ? "true" : "false"}
          @click=${() => this.emit("praise-select", song.filename)}
          @keydown=${(event: KeyboardEvent) => this.onRowKeydown(event, song.filename)}
        >
          <span class="song-list-lead">
            ${song.song_num != null
              ? html`<span class="song-list-num">#${song.song_num}</span>`
              : html`<span class="song-list-num"></span>`}
            ${song.key
              ? html`<span class="song-list-key">${song.key}</span>`
              : html`<span class="song-list-key"></span>`}
          </span>
          <span class="song-list-title">${song.title}</span>
          ${song.favorite ? html`<span class="song-list-star">★</span>` : nothing}
        </li>
      `;
    });
  }
}

customElements.define("praise-song-list", PraiseSongList);

declare global {
  interface HTMLElementTagNameMap {
    "praise-song-list": PraiseSongList;
  }
}
