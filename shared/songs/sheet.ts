/**
 * Sheets: a bottom sheet on phones, a centred dialog on wide screens.
 *
 * Canonical copy: PSA150-server/shared/songs/. The desktop repo mirrors this
 * folder at src/shared/songs/ with `bun run sync:shared`; edit it here, never
 * in the mirror.
 */
import { escapeHtml } from "./format.ts";
import { t } from "./i18n.ts";
import { icon } from "./icon.ts";

let sheetCount = 0;

/**
 * A bottom sheet on phones, a centred dialog on wide screens: a modal
 * `<dialog>` named by its first heading. It slides up as it opens (fades in
 * on wide screens), and Escape, a tap outside it or (on phones) a swipe down
 * slides it away again (`closeSheet`). Focus goes back to the control that
 * opened it (or the screen's heading, when a redraw replaced that control).
 * With `closeButton: false` the × is there only for screen readers.
 */
export function openSheet(content: string, { closeButton = true } = {}): HTMLDialogElement {
  const opener = document.activeElement instanceof HTMLElement && document.activeElement !== document.body
    ? document.activeElement
    : null;
  const dialog = document.createElement("dialog");
  dialog.className = "sheet";
  dialog.innerHTML = `<div class="sheet-body"><span class="sheet-grip" aria-hidden="true"></span><button type="button" class="icon-button sheet-close${closeButton ? "" : " sr-only"}" aria-label="${escapeHtml(t("Close"))}">${icon("close")}</button>${content}</div>`;
  if (!closeButton) dialog.classList.add("no-close");
  const heading = dialog.querySelector("h2");
  if (heading) {
    heading.id ||= `sheet-title-${++sheetCount}`;
    dialog.setAttribute("aria-labelledby", heading.id);
  }
  document.body.append(dialog);
  dialog.querySelector(".sheet-close")?.addEventListener("click", () => closeSheet(dialog));
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) closeSheet(dialog);
  });
  // Escape slides it away too, instead of the browser closing it at once.
  dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    closeSheet(dialog);
  });
  dialog.addEventListener("close", () => {
    dialog.remove();
    // Wait for whatever the closing action redraws.
    window.setTimeout(() => {
      const focus = document.activeElement;
      if (focus && focus !== document.body && focus.isConnected) return;
      if (opener?.isConnected) opener.focus();
      else (document.querySelector<HTMLElement>("#page h1") ?? document.querySelector<HTMLElement>("#page"))?.focus({ preventScroll: true });
    }, 0);
  });
  bindSwipeDown(dialog);
  dialog.showModal();
  return dialog;
}

/**
 * On phones the sheet follows a finger dragging it down and closes when let
 * go far or fast enough, else springs back. A drag starts only while what is
 * under the finger is scrolled to its top, and never in a row that scrolls
 * sideways (such as the chord shapes) or a field.
 */
function bindSwipeDown(dialog: HTMLDialogElement): void {
  let startX = 0;
  let startY = 0;
  let startTime = 0;
  let offset = 0;
  let mode: "off" | "maybe" | "drag" = "off";
  const atTop = (target: Element | null) => {
    for (let node = target; node && node !== dialog.parentElement; node = node.parentElement) {
      if (node.scrollTop > 0) return false;
    }
    return true;
  };
  dialog.addEventListener("touchstart", (event) => {
    mode = "off";
    const target = event.target as Element;
    if (event.touches.length !== 1 || !matchMedia("(max-width: 639px)").matches) return;
    if (target.closest("input, textarea, select, [contenteditable], .chord-shapes") || !atTop(target)) return;
    startX = event.touches[0].clientX;
    startY = event.touches[0].clientY;
    startTime = event.timeStamp;
    offset = 0;
    mode = "maybe";
  }, { passive: true });
  dialog.addEventListener("touchmove", (event) => {
    if (mode === "off") return;
    const dx = event.touches[0].clientX - startX;
    const dy = event.touches[0].clientY - startY;
    if (mode === "maybe") {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
      if (dy <= 0 || Math.abs(dx) > dy) {
        mode = "off";
        return;
      }
      mode = "drag";
      dialog.classList.add("dragging");
    }
    event.preventDefault();
    offset = Math.max(0, dy);
    dialog.style.transform = `translateY(${offset}px)`;
  }, { passive: false });
  const end = (event: TouchEvent) => {
    if (mode !== "drag") {
      mode = "off";
      return;
    }
    mode = "off";
    dialog.classList.remove("dragging");
    const fast = offset / Math.max(1, event.timeStamp - startTime) > 0.5;
    // Closing slides on down from where the finger let go.
    if (offset > Math.min(140, dialog.offsetHeight * 0.3) || (fast && offset > 30)) closeSheet(dialog);
    else {
      dialog.style.transform = "";
    }
  };
  dialog.addEventListener("touchend", end);
  dialog.addEventListener("touchcancel", end);
}

/**
 * Slides the sheet down (on wide screens, fades it) and then closes it, so
 * every sheet leaves the way it came. Without motion it closes at once.
 */
export function closeSheet(dialog: HTMLDialogElement): void {
  if (!dialog.open) {
    dialog.remove();
    return;
  }
  if (dialog.classList.contains("leaving")) return;
  const close = () => {
    if (dialog.open) dialog.close();
  };
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return close();
  dialog.classList.add("leaving");
  // From where a swipe left it, if it did.
  dialog.style.transform = "";
  dialog.addEventListener("transitionend", (event) => {
    if (event.target === dialog) close();
  });
  window.setTimeout(close, 400);
}
