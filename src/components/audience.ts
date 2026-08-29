import { html, nothing } from "lit";
import { keyed } from "lit/directives/keyed.js";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import {
  closeProjectionWindows,
  getProjectionState,
  getTheme,
  listenAudienceSlide,
} from "../projection-client";
import type { ProjectionState, SlidePayload, SlideTheme } from "../api";
import { activeStanzaIndex, buildStanzaMarkers } from "../stanza-markers";
import { planFit } from "../audience-fit";
import { PraiseElement } from "./base";

function slideSignature(slide: SlidePayload): string {
  return `${slide.index}:${slide.stanza_index ?? 0}:${slide.lines.map((line) => line.text).join("\n")}`;
}

function stripChords(slide: SlidePayload): SlidePayload {
  return { ...slide, lines: slide.lines.map((line) => ({ text: line.text, chords: [] })) };
}

/** Audience-facing projection window. */
export class PraiseAudience extends PraiseElement {
  static properties = {
    slide: { state: true },
    projection: { state: true },
    theme: { state: true },
  };

  declare slide: SlidePayload | null;
  declare projection: ProjectionState | null;
  declare theme: SlideTheme | null;

  constructor() {
    super();
    this.slide = null;
    this.projection = null;
    this.theme = null;
  }

  connectedCallback() {
    super.connectedCallback();
    listenAudienceSlide((slide) => this.onSlide(slide)).catch(console.error);
    getCurrentWebviewWindow()
      .listen<SlidePayload>("audience-slide", (event) => this.onSlide(event.payload))
      .catch(console.error);
    window.addEventListener("keydown", this.onKeydown);
    window.addEventListener("resize", this.fit);
    // Web fonts change line widths when they arrive; refit once they are in.
    void document.fonts?.ready.then(this.fit);
    void this.syncFromState();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    window.removeEventListener("keydown", this.onKeydown);
    window.removeEventListener("resize", this.fit);
  }

  updated() {
    requestAnimationFrame(this.fit);
  }

  private onKeydown = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      closeProjectionWindows().catch(console.error);
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowRight") {
      event.preventDefault();
      invoke("next_slide").catch(console.error);
    } else if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
      event.preventDefault();
      invoke("previous_slide").catch(console.error);
    }
  };

  private async onSlide(raw: SlidePayload) {
    const slide = stripChords(raw);
    this.slide = slide;
    if (slide.lines.length > 0) {
      this.projection = await this.resolveProjection(slide);
    } else {
      this.projection = null;
    }
  }

  private async resolveProjection(slide: SlidePayload): Promise<ProjectionState | null> {
    const cached = this.projection;
    if (
      cached &&
      cached.slides.length > 0 &&
      slide.index < cached.slides.length &&
      cached.slides[slide.index]?.section_label === slide.section_label &&
      (cached.slides[slide.index]?.stanza_index ?? slide.index) === (slide.stanza_index ?? slide.index)
    ) {
      return { ...cached, current_index: slide.index };
    }
    try {
      return await getProjectionState();
    } catch {
      return cached;
    }
  }

  private async syncFromState() {
    try {
      this.theme = await getTheme();
      this.applyTheme(this.theme);
    } catch {
      // Theme unavailable before a library is open; CSS defaults apply.
    }
    const projection = await getProjectionState();
    this.projection = projection;
    if (projection.blank || projection.slides.length === 0) {
      this.slide = { index: 0, section_label: "", lines: [], overlay: {} };
      return;
    }
    this.slide = stripChords(projection.slides[projection.current_index]);
  }

  private applyTheme(theme: SlideTheme) {
    const style = document.documentElement.style;
    style.setProperty("--praise-font-family", theme.font_name);
    style.setProperty("--praise-font-size", `${theme.font_size}px`);
    style.setProperty("--praise-font-weight", theme.font_bold ? "700" : "500");
    style.setProperty("--praise-font-style", theme.font_italic ? "italic" : "normal");
    style.setProperty("--praise-fg", theme.foreground);
    style.setProperty("--praise-bg", theme.background);
    style.setProperty("--praise-margin-top", `${theme.margin_top}px`);
    style.setProperty("--praise-margin-left", `${theme.margin_left}px`);
    style.setProperty("--praise-margin-right", `${theme.margin_right}px`);
    style.setProperty("--praise-margin-bottom", `${theme.margin_bottom}px`);
    document.body.style.background = theme.background;
    document.body.style.color = theme.foreground;
  }

  /**
   * Keep every lyric line intact: lines render unwrapped at natural width and the
   * block is scaled down to fit the screen. Only a line far wider than the screen
   * falls back to balanced wrapping (`.wrap`), after which the block is measured
   * again. See src/audience-fit.ts for the thresholds.
   */
  private fit = () => {
    const screen = this.querySelector<HTMLElement>(".audience-screen");
    const content = this.querySelector<HTMLElement>(".audience-content");
    if (!screen || !content) return;

    content.style.transform = "";
    content.style.transformOrigin = "center center";
    content.classList.remove("wrap");

    const screenStyle = getComputedStyle(screen);
    const padX = parseFloat(screenStyle.paddingLeft) + parseFloat(screenStyle.paddingRight);
    const padY = parseFloat(screenStyle.paddingTop) + parseFloat(screenStyle.paddingBottom);
    const overlay = this.querySelector<HTMLElement>(".audience-overlay");
    const counter = this.querySelector<HTMLElement>(".audience-stanza-counter");
    const overlayReserve = overlay && overlay.textContent?.trim() ? overlay.offsetHeight + 24 : 0;
    const counterReserve = counter ? counter.offsetHeight + 24 : 0;

    const availableWidth = Math.max(1, screen.clientWidth - padX);
    const availableHeight = Math.max(1, screen.clientHeight - padY - overlayReserve - counterReserve);
    const measure = () =>
      planFit({
        availableWidth,
        availableHeight,
        contentWidth: content.scrollWidth,
        contentHeight: content.scrollHeight,
      });

    let plan = measure();
    if (plan.wrap) {
      content.classList.add("wrap");
      plan = measure();
    }
    if (plan.scale < 0.999) {
      content.style.transform = `scale(${plan.scale})`;
    }
  };

  private overlayText(slide: SlidePayload): string {
    const theme = this.theme;
    const parts: string[] = [];
    if (theme?.show_title_overlay !== false && slide.overlay.title) {
      parts.push(slide.overlay.title);
    }
    if (theme?.show_key_overlay !== false && slide.overlay.key) {
      parts.push(slide.overlay.key);
    }
    if (slide.overlay.song_num != null) {
      parts.push(String(slide.overlay.song_num));
    }
    if (theme?.show_copyright_overlay !== false && slide.overlay.copyright) {
      parts.push(slide.overlay.copyright);
    }
    if (theme?.show_ccli_overlay && slide.overlay.ccli) {
      parts.push(`CCLI ${slide.overlay.ccli}`);
    }
    return parts.join(" - ");
  }

  private renderStanzaCounter() {
    const projection = this.projection;
    if (!projection || projection.blank) return nothing;
    const markers = buildStanzaMarkers(projection.slides);
    if (markers.length <= 1) return nothing;
    const active = activeStanzaIndex(markers, projection.current_index);
    const hasPrev = active > 0;
    const hasNext = active < markers.length - 1;
    return html`
      <div class="audience-stanza-counter" aria-label="Stanza ${active + 1} of ${markers.length}">
        <span class="audience-stanza-arrow ${hasPrev ? "" : "dim"}">↑</span>
        <span class="audience-stanza-count">${active + 1} / ${markers.length}</span>
        <span class="audience-stanza-arrow ${hasNext ? "" : "dim"}">↓</span>
      </div>
    `;
  }

  render() {
    const slide = this.slide;
    if (!slide || slide.lines.length === 0) {
      return html`<div class="audience-screen audience-blank"><div class="audience-vignette"></div></div>`;
    }
    const overlay = this.overlayText(slide);
    const signature = slideSignature(slide);
    return html`
      <div class="audience-screen">
        <div class="audience-vignette"></div>
        ${keyed(
          signature,
          html`<div class="audience-content">
            ${slide.lines.map((line) => html`<div class="audience-line">${line.text}</div>`)}
          </div>`,
        )}
        ${overlay ? html`<div class="audience-overlay">${overlay}</div>` : nothing}
        ${this.renderStanzaCounter()}
      </div>
    `;
  }
}

customElements.define("praise-audience", PraiseAudience);

declare global {
  interface HTMLElementTagNameMap {
    "praise-audience": PraiseAudience;
  }
}
