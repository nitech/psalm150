import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import {
  closeProjectionWindows,
  getProjectionState,
  getTheme,
  listenAudienceSlide,
} from "./projection-client";
import type { ProjectionState, SlidePayload, SlideTheme } from "./api";
import "./styles.css";

declare global {
  interface Window {
    __VSB_RENDER__?: (slide: SlidePayload) => void;
  }
}

const root = document.getElementById("audience-root")!;
let currentTheme: SlideTheme | null = null;
let projectionCache: ProjectionState | null = null;
let lastRenderedSignature: string | null = null;

interface StanzaMarker {
  stanzaIndex: number;
  slideIndices: number[];
}

function stanzaKey(slide: SlidePayload): number {
  return slide.stanza_index ?? slide.section_index ?? slide.index;
}

function buildStanzaMarkers(slides: SlidePayload[]): StanzaMarker[] {
  const markers: StanzaMarker[] = [];
  for (const slide of slides) {
    const stanzaIndex = stanzaKey(slide);
    const last = markers[markers.length - 1];
    if (last && last.stanzaIndex === stanzaIndex) {
      last.slideIndices.push(slide.index);
    } else {
      markers.push({ stanzaIndex, slideIndices: [slide.index] });
    }
  }
  return markers;
}

function activeStanzaIndex(markers: StanzaMarker[], currentIndex: number): number {
  const idx = markers.findIndex((marker) => marker.slideIndices.includes(currentIndex));
  return idx >= 0 ? idx : 0;
}

function slideSignature(slide: SlidePayload): string {
  return `${slide.index}:${slide.stanza_index ?? 0}:${slide.lines.map((line) => line.text).join("\n")}`;
}

function renderProgressRail(slides: SlidePayload[], currentIndex: number): string {
  const markers = buildStanzaMarkers(slides);
  if (markers.length <= 1) return "";

  const active = activeStanzaIndex(markers, currentIndex);
  const segments = markers
    .map((_marker, index) => {
      const state =
        index < active ? "past" : index === active ? "current" : "upcoming";
      return `<div class="audience-progress-segment ${state}"></div>`;
    })
    .join("");

  return `
    <div class="audience-progress" aria-hidden="true">
      <div class="audience-progress-rail">${segments}</div>
    </div>
  `;
}

function updateProgressRail(projection: ProjectionState, currentIndex: number) {
  const html = renderProgressRail(projection.slides, currentIndex);
  const existing = root.querySelector(".audience-progress");
  if (!html) {
    existing?.remove();
    return;
  }
  if (existing) {
    existing.outerHTML = html;
    return;
  }
  root.querySelector(".audience-screen")?.insertAdjacentHTML("beforeend", html);
}

async function resolveProjection(slide: SlidePayload): Promise<ProjectionState | null> {
  const cached = projectionCache;
  if (
    cached &&
    cached.slides.length > 0 &&
    slide.index < cached.slides.length &&
    cached.slides[slide.index]?.section_label === slide.section_label &&
    (cached.slides[slide.index]?.stanza_index ?? slide.index) === (slide.stanza_index ?? slide.index)
  ) {
    cached.current_index = slide.index;
    return cached;
  }

  try {
    const projection = await getProjectionState();
    projectionCache = projection;
    return projection;
  } catch {
    return cached;
  }
}

function audienceSlide(slide: SlidePayload): SlidePayload {
  return {
    ...slide,
    lines: slide.lines.map((line) => ({ text: line.text, chords: [] })),
  };
}

function applyTheme(theme: SlideTheme) {
  currentTheme = theme;
  const style = document.documentElement.style;
  style.setProperty("--vsb-font-family", theme.font_name);
  style.setProperty("--vsb-font-size", `${theme.font_size}px`);
  style.setProperty("--vsb-font-weight", theme.font_bold ? "700" : "500");
  style.setProperty("--vsb-font-style", theme.font_italic ? "italic" : "normal");
  style.setProperty("--vsb-fg", theme.foreground);
  style.setProperty("--vsb-bg", theme.background);
  style.setProperty("--vsb-margin-top", `${theme.margin_top}px`);
  style.setProperty("--vsb-margin-left", `${theme.margin_left}px`);
  style.setProperty("--vsb-margin-right", `${theme.margin_right}px`);
  style.setProperty("--vsb-margin-bottom", `${theme.margin_bottom}px`);
  document.body.style.background = theme.background;
  document.body.style.color = theme.foreground;
}

function fitSlideToViewport() {
  const screen = root.querySelector<HTMLElement>(".audience-screen");
  const content = root.querySelector<HTMLElement>(".audience-content");
  if (!screen || !content) return;

  content.style.transform = "";
  content.style.transformOrigin = "center center";

  const screenStyle = getComputedStyle(screen);
  const padX =
    parseFloat(screenStyle.paddingLeft) + parseFloat(screenStyle.paddingRight);
  const padY =
    parseFloat(screenStyle.paddingTop) + parseFloat(screenStyle.paddingBottom);
  const overlay = root.querySelector<HTMLElement>(".audience-overlay");
  const overlayReserve =
    overlay && overlay.textContent?.trim()
      ? overlay.offsetHeight + 24
      : 0;

  const availableWidth = Math.max(1, screen.clientWidth - padX);
  const availableHeight = Math.max(1, screen.clientHeight - padY - overlayReserve);

  const scale = Math.min(
    availableWidth / content.scrollWidth,
    availableHeight / content.scrollHeight,
    1,
  );

  if (scale < 0.999) {
    content.style.transform = `scale(${scale})`;
  }
}

function renderSlideView(slide: SlidePayload, projection: ProjectionState | null) {
  if (slide.lines.length === 0) {
    lastRenderedSignature = null;
    root.innerHTML = `<div class="audience-screen audience-blank"><div class="audience-vignette"></div></div>`;
    return;
  }

  const signature = slideSignature(slide);
  if (signature === lastRenderedSignature) {
    if (projection && !projection.blank) {
      updateProgressRail(projection, projection.current_index);
    }
    return;
  }
  lastRenderedSignature = signature;

  const overlay = [
    currentTheme?.show_title_overlay !== false ? slide.overlay.title : null,
    currentTheme?.show_key_overlay !== false && slide.overlay.key
      ? `Key: ${slide.overlay.key}`
      : null,
    currentTheme?.show_copyright_overlay !== false ? slide.overlay.copyright : null,
    currentTheme?.show_ccli_overlay && slide.overlay.ccli
      ? `CCLI ${slide.overlay.ccli}`
      : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const progress =
    projection && !projection.blank
      ? renderProgressRail(projection.slides, projection.current_index)
      : "";

  root.innerHTML = `
    <div class="audience-screen">
      <div class="audience-vignette"></div>
      <div class="audience-content">
        ${slide.lines.map((line) => `<div class="audience-line">${escapeHtml(line.text)}</div>`).join("")}
      </div>
      ${overlay ? `<div class="audience-overlay">${escapeHtml(overlay)}</div>` : ""}
      ${progress}
    </div>
  `;

  requestAnimationFrame(() => fitSlideToViewport());
}

async function renderSlide(slide: SlidePayload) {
  const projection = slide.lines.length > 0 ? await resolveProjection(slide) : null;
  renderSlideView(slide, projection);
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

window.__VSB_RENDER__ = (slide) => {
  renderSlide(audienceSlide(slide)).catch(console.error);
};

async function syncFromState() {
  try {
    const theme = await getTheme();
    applyTheme(theme);
  } catch {
    // Theme unavailable before a library is open; defaults from CSS apply.
  }

  const projection = await getProjectionState();
  projectionCache = projection;
  lastRenderedSignature = null;
  if (projection.blank || projection.slides.length === 0) {
    renderSlideView({ index: 0, section_label: "", lines: [], overlay: {} }, null);
    return;
  }
  renderSlideView(
    audienceSlide(projection.slides[projection.current_index]),
    projection,
  );
}

listenAudienceSlide((slide) => renderSlide(audienceSlide(slide))).catch(console.error);
getCurrentWebviewWindow().listen<SlidePayload>("audience-slide", (event) => {
  renderSlide(audienceSlide(event.payload)).catch(console.error);
}).catch(console.error);

window.addEventListener("keydown", (event) => {
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
});

window.addEventListener("resize", () => fitSlideToViewport());

root.innerHTML = `<div class="audience-screen audience-blank"><div class="audience-vignette"></div></div>`;
syncFromState().catch(console.error);
