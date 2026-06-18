import { html, nothing } from "lit";
import { VsbElement } from "./base";
import type { SongRow } from "../api";

/**
 * Library song list. Presentational: it renders rows and emits `vsb-select`
 * (single click / focus) and `vsb-project` (Enter on a focused row) events.
 */
export class VsbSongList extends VsbElement {
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

  private emit(name: "vsb-select" | "vsb-project", file: string) {
    this.dispatchEvent(new CustomEvent(name, { detail: file, bubbles: true, composed: true }));
  }

  private onRowKeydown(event: KeyboardEvent, file: string) {
    if (event.key !== "Enter") return;
    event.preventDefault();
    event.stopPropagation();
    if (this.currentFile !== file) this.emit("vsb-select", file);
    this.emit("vsb-project", file);
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
          @click=${() => this.emit("vsb-select", song.filename)}
          @keydown=${(event: KeyboardEvent) => this.onRowKeydown(event, song.filename)}
        >
          <span class="song-list-title">${song.title}</span>
          <span class="song-list-meta">
            ${song.key ? html`<span>${song.key}</span>` : nothing}
            ${song.song_num != null ? html`<span>• #${song.song_num}</span>` : nothing}
            ${song.favorite ? html`<span class="star">★</span>` : nothing}
          </span>
        </li>
      `;
    });
  }
}

customElements.define("vsb-song-list", VsbSongList);

declare global {
  interface HTMLElementTagNameMap {
    "vsb-song-list": VsbSongList;
  }
}
