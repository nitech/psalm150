import { html, nothing, type TemplateResult } from "lit";
import { mountChordEditor, type ChordEditor } from "../shared/songs/chord-editor.ts";
import { icon } from "../icons";
import { Psa150Element } from "./base";

/**
 * The song editor, the same as the song server's web client
 * (src/shared/songs/chord-editor.ts): Visual, Chords and ChordPro with its
 * preview. It takes the song pane's place and its layout: the mode switch,
 * the editor's bar (section, details, Save) and Cancel sit in the pane's
 * header row where the song's buttons are; the song scrolls below. Cancel
 * asks the console to close it (`psa150-close`); Save hands the text to the
 * console (`psa150-save`), which saves it and closes the editor, or sets
 * `error`.
 */
export class Psa150SongEditor extends Psa150Element {
  static properties = {
    heading: {},
    source: { attribute: false },
    note: { attribute: false },
    busy: { type: Boolean },
    error: {},
  };

  declare heading: string;
  /** The ChordPro the editor starts from; later changes are ignored. */
  declare source: string;
  /** A line above the song, such as where a song found online came from. */
  declare note: TemplateResult | null;
  declare busy: boolean;
  declare error: string;

  private editor: ChordEditor | null = null;
  /** The text as the editor wrote it out at the start (it tidies the file a little). */
  private startSource = "";

  constructor() {
    super();
    this.heading = "Edit song";
    this.source = "";
    this.note = null;
    this.busy = false;
    this.error = "";
  }

  /** The text as it is now. */
  currentSource(): string {
    return this.editor?.source() ?? this.source;
  }

  /** Whether anything was changed, to ask before leaving. */
  changed(): boolean {
    return Boolean(this.editor) && this.currentSource() !== this.startSource;
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.editor?.destroy();
    this.editor = null;
  }

  protected firstUpdated() {
    this.editor = mountChordEditor(this.querySelector<HTMLElement>(".song-editor-body")!, this.source, {
      modes: this.querySelector<HTMLElement>(".ce-modes")!,
      save: () => this.save(),
      dock: this.querySelector<HTMLElement>(".song-editor-dock")!,
    });
    this.startSource = this.editor.source();
    this.querySelector<HTMLElement>(".ce-title")?.focus({ preventScroll: true });
  }

  render() {
    return html`
      <header class="song-pane-header">
        <div class="song-pane-header-row song-editor-head">
          <h1 class="visually-hidden" id="song-title">${this.heading}</h1>
          <div class="segmented ce-modes" role="group" aria-label="Edit as"></div>
          <div class="toolbar-group song-actions song-editor-actions" role="group" aria-label="Editor">
            <div class="song-editor-dock"></div>
            <button
              type="button"
              class="song-action-btn"
              title="Cancel"
              aria-label="Cancel editing"
              @click=${() => this.close()}
            >${icon("close")}</button>
          </div>
        </div>
      </header>
      <div class="song-body scroll-region song-editor-scroll">
        <div class="song-editor-page">
          ${this.note ? html`<p class="song-editor-note">${this.note}</p>` : nothing}
          <form class="editor ${this.busy ? "busy" : ""}" @submit=${(event: Event) => { event.preventDefault(); this.save(); }}>
            <div class="song-editor-body"></div>
            <p class="form-message" role="alert">${this.error}</p>
          </form>
        </div>
      </div>
    `;
  }

  private save() {
    if (this.busy) return;
    this.dispatchEvent(new CustomEvent("psa150-save", { detail: { source: this.currentSource() } }));
  }

  private close() {
    this.dispatchEvent(new CustomEvent("psa150-close"));
  }
}

customElements.define("psa150-song-editor", Psa150SongEditor);
