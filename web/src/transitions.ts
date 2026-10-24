/**
 * App-like movement on phones: screens slide in from the right when you go
 * deeper (a song from the list, a set's item), slide back out when you go
 * up, and items of a set slide sideways, following the finger while you
 * swipe. The browser's view transitions do the drawing (both screens are
 * snapshots moved on the GPU), so a slide never waits on layout.
 *
 * Without view transitions (older browsers), with reduced motion, or on wide
 * screens, screens simply change. When the browser itself animated the
 * change (Safari's swipe from the edge to go back), nothing is added.
 */

export type Slide = "push" | "pop" | "next" | "prev" | null;

type ViewTransitionDocument = Document & {
  startViewTransition?: (update: () => void) => { finished: Promise<void>; ready: Promise<void>; updateCallbackDone: Promise<void> };
};

/** Phones and narrow windows only; the wide layout keeps its rail still. */
function wanted(): boolean {
  return matchMedia("(max-width: 899px)").matches && !matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Runs `update` (which swaps the screen) inside a view transition sliding the
 * `kind` way. `update` must not throw; it runs once either way.
 */
export function swapScreen(kind: Slide, update: () => void): void {
  const doc = document as ViewTransitionDocument;
  const skip = slideDone;
  slideDone = false;
  if (!kind || skip || !doc.startViewTransition || !wanted()) {
    update();
    return;
  }
  const root = document.documentElement;
  root.dataset.slide = kind;
  try {
    const transition = doc.startViewTransition(update);
    // The browser may skip the animation (the window resized, another swap
    // started); the screen still changes, so that is not an error.
    transition.ready.catch(() => undefined);
    transition.updateCallbackDone.catch(() => undefined);
    transition.finished.catch(() => undefined).finally(() => {
      if (root.dataset.slide === kind) delete root.dataset.slide;
    });
  } catch {
    delete root.dataset.slide;
    update();
  }
}

/** The next screen is already in place (a swipe moved it there). */
let slideDone = false;
let slideDoneTimer = 0;

/** The next `swapScreen` swaps without sliding; for a screen a swipe already brought in. */
export function skipNextSlide(): void {
  slideDone = true;
  window.clearTimeout(slideDoneTimer);
  // Only for the change about to happen.
  slideDoneTimer = window.setTimeout(() => { slideDone = false; }, 1500);
}

/**
 * Which way to slide from one route (hash path) to another. Deeper in the
 * same section slides in, shallower slides out; a set's items slide
 * sideways by their order. Another section (a tab) does not slide.
 */
export function slideBetween(from: string | null, to: string): Slide {
  if (!from || from === to) return null;
  const play = /^\/sets\/([^/]+)\/play\/(\d+)$/;
  const a = play.exec(from);
  const b = play.exec(to);
  if (a && b && a[1] === b[1]) return Number(b[2]) > Number(a[2]) ? "next" : "prev";
  const parts = (path: string) => path.split("/").filter(Boolean);
  const [pa, pb] = [parts(from), parts(to)];
  if (pa[0] !== pb[0]) return null;
  // A set's item counts as one level below the set.
  const depth = (path: string[]) => path.filter((part, index) => !(path[index - 1] === "play" && /^\d+$/.test(part))).length;
  const [da, db] = [depth(pa), depth(pb)];
  return db > da ? "push" : db < da ? "pop" : null;
}

/** When the browser animated a Back itself, as Safari does for an edge swipe. */
let lastEdgeTouch = 0;
let browserAnimated = false;
document.addEventListener("touchstart", (event) => {
  const x = event.touches[0]?.clientX ?? 0;
  if (x < 30 || x > window.innerWidth - 30) lastEdgeTouch = Date.now();
}, { capture: true, passive: true });
window.addEventListener("popstate", (event) => {
  const ua = (event as PopStateEvent & { hasUAVisualTransition?: boolean }).hasUAVisualTransition;
  browserAnimated = ua === true || Date.now() - lastEdgeTouch < 1500;
});

/** Whether the change now under way was already animated by the browser; asks once. */
export function takeBrowserAnimated(): boolean {
  const value = browserAnimated;
  browserAnimated = false;
  return value;
}

/** The app was opened from the Home Screen, so the browser has no Back gesture of its own. */
export function installedApp(): boolean {
  return matchMedia("(display-mode: standalone)").matches
    || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

/** Space between the screen and the neighbour peeking in beside it. */
const PEEK_GAP = 32;

/**
 * Swiping sideways through songs (a set's items, a list's songs): the screen
 * (`.swipe-view`, which gets `--drag`) follows the finger, and with `peek`
 * the neighbour comes in beside it, so you see where you are going (`peek`
 * gives null where there is none to show, such as the list). A short
 * swipe springs back; a long or quick one moves on: with `peek` the
 * neighbour slides all the way in and `go` swaps it in without another
 * slide, else `go`'s own slide starts where the finger let go. Vertical
 * scrolling is left to the browser (`touch-action: pan-y`), and in the
 * browser a touch at the very left edge is left for its Back.
 */
export function bindItemSwipe(
  root: HTMLElement,
  neighbours: { previous: boolean; next: boolean },
  go: (step: 1 | -1) => void,
  peek?: (step: 1 | -1) => string | null,
): () => void {
  let startX = 0;
  let startY = 0;
  let startTime = 0;
  let offset = 0;
  let mode: "off" | "maybe" | "drag" | "leaving" = "off";
  let peeking: 1 | -1 | 0 = 0;
  const view = () => root.querySelector<HTMLElement>(".swipe-view");

  /** Puts the neighbour `step` beside the screen, level with the top of the window. */
  const showPeek = (step: 1 | -1 | 0) => {
    if (step === peeking) return;
    peeking = step;
    const element = view();
    element?.querySelector(".swipe-peek")?.remove();
    if (!element || !step || !peek) return;
    const free = step === 1 ? neighbours.next : neighbours.previous;
    if (!free) return;
    const panel = document.createElement("div");
    panel.className = "swipe-peek";
    panel.setAttribute("aria-hidden", "true");
    const html = peek(step);
    // No neighbour to show (back to a list): the screen slides off by itself.
    if (html === null) return;
    panel.innerHTML = html;
    const box = element.getBoundingClientRect();
    const first = element.querySelector<HTMLElement>(":scope > :not(.app-bar, .play-nav, .swipe-peek)");
    const firstTop = first ? first.getBoundingClientRect().top - box.top : 0;
    const bar = element.querySelector<HTMLElement>(":scope > .app-bar")?.getBoundingClientRect().bottom ?? 0;
    panel.style.top = `${Math.max(firstTop, Math.max(0, bar) - box.top + 12)}px`;
    panel.style.left = `${step * (box.width + PEEK_GAP)}px`;
    element.append(panel);
  };

  const start = (event: TouchEvent) => {
    if (mode === "leaving") return;
    mode = "off";
    if (event.touches.length !== 1 || root.closest("body")?.querySelector("dialog[open]")) return;
    startX = event.touches[0].clientX;
    startY = event.touches[0].clientY;
    // The left edge belongs to Back: the browser's, or the installed app's own.
    if (startX < 24) return;
    startTime = event.timeStamp;
    offset = 0;
    mode = "maybe";
  };
  const move = (event: TouchEvent) => {
    if (mode !== "maybe" && mode !== "drag") return;
    const dx = event.touches[0].clientX - startX;
    const dy = event.touches[0].clientY - startY;
    if (mode === "maybe") {
      if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) {
        mode = "off";
        return;
      }
      if (Math.abs(dx) < 10) return;
      mode = "drag";
      view()?.classList.remove("settling");
      view()?.classList.add("dragging");
    }
    // Past the first or last item it gives a little, like a rubber band.
    const free = dx < 0 ? neighbours.next : neighbours.previous;
    offset = free ? dx : dx * 0.25;
    showPeek(dx < 0 ? 1 : dx > 0 ? -1 : 0);
    view()?.style.setProperty("--drag", `${offset}px`);
  };
  const end = (event: TouchEvent) => {
    if (mode !== "drag") {
      if (mode !== "leaving") mode = "off";
      return;
    }
    mode = "off";
    const element = view();
    const step = offset < 0 ? 1 : -1;
    const free = step === 1 ? neighbours.next : neighbours.previous;
    const speed = Math.abs(offset) / Math.max(1, event.timeStamp - startTime);
    if (free && (Math.abs(offset) > window.innerWidth * 0.22 || (Math.abs(offset) > 30 && speed > 0.35))) {
      if (!element?.querySelector(".swipe-peek")) {
        // Leave it where the finger let go; the slide to the neighbour starts there.
        go(step);
        return;
      }
      // The neighbour slides all the way in, then takes the screen's place.
      mode = "leaving";
      element.classList.replace("dragging", "settling");
      element.style.setProperty("--drag", `${-step * (element.getBoundingClientRect().width + PEEK_GAP)}px`);
      window.setTimeout(() => {
        skipNextSlide();
        go(step);
      }, 230);
      return;
    }
    element?.classList.replace("dragging", "settling");
    element?.style.setProperty("--drag", "0px");
    window.setTimeout(() => {
      element?.classList.remove("settling");
      if (mode === "off") showPeek(0);
    }, 260);
  };
  root.addEventListener("touchstart", start, { passive: true });
  root.addEventListener("touchmove", move, { passive: true });
  root.addEventListener("touchend", end);
  root.addEventListener("touchcancel", end);
  return () => {
    root.removeEventListener("touchstart", start);
    root.removeEventListener("touchmove", move);
    root.removeEventListener("touchend", end);
    root.removeEventListener("touchcancel", end);
  };
}
