import { html, nothing } from "lit";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { closeProjectionWindows } from "../projection-client";
import { PraiseElement } from "./base";

export interface StageSlide {
  section_label: string;
  next_section_label?: string | null;
  lines: { text: string; chords: string[] }[];
  key?: string | null;
}

/** Musician-facing stage window: lyrics with chords above each line. */
export class PraiseStage extends PraiseElement {
  static properties = {
    slide: { state: true },
  };

  declare slide: StageSlide | null;

  constructor() {
    super();
    this.slide = null;
  }

  connectedCallback() {
    super.connectedCallback();
    listen<StageSlide>("stage-slide", (event) => (this.slide = event.payload)).catch(console.error);
    getCurrentWebviewWindow()
      .listen<StageSlide>("stage-slide", (event) => (this.slide = event.payload))
      .catch(console.error);
    window.addEventListener("praise-stage-slide", this.onCustomSlide);
    window.addEventListener("keydown", this.onKeydown);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    window.removeEventListener("praise-stage-slide", this.onCustomSlide);
    window.removeEventListener("keydown", this.onKeydown);
  }

  private onCustomSlide = (event: Event) => {
    this.slide = (event as CustomEvent<StageSlide>).detail;
  };

  private onKeydown = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      closeProjectionWindows().catch(console.error);
    }
  };

  render() {
    const slide = this.slide;
    if (!slide || slide.lines.length === 0) {
      return html`<div class="stage-screen stage-blank"></div>`;
    }
    return html`
      <div class="stage-screen">
        <div class="stage-meta">
          <span class="stage-section">${slide.section_label}</span>
          ${slide.next_section_label
            ? html`<span class="stage-next">Next · ${slide.next_section_label}</span>`
            : nothing}
          <span class="stage-key">Key · ${slide.key ?? "—"}</span>
        </div>
        ${slide.lines.map(
          (line) => html`
            <div class="stage-line">
              <div class="chords">${line.chords.join("  ") || " "}</div>
              <div class="lyrics">${line.text}</div>
            </div>
          `,
        )}
      </div>
    `;
  }
}

customElements.define("praise-stage", PraiseStage);

declare global {
  interface HTMLElementTagNameMap {
    "praise-stage": PraiseStage;
  }
}
