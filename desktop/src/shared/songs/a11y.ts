/**
 * Accessibility helpers (WCAG 2.2 AA; see the wiki's accessibility page):
 * page titles, a screen reader announcer, keeping focus where it was when a
 * screen redraws, and the arrow keys of a radio group.
 */

const APP_NAME = "PSA150";

/** "Amazing Grace · Songs · PSA150": most specific first, empty parts left out. */
export function pageTitle(...parts: Array<string | null | undefined>): string {
  return [...parts.map((part) => part?.trim()).filter(Boolean), APP_NAME].join(" · ");
}

export function setTitle(...parts: Array<string | null | undefined>): void {
  document.title = pageTitle(...parts);
}

/**
 * Tells a screen reader something without moving focus: a new key after
 * transposing, how many songs a search found. Visually hidden; the shell and
 * the room page each have one (`#announcer`).
 */
export function announce(text: string): void {
  const region = document.querySelector<HTMLElement>("#announcer");
  if (!region || !text) return;
  // The same words twice in a row are still read when the text changes.
  region.textContent = region.textContent === text ? `${text}\u00a0` : text;
}

/**
 * Where an arrow key moves in a radio group of `count` options from `index`:
 * Right and Down go to the next option, Left and Up to the previous, both
 * wrapping; Home and End go to the ends. Null for any other key.
 */
export function nextRadioIndex(key: string, index: number, count: number): number | null {
  if (count <= 0) return null;
  switch (key) {
    case "ArrowRight":
    case "ArrowDown":
      return (index + 1) % count;
    case "ArrowLeft":
    case "ArrowUp":
      return (index - 1 + count) % count;
    case "Home":
      return 0;
    case "End":
      return count - 1;
    default:
      return null;
  }
}

/**
 * A segmented control with `role="radiogroup"` and `role="radio"` buttons:
 * one tab stop (the checked option), arrow keys move and choose, as in the
 * ARIA radio group pattern. Choosing clicks the button, so the view's own
 * click handler does the work.
 */
export function bindRadioGroup(group: HTMLElement): void {
  const radios = () => Array.from(group.querySelectorAll<HTMLElement>('[role="radio"]'));
  const sync = () => {
    const all = radios();
    const checked = all.find((radio) => radio.getAttribute("aria-checked") === "true") ?? all[0];
    all.forEach((radio) => { radio.tabIndex = radio === checked ? 0 : -1; });
  };
  sync();
  group.addEventListener("click", () => queueMicrotask(sync));
  group.addEventListener("keydown", (event) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const all = radios();
    const index = all.indexOf(event.target as HTMLElement);
    const next = index < 0 ? null : nextRadioIndex(event.key, index, all.length);
    if (next === null) return;
    event.preventDefault();
    all[next].focus();
    all[next].click();
  });
}

/** Attributes that tell which control an element is, in order of preference. */
const KEY_ATTRIBUTES = /^(data-[a-z-]+|href|name|aria-controls)$/;

/** A CSS attribute value in double quotes. */
function quote(value: string): string {
  return `"${value.replace(/["\\]/g, "\\$&")}"`;
}

/**
 * A selector that finds "the same control" after a redraw: by id, else by
 * its first identifying attribute (`data-act="up"`, `href="#/songs/…"`),
 * inside the row it belongs to (`data-key`). Null when nothing identifies it.
 */
export function focusSelector(target: {
  tag: string;
  id?: string;
  attributes: Array<[string, string]>;
  scopeKey?: string | null;
}): string | null {
  if (target.id) return `#${target.id.replace(/[^\w-]/g, (character) => `\\${character}`)}`;
  const attribute = target.attributes.find(([name]) => KEY_ATTRIBUTES.test(name) && name !== "data-key");
  if (!attribute) return null;
  const own = `${target.tag.toLowerCase()}[${attribute[0]}=${quote(attribute[1])}]`;
  return target.scopeKey ? `[data-key=${quote(target.scopeKey)}] ${own}` : own;
}

/** `focusSelector` for an element on the page. */
export function selectorFor(element: Element | null): string | null {
  if (!element || element === document.body || element === document.documentElement) return null;
  return focusSelector({
    tag: element.tagName,
    id: element.id,
    attributes: Array.from(element.attributes).map((attribute) => [attribute.name, attribute.value]),
    scopeKey: element.closest<HTMLElement>("[data-key]")?.dataset.key ?? null,
  });
}

/**
 * Focuses the element `selector` names inside `root`, if it is there and
 * can take focus; else `fallback`. Does not scroll unless it has to.
 */
export function refocus(root: ParentNode, selector: string | null, fallback?: () => HTMLElement | null | undefined): boolean {
  let target: HTMLElement | null = null;
  if (selector) {
    try {
      target = root.querySelector<HTMLElement>(selector);
    } catch {
      target = null;
    }
  }
  if (!target || (target as HTMLButtonElement).disabled || target.closest("[hidden],[inert]")) target = fallback?.() ?? null;
  if (!target) return false;
  target.focus({ preventScroll: true });
  // A control the redraw moved out of view comes back into it.
  if (document.activeElement === target) target.scrollIntoView({ block: "nearest" });
  return document.activeElement === target;
}

/**
 * Runs `render`, which replaces part of the page, and puts focus back on the
 * same control if it was inside `root`: a live update or a tap on a button
 * that redraws the screen must not drop a keyboard or screen reader user
 * back at the top of the page.
 */
export function keepFocus(root: HTMLElement, render: () => void, fallback?: () => HTMLElement | null | undefined): void {
  const active = document.activeElement;
  const inside = Boolean(active && active !== document.body && root.contains(active));
  const selector = inside ? selectorFor(active) : null;
  render();
  if (inside && !root.contains(document.activeElement)) refocus(root, selector, fallback);
}
