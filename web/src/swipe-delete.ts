/**
 * Swipe a row to the left to delete it, on touch screens (with a mouse the
 * row's own remove button is shown instead). The row slides aside over a red
 * Delete button: let go past a little and it stays open, so a tap on Delete
 * deletes; swipe on past `FULL` of the row's width and it deletes by itself.
 * A tap anywhere else closes an open row.
 *
 * Rows are `[data-swipe-row]` elements holding a `.swipe-content` (what
 * slides) and a `.swipe-delete` button. `onDelete(row)` runs once the row
 * has slid away and folded up.
 */

/** How far an open row stays slid aside, uncovering Delete. */
const OPEN = 88;
/** Past this share of the row's width, letting go deletes. */
const FULL = 0.55;

/** A row's inside for `bindSwipeDelete`; `className` goes on what slides. */
export function swipeRow(content: string, label: string, className = ""): string {
  return `<div class="swipe-content${className ? ` ${className}` : ""}">${content}</div><button type="button" class="swipe-delete" tabindex="-1" aria-hidden="true" data-swipe-delete>${label}</button>`;
}

export function bindSwipeDelete(list: HTMLElement, onDelete: (row: HTMLElement) => void): () => void {
  let row: HTMLElement | null = null;
  let open: HTMLElement | null = null;
  let startX = 0;
  let startY = 0;
  let base = 0;
  let offset = 0;
  let mode: "off" | "maybe" | "drag" = "off";

  const place = (element: HTMLElement, x: number, animate: boolean) => {
    element.classList.toggle("swipe-settling", animate);
    element.style.setProperty("--swipe", `${x}px`);
    element.classList.toggle("swipe-open", x < 0);
    element.classList.toggle("swipe-full", -x > element.offsetWidth * FULL);
  };
  const close = (element: HTMLElement | null) => {
    if (!element) return;
    place(element, 0, true);
    if (open === element) open = null;
  };
  /** Slides the row away, folds it up, then deletes it. */
  const remove = (element: HTMLElement) => {
    open = null;
    element.classList.add("swipe-leaving");
    place(element, -element.offsetWidth, true);
    element.style.height = `${element.offsetHeight}px`;
    void element.offsetHeight;
    element.classList.add("swipe-folding");
    element.style.height = "0px";
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      onDelete(element);
    };
    element.addEventListener("transitionend", (event) => { if (event.propertyName === "height") finish(); });
    window.setTimeout(finish, 420);
  };

  const start = (event: TouchEvent) => {
    mode = "off";
    const target = event.target as HTMLElement;
    const touched = target.closest<HTMLElement>("[data-swipe-row]");
    // A tap outside the open row (or on its content) closes it.
    if (open && open !== touched) close(open);
    if (!touched || event.touches.length !== 1 || target.closest("[data-grip], .swipe-delete")) return;
    row = touched;
    startX = event.touches[0].clientX;
    startY = event.touches[0].clientY;
    // The left edge belongs to Back.
    if (startX < 24) return;
    base = open === row ? -OPEN : 0;
    offset = base;
    mode = "maybe";
  };
  const move = (event: TouchEvent) => {
    if (mode === "off" || !row) return;
    const dx = event.touches[0].clientX - startX;
    const dy = event.touches[0].clientY - startY;
    if (mode === "maybe") {
      if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) {
        mode = "off";
        return;
      }
      if (Math.abs(dx) < 10) return;
      mode = "drag";
      row.classList.add("swipe-dragging");
    }
    if (event.cancelable) event.preventDefault();
    // Not past closed to the right; a little give if tried.
    const x = base + dx;
    offset = x > 0 ? x * 0.2 : x;
    place(row, offset, false);
  };
  const end = () => {
    if (mode !== "drag" || !row) {
      mode = "off";
      return;
    }
    mode = "off";
    const element = row;
    element.classList.remove("swipe-dragging");
    if (-offset > element.offsetWidth * FULL) {
      remove(element);
    } else if (-offset > OPEN / 2) {
      place(element, -OPEN, true);
      open = element;
    } else {
      close(element);
    }
  };
  const click = (event: Event) => {
    const button = (event.target as HTMLElement).closest<HTMLElement>("[data-swipe-delete]");
    const element = button?.closest<HTMLElement>("[data-swipe-row]");
    if (element) {
      event.preventDefault();
      remove(element);
      return;
    }
    // A tap on an open row's content closes it rather than opening the song.
    const tapped = (event.target as HTMLElement).closest<HTMLElement>("[data-swipe-row]");
    if (tapped && tapped.classList.contains("swipe-open")) {
      event.preventDefault();
      event.stopPropagation();
      close(tapped);
    }
  };

  list.addEventListener("touchstart", start, { passive: true });
  list.addEventListener("touchmove", move, { passive: false });
  list.addEventListener("touchend", end);
  list.addEventListener("touchcancel", end);
  list.addEventListener("click", click, true);
  const outside = (event: Event) => {
    if (open && !open.contains(event.target as Node)) close(open);
  };
  document.addEventListener("touchstart", outside, { passive: true });
  return () => {
    list.removeEventListener("touchstart", start);
    list.removeEventListener("touchmove", move);
    list.removeEventListener("touchend", end);
    list.removeEventListener("touchcancel", end);
    list.removeEventListener("click", click, true);
    document.removeEventListener("touchstart", outside);
  };
}
