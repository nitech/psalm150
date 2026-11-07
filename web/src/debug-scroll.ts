/**
 * TEMPORARY: finding why the song list jumps on iOS when a song is opened
 * after sorting. A small box in the corner lists the last few events
 * (touch, tap, address change, scroll, viewport change) with the scroll
 * position and Safari's visual viewport, for a screenshot. Remove this file
 * and its import in main.ts once the cause is found.
 */
const MAX_LINES = 9;
const lines: string[] = [];
let box: HTMLElement | null = null;
let start = 0;

function snapshot(): string {
  const viewport = window.visualViewport;
  const sort = document.querySelector("#song-sort")?.getBoundingClientRect().top;
  return [
    `y${Math.round(scrollY)}`,
    `ih${innerHeight}`,
    viewport ? `vv${Math.round(viewport.height)}/${Math.round(viewport.offsetTop)}` : "",
    sort === undefined ? "" : `sort${Math.round(sort)}`,
    `st${(history.state as { scrollY?: number } | null)?.scrollY ?? "-"}`,
  ].filter(Boolean).join(" ");
}

function log(event: string): void {
  if (!box) return;
  const ms = start ? Math.round(performance.now() - start) : 0;
  lines.push(`${String(ms).padStart(5)} ${event.padEnd(6)} ${snapshot()}`);
  while (lines.length > MAX_LINES) lines.shift();
  box.textContent = `${location.hash.slice(0, 18)}\n${lines.join("\n")}`;
}

export function installScrollDebug(): void {
  box = document.createElement("pre");
  box.setAttribute("aria-hidden", "true");
  box.style.cssText = "position:fixed;z-index:9999;left:4px;top:calc(env(safe-area-inset-top) + 60px);margin:0;padding:4px 6px;max-width:calc(100vw - 8px);background:rgb(0 0 0 / 0.78);color:#7CFC9A;font:10px/1.25 ui-monospace,Menlo,monospace;white-space:pre;pointer-events:none;border-radius:6px";
  document.body.append(box);
  // Each touch starts the clock, so the times read from the finger landing.
  document.addEventListener("pointerdown", () => { start = performance.now(); lines.length = 0; log("down"); }, { capture: true, passive: true });
  document.addEventListener("click", () => log("click"), { capture: true });
  window.addEventListener("hashchange", () => log("hash"));
  let scrollFrame = 0;
  window.addEventListener("scroll", () => {
    if (scrollFrame) return;
    scrollFrame = requestAnimationFrame(() => { scrollFrame = 0; log("scroll"); });
  }, { passive: true });
  window.visualViewport?.addEventListener("resize", () => log("vv-rs"));
  window.addEventListener("resize", () => log("resize"));
  // After the next screen settles.
  window.addEventListener("hashchange", () => { setTimeout(() => log("+300"), 300); setTimeout(() => log("+900"), 900); });
  log("start");
}
