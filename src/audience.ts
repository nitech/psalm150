import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import {
  closeProjectionWindows,
  getProjectionState,
  getTheme,
  listenAudienceSlide,
} from "./projection-client";
import type { SlidePayload, SlideTheme } from "./api";
import "./styles.css";

declare global {
  interface Window {
    __VSB_RENDER__?: (slide: SlidePayload) => void;
  }
}

const root = document.getElementById("audience-root")!;
let currentTheme: SlideTheme | null = null;

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

function renderSlide(slide: SlidePayload) {
  if (slide.lines.length === 0) {
    root.innerHTML = `<div class="audience-screen audience-blank"><div class="audience-vignette"></div></div>`;
    return;
  }

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

  root.innerHTML = `
    <div class="audience-screen">
      <div class="audience-vignette"></div>
      <div class="audience-content">
        ${slide.lines.map((line) => `<div class="audience-line">${escapeHtml(line.text)}</div>`).join("")}
      </div>
      ${overlay ? `<div class="audience-overlay">${escapeHtml(overlay)}</div>` : ""}
    </div>
  `;

  requestAnimationFrame(() => fitSlideToViewport());
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

window.__VSB_RENDER__ = (slide) => renderSlide(audienceSlide(slide));

async function syncFromState() {
  try {
    const theme = await getTheme();
    applyTheme(theme);
  } catch {
    // Theme unavailable before a library is open; defaults from CSS apply.
  }

  const projection = await getProjectionState();
  if (projection.blank || projection.slides.length === 0) {
    renderSlide({ index: 0, section_label: "", lines: [], overlay: {} });
    return;
  }
  renderSlide(audienceSlide(projection.slides[projection.current_index]));
}

listenAudienceSlide((slide) => renderSlide(audienceSlide(slide))).catch(console.error);
getCurrentWebviewWindow().listen<SlidePayload>("audience-slide", (event) => {
  renderSlide(audienceSlide(event.payload));
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
