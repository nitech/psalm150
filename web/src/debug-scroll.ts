/**
 * TEMPORARY: finding why the song list jumps on iOS when a song is opened
 * after sorting. A small box in the corner lists the last events across
 * screens (touch, tap, address change, scroll, viewport change, and each
 * time a scroll position is saved for Back) with the scroll position and
 * Safari's visual viewport, for a screenshot. Remove this file and its
 * import in main.ts once the cause is found.
 */
const MAX_LINES = 16;
const lines: string[] = [];
let box: HTMLElement | null = null;
let start = performance.now();

function snapshot(): string {
  const viewport = window.visualViewport;
  const sort = document.querySelector("#song-sort")?.getBoundingClientRect().top;
  return [
    `y${Math.round(scrollY)}`,
    viewport ? `vv${Math.round(viewport.height)}/${Math.round(viewport.offsetTop)}` : "",
    sort === undefined ? "" : `s${Math.round(sort)}`,
    `st${(history.state as { scrollY?: number } | null)?.scrollY ?? "-"}`,
  ].filter(Boolean).join(" ");
}

function log(event: string): void {
  if (!box) return;
  const ms = Math.round(performance.now() - start);
  lines.push(`${String(ms).padStart(5)} ${event.padEnd(6)} ${snapshot()}`);
  while (lines.length > MAX_LINES) lines.shift();
  box.textContent = `${location.hash.slice(0, 18)}\n${lines.join("\n")}`;
}

export function installScrollDebug(): void {
  box = document.createElement("pre");
  box.setAttribute("aria-hidden", "true");
  box.style.cssText = "position:fixed;z-index:9999;left:4px;top:calc(env(safe-area-inset-top) + 60px);margin:0;padding:4px 6px;max-width:calc(100vw - 8px);background:rgb(0 0 0 / 0.8);color:#7CFC9A;font:10px/1.25 ui-monospace,Menlo,monospace;white-space:pre;pointer-events:none;border-radius:6px";
  document.body.append(box);
  // Times count from the latest touch; the lines before it stay, so the
  // song tapped in the list still shows on the song's screen and after Back.
  document.addEventListener("pointerdown", () => { start = performance.now(); log("down"); }, { capture: true, passive: true });
  document.addEventListener("pointerup", () => log("up"), { capture: true, passive: true });
  document.addEventListener("click", () => log("click"), { capture: true });
  window.addEventListener("hashchange", () => log("hash"));
  let scrollFrame = 0;
  window.addEventListener("scroll", () => {
    if (scrollFrame) return;
    scrollFrame = requestAnimationFrame(() => { scrollFrame = 0; log("scroll"); });
  }, { passive: true });
  window.visualViewport?.addEventListener("resize", () => log("vv-rs"));
  window.addEventListener("resize", () => log("resize"));
  window.addEventListener("hashchange", () => { setTimeout(() => log("+300"), 300); setTimeout(() => log("+900"), 900); });
  // Each scroll position kept for Back, and which screen it went to.
  const replace = history.replaceState.bind(history);
  history.replaceState = (data, unused, url) => {
    replace(data, unused, url);
    const saved = (data as { scrollY?: number } | null)?.scrollY;
    if (saved !== undefined) log(`save${location.hash.startsWith("#/songs/") ? "S" : "L"}`);
  };
  log("start");
}
