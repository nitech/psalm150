import { html, nothing } from "lit";
import {
  closeProjectionWindows,
  getProjectionSnapshot,
  listenProjectionUpdated,
} from "../projection-client";
import type { ProjectionSnapshot, StageSlide } from "../api";
import { Psa150Element } from "./base";

/** Musician-facing stage window: lyrics with chords above each line. */
export class Psa150Stage extends Psa150Element {
  static properties = {
    slide: { state: true },
  };

  declare slide: StageSlide | null;
  private revision = -1;
  private unlistenProjection?: () => void;

  constructor() {
    super();
    this.slide = null;
  }

  connectedCallback() {
    super.connectedCallback();
    window.addEventListener("keydown", this.onKeydown);
    void this.startProjectionSync();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    window.removeEventListener("keydown", this.onKeydown);
    this.unlistenProjection?.();
  }

  private async startProjectionSync() {
    try {
      this.unlistenProjection = await listenProjectionUpdated((snapshot) =>
        this.applySnapshot(snapshot),
      );
      this.applySnapshot(await getProjectionSnapshot());
    } catch (error) {
      console.error(error);
    }
  }

  private applySnapshot(snapshot: ProjectionSnapshot) {
    if (snapshot.revision <= this.revision) return;
    this.revision = snapshot.revision;
    this.slide = snapshot.stage;
  }

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

customElements.define("psa150-stage", Psa150Stage);

declare global {
  interface HTMLElementTagNameMap {
    "psa150-stage": Psa150Stage;
  }
}
