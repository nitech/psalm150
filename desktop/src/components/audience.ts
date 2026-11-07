import { html, nothing } from "lit";
import { keyed } from "lit/directives/keyed.js";
import { invoke } from "@tauri-apps/api/core";
import {
  closeProjectionWindows,
  getProjectionSnapshot,
  listenProjectionUpdated,
} from "../projection-client";
import type { ProjectionSnapshot, ProjectionState, SlidePayload, SlideTheme } from "../api";
import { activeStanzaIndex, buildStanzaMarkers } from "../stanza-markers";
import { MAX_FONT_SCREEN_SHARE, needsWrap, planSongFit, type SongFit } from "../audience-fit";
import { Psa150Element } from "./base";

/**
 * Which slide this is, not what it says: a new slide fades in, but a
 * correction saved while it is on screen just replaces the words.
 */
function slideSignature(sessionId: string | null, slide: SlidePayload): string {
  return `${sessionId ?? ""}:${slide.index}:${slide.stanza_index ?? 0}`;
}

/** Stanzas are measured at this size; the fit scales from it. */
const MEASURE_FONT = 100;

/** The words of a slide, to tell stanzas apart. */
function slideWords(slide: SlidePayload): string {
  return slide.lines.map((line) => line.text).join("\n");
}

/** Audience-facing projection window. */
export class Psa150Audience extends Psa150Element {
  static properties = {
    slide: { state: true },
    projection: { state: true },
    theme: { state: true },
  };

  declare slide: SlidePayload | null;
  declare projection: ProjectionState | null;
  declare theme: SlideTheme | null;
  private revision = -1;
  private sessionId: string | null = null;
  private unlistenProjection?: () => void;
  /** The song's font, measured once per song and screen. */
  private songFit: { key: string; fit: SongFit; words: string[] } | null = null;

  constructor() {
    super();
    this.slide = null;
    this.projection = null;
    this.theme = null;
  }

  connectedCallback() {
    super.connectedCallback();
    window.addEventListener("keydown", this.onKeydown);
    window.addEventListener("resize", this.fit);
    // Web fonts change line widths when they arrive; measure again once they are in.
    void document.fonts?.ready.then(() => {
      this.songFit = null;
      this.fit();
    });
    void this.startProjectionSync();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    window.removeEventListener("keydown", this.onKeydown);
    window.removeEventListener("resize", this.fit);
    this.unlistenProjection?.();
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
    this.sessionId = snapshot.session_id;
    this.projection = snapshot.projection;
    this.theme = snapshot.theme;
    this.applyTheme(snapshot.theme);
    this.slide = snapshot.audience;
  }

  private applyTheme(theme: SlideTheme) {
    const style = document.documentElement.style;
    style.setProperty("--psa150-font-family", theme.font_name);
    style.setProperty("--psa150-font-size", `${theme.font_size}px`);
    style.setProperty("--psa150-font-weight", theme.font_bold ? "700" : "500");
    style.setProperty("--psa150-font-style", theme.font_italic ? "italic" : "normal");
    // Pure white on pure black whatever the theme says: the most contrast a
    // projector can give.
    style.setProperty("--psa150-fg", "#ffffff");
    style.setProperty("--psa150-bg", "#000000");
    style.setProperty("--psa150-margin-top", `${theme.margin_top}px`);
    style.setProperty("--psa150-margin-left", `${theme.margin_left}px`);
    style.setProperty("--psa150-margin-right", `${theme.margin_right}px`);
    style.setProperty("--psa150-margin-bottom", `${theme.margin_bottom}px`);
    document.body.style.background = "#000000";
    document.body.style.color = "#ffffff";
  }

  /**
   * One size for the whole song, as large as it can be: every stanza of the
   * song is measured off screen, and the font is the largest at which all of
   * them fit, up to a share of the screen's height (src/audience-fit.ts).
   * Lines stay whole; a stanza with a far too long line wraps instead.
   */
  private fit = () => {
    const screen = this.querySelector<HTMLElement>(".audience-screen");
    const content = this.querySelector<HTMLElement>(".audience-content");
    if (!screen || !content || !this.slide) return;

    const root = document.documentElement.style;
    const screenStyle = getComputedStyle(screen);
    const padX = parseFloat(screenStyle.paddingLeft) + parseFloat(screenStyle.paddingRight);
    const padY = parseFloat(screenStyle.paddingTop) + parseFloat(screenStyle.paddingBottom);
    const width = Math.max(1, screen.clientWidth - padX);
    const height = Math.max(1, screen.clientHeight - padY);

    const current = slideWords(this.slide);
    const words = this.songWords(current);
    const lineStyle = getComputedStyle(content.querySelector(".audience-line") ?? content);
    const key = JSON.stringify([
      width,
      height,
      window.innerHeight,
      lineStyle.fontFamily,
      lineStyle.fontWeight,
      lineStyle.fontStyle,
      words,
    ]);
    if (this.songFit?.key !== key) {
      this.songFit = { key, words, fit: this.measureSong(screen, words, width, height) };
    }
    const fit = this.songFit.fit;
    root.setProperty("--psa150-fit-font", `${fit.font}px`);
    content.classList.toggle("wrap", needsWrap(fit, words.indexOf(current)));

    // Never cut words off, should a measurement be off.
    content.style.transform = "";
    const overflow = Math.min(
      width / Math.max(1, content.scrollWidth),
      height / Math.max(1, content.scrollHeight),
    );
    const scale = overflow < 0.999 ? overflow : 1;
    if (scale < 1) this.transformContent(content, 0, scale);
    this.clearFooter(screen, content, scale, parseFloat(screenStyle.paddingTop));
  };

  private transformContent(content: HTMLElement, lift: number, scale: number) {
    content.style.transformOrigin = "center center";
    content.style.transform = `translateY(${-lift}px) scale(${scale})`;
  }

  /**
   * The footer (song number and key, stanza counter) sits over the bottom of
   * the screen, not on a strip of its own. A stanza whose letters would run
   * into it moves up, or shrinks a little when there is no room above, so the
   * song keeps one size and every other stanza uses the whole height.
   */
  private clearFooter(screen: HTMLElement, content: HTMLElement, scale: number, padTop: number) {
    const labels = [".audience-overlay", ".audience-stanza-counter"]
      .map((selector) => this.querySelector<HTMLElement>(selector)?.getBoundingClientRect())
      .filter((box): box is DOMRect => Boolean(box && box.width && box.height));
    if (!labels.length) return;
    const lines = [...content.querySelectorAll<HTMLElement>(".audience-line")];
    // A quarter of the song's font between the letters and a label.
    const gap = parseFloat(getComputedStyle(lines[0] ?? content).fontSize) * 0.25;
    // How far the letters reach into a label, line by line on screen (their
    // own width, not the block's).
    let reach = 0;
    for (const line of lines) {
      const range = document.createRange();
      range.selectNodeContents(line);
      for (const box of range.getClientRects()) {
        for (const label of labels) {
          if (box.right > label.left - gap && box.left < label.right + gap) {
            reach = Math.max(reach, box.bottom + gap - label.top);
          }
        }
      }
    }
    if (reach <= 0) return;
    const block = content.getBoundingClientRect();
    const ceiling = screen.getBoundingClientRect().top + padTop;
    if (reach <= block.top - ceiling) {
      this.transformContent(content, reach, scale);
      return;
    }
    // No room above: shrink the stanza until it ends above the footer.
    const floor = Math.min(...labels.map((label) => label.top)) - gap;
    const shrunk = scale * Math.max(0.1, (floor - ceiling) / block.height);
    const height = (block.height * shrunk) / scale;
    const center = block.top + block.height / 2;
    this.transformContent(content, center - height / 2 - ceiling, shrunk);
  }

  /** The song's stanzas, one entry per different set of words, and the one on screen. */
  private songWords(current: string): string[] {
    const words = new Set(
      (this.projection?.slides ?? []).map(slideWords).filter((text) => text.trim()),
    );
    words.add(current);
    return [...words];
  }

  private measureSong(screen: HTMLElement, words: string[], width: number, height: number): SongFit {
    const measure = document.createElement("div");
    measure.className = "audience-content audience-measure";
    measure.setAttribute("aria-hidden", "true");
    screen.append(measure);
    const show = (index: number, wrap: boolean, font: number) => {
      measure.replaceChildren(
        ...words[index].split("\n").map((text) => {
          const line = document.createElement("div");
          line.className = "audience-line";
          line.textContent = text;
          return line;
        }),
      );
      measure.classList.toggle("wrap", wrap);
      measure.style.width = wrap ? `${width}px` : "";
      measure.style.setProperty("--psa150-fit-font", `${font}px`);
      return measure.getBoundingClientRect();
    };
    try {
      return planSongFit({
        availableWidth: width,
        availableHeight: height,
        baseFont: MEASURE_FONT,
        maxFont: window.innerHeight * MAX_FONT_SCREEN_SHARE,
        slides: words.map((_, index) => {
          const box = show(index, false, MEASURE_FONT);
          return { width: box.width, height: box.height };
        }),
        wrappedFits: (index, font) => {
          show(index, true, font);
          return measure.scrollHeight <= height + 0.5 && measure.scrollWidth <= width + 0.5;
        },
      });
    } finally {
      measure.remove();
    }
  }

  /** Whether the slide wraps, from the song measured last, so it shows right at once. */
  private wrapsNow(slide: SlidePayload): boolean {
    const fit = this.songFit;
    return Boolean(fit && needsWrap(fit.fit, fit.words.indexOf(slideWords(slide))));
  }

  /**
   * Bottom left: the song number and key, as large as the words. No title: the
   * song is on screen. Copyright and CCLI, when the theme shows them, follow
   * in small print.
   */
  private renderOverlay(slide: SlidePayload) {
    const theme = this.theme;
    const key = theme?.show_key_overlay !== false ? slide.overlay.key : null;
    const notes: string[] = [];
    if (theme?.show_copyright_overlay !== false && slide.overlay.copyright) {
      notes.push(slide.overlay.copyright);
    }
    if (theme?.show_ccli_overlay && slide.overlay.ccli) {
      notes.push(`CCLI ${slide.overlay.ccli}`);
    }
    const number = slide.overlay.song_num;
    if (number == null && !key && notes.length === 0) return nothing;
    return html`<div class="audience-overlay">
      ${number != null
        ? html`<span class="audience-song-number"
            ><span class="visually-hidden">Song </span>${number}</span
          >`
        : nothing}
      ${key
        ? html`<span class="audience-song-key"><span class="visually-hidden">Key </span>${key}</span>`
        : nothing}
      ${notes.length ? html`<span class="audience-overlay-text">${notes.join(" - ")}</span>` : nothing}
    </div>`;
  }

  private renderStanzaCounter() {
    const projection = this.projection;
    if (!projection || projection.blank) return nothing;
    // Steps of the sung order (a repeated chorus counts each time).
    const order = projection.order ?? [];
    const markers = order.length ? [] : buildStanzaMarkers(projection.slides);
    const total = order.length || markers.length;
    if (total <= 1) return nothing;
    const active = order.length
      ? Math.min(projection.order_position ?? 0, total - 1)
      : activeStanzaIndex(markers, projection.current_index);
    const hasPrev = active > 0;
    const hasNext = active < total - 1;
    return html`
      <div class="audience-stanza-counter">
        <span class="audience-stanza-arrow ${hasPrev ? "" : "dim"}" aria-hidden="true">↑</span>
        <span class="audience-stanza-count"
          ><span class="visually-hidden">Stanza </span>${active + 1}<span aria-hidden="true"> / </span
          ><span class="visually-hidden"> of </span>${total}</span
        >
        <span class="audience-stanza-arrow ${hasNext ? "" : "dim"}" aria-hidden="true">↓</span>
      </div>
    `;
  }

  render() {
    const slide = this.slide;
    if (!slide || slide.lines.length === 0) {
      return html`<div class="audience-screen audience-blank"></div>`;
    }
    const signature = slideSignature(this.sessionId, slide);
    return html`
      <div class="audience-screen">
        ${keyed(
          signature,
          html`<div class="audience-content ${this.wrapsNow(slide) ? "wrap" : ""}">
            ${slide.lines.map((line) => html`<div class="audience-line">${line.text}</div>`)}
          </div>`,
        )}
        ${this.renderOverlay(slide)}
        ${this.renderStanzaCounter()}
      </div>
    `;
  }
}

customElements.define("psa150-audience", Psa150Audience);

declare global {
  interface HTMLElementTagNameMap {
    "psa150-audience": Psa150Audience;
  }
}
