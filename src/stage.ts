import { listen } from "@tauri-apps/api/event";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { closeProjectionWindows } from "./projection-client";
import "./styles.css";

interface StageSlide {
  section_label: string;
  next_section_label?: string | null;
  lines: { text: string; chords: string[] }[];
  key?: string | null;
}

const root = document.getElementById("stage-root")!;

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function renderStage(slide: StageSlide) {
  if (slide.lines.length === 0) {
    root.innerHTML = `<div class="stage-screen stage-blank"></div>`;
    return;
  }

  root.innerHTML = `
    <div class="stage-screen">
      <div class="stage-meta">
        <span class="stage-section">${escapeHtml(slide.section_label)}</span>
        ${
          slide.next_section_label
            ? `<span class="stage-next">Next · ${escapeHtml(slide.next_section_label)}</span>`
            : ""
        }
        <span class="stage-key">Key · ${escapeHtml(slide.key ?? "—")}</span>
      </div>
      ${slide.lines
        .map(
          (line) => `
        <div class="stage-line">
          <div class="chords">${escapeHtml(line.chords.join("  ") || " ")}</div>
          <div class="lyrics">${escapeHtml(line.text)}</div>
        </div>`,
        )
        .join("")}
    </div>
  `;
}

listen<StageSlide>("stage-slide", (event) => {
  renderStage(event.payload);
}).catch(console.error);

getCurrentWebviewWindow().listen<StageSlide>("stage-slide", (event) => {
  renderStage(event.payload);
}).catch(console.error);

window.addEventListener("vsb-stage-slide", (event) => {
  renderStage((event as CustomEvent<StageSlide>).detail);
});

window.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    event.preventDefault();
    closeProjectionWindows().catch(console.error);
  }
});

root.innerHTML = `<div class="stage-screen stage-blank"></div>`;
