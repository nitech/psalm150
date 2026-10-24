/**
 * The actions in a screen's top bar: a few **fixed** icons that are always
 * there, a ⋮ menu with every other action (icon and text), and **frequent**
 * icons: a menu action used often lately also shows in the bar, after a thin
 * divider, until it falls out of use again. Like a phone that puts the apps
 * you use most first.
 *
 * Each action is a button (or a link) with `data-action="<id>"`, in the bar
 * and in the menu alike, so the screen handles both with one click handler.
 */
import { icon, type IconName } from "./icons.ts";
import { escapeHtml, readPreference, writePreference } from "./ui.ts";

export interface BarAction {
  id: string;
  label: string;
  icon: IconName;
  /** Always in the bar; the others are in the menu. */
  fixed?: boolean;
  /** A link instead of a button. */
  href?: string;
  /** An on/off action: the menu shows it as a checkbox item. */
  checked?: boolean;
  /**
   * Shows the on/off action as a switch in the menu, which stays open so the
   * switch is seen to flip. The screen updates it with `setSwitch`.
   */
  switch?: boolean;
  /** Extra classes and attributes for the bar button. */
  className?: string;
  attributes?: string;
  /**
   * A − value + control instead of a button (transpose): `value` sits
   * between the two (the key), `spoken` names it for screen readers. The
   * steps are the actions `<id>-down` and `<id>-up`; a step in the menu
   * leaves the menu open.
   */
  stepper?: { value: string; spoken: string };
}

/** Uses that count fade by half over this many days. */
const HALF_LIFE_DAYS = 14;
/** A menu action this used lately shows in the bar… */
export const PROMOTE_AT = 3;
/** …and stays there until its uses fade below this. */
export const DEMOTE_AT = 1.5;
/** Frequent icons in the bar at most, on top of the fixed ones. */
export const MAX_FREQUENT = 2;

export interface Usage {
  /** Uses, faded by age. */
  score: number;
  /** When it was last used (ms). */
  at: number;
  /** Shown in the bar now. */
  shown?: boolean;
}

export type UsageMap = Record<string, Usage>;

/** A use's weight `days` after it was counted. */
export function faded(usage: Usage, now: number): number {
  const days = Math.max(0, now - usage.at) / 86_400_000;
  return usage.score * 0.5 ** (days / HALF_LIFE_DAYS);
}

/** Count one use of `id`. */
export function recordUse(usage: UsageMap, id: string, now: number): UsageMap {
  const current = usage[id];
  return { ...usage, [id]: { ...current, score: (current ? faded(current, now) : 0) + 1, at: now } };
}

/**
 * The menu actions to show in the bar: the most used, reaching
 * `PROMOTE_AT` (or still above `DEMOTE_AT` once shown), at most
 * `MAX_FREQUENT`. Updates each action's `shown`.
 */
export function frequent(usage: UsageMap, ids: string[], now: number, max = MAX_FREQUENT): string[] {
  const ranked = ids
    .map((id) => ({ id, usage: usage[id], score: usage[id] ? faded(usage[id], now) : 0 }))
    // A little slack: uses a moment apart have already faded a hair.
    .filter(({ usage: u, score }) => u && score >= (u.shown ? DEMOTE_AT : PROMOTE_AT) - 0.01)
    .sort((a, b) => b.score - a.score)
    .slice(0, max)
    .map(({ id }) => id);
  for (const id of ids) {
    if (usage[id]) usage[id].shown = ranked.includes(id);
  }
  // Keep the bar's order steady: the menu's order, not the scores'.
  return ids.filter((id) => ranked.includes(id));
}

function readUsage(screen: string): UsageMap {
  try {
    return JSON.parse(readPreference(`bar-usage-${screen}`) ?? "{}") as UsageMap;
  } catch {
    return {};
  }
}

function writeUsage(screen: string, usage: UsageMap): void {
  writePreference(`bar-usage-${screen}`, JSON.stringify(usage));
}

function stepButtons(action: BarAction, inMenu: boolean): [string, string] {
  const step = (way: "down" | "up") => {
    const label = `${action.label} ${way}`;
    const menuAttrs = inMenu ? ` role="menuitem" tabindex="-1"` : "";
    return `<button type="button" class="bar-step" data-action="${action.id}-${way}" data-usage="${action.id}" data-keep-open aria-label="${escapeHtml(label)}" title="${escapeHtml(label)}"${menuAttrs}>${icon(way === "down" ? "minus" : "plus")}</button>`;
  };
  return [step("down"), step("up")];
}

function barButton(action: BarAction, frequentOne: boolean): string {
  if (action.stepper) {
    const [down, up] = stepButtons(action, false);
    const label = `${action.label}, ${action.stepper.spoken}`;
    return `<span class="bar-stepper${frequentOne ? " frequent" : ""}" role="group" aria-label="${escapeHtml(label)}" title="${escapeHtml(frequentOne ? `${action.label} (often used)` : action.label)}">${down}<span class="bar-stepper-value" aria-hidden="true">${escapeHtml(action.stepper.value)}</span>${up}</span>`;
  }
  const title = frequentOne ? `${action.label} (often used)` : action.label;
  const classes = `icon-button ghost${frequentOne ? " frequent" : ""}${action.className ? ` ${action.className}` : ""}`;
  const pressed = action.checked === undefined ? "" : ` aria-pressed="${action.checked}"`;
  const attributes = `data-action="${action.id}" class="${classes}" aria-label="${escapeHtml(action.label)}" title="${escapeHtml(title)}"${pressed} ${action.attributes ?? ""}`;
  return action.href
    ? `<a href="${action.href}" ${attributes}>${icon(action.icon)}</a>`
    : `<button type="button" ${attributes}>${icon(action.icon)}</button>`;
}

function menuItem(action: BarAction): string {
  if (action.stepper) {
    // Two places to tap: − and +, the key between them.
    const [down, up] = stepButtons(action, true);
    return `<div class="bar-menu-item bar-menu-stepper" role="group" aria-label="${escapeHtml(`${action.label}, ${action.stepper.spoken}`)}">${icon(action.icon)}<span>${escapeHtml(action.label)}</span>${down}<span class="bar-stepper-value" aria-hidden="true">${escapeHtml(action.stepper.value)}</span>${up}</div>`;
  }
  const role = action.checked === undefined ? `role="menuitem"` : `role="menuitemcheckbox" aria-checked="${action.checked}"`;
  if (action.switch) {
    return `<button type="button" ${role} tabindex="-1" class="bar-menu-item bar-menu-switch" data-action="${action.id}" data-keep-open>${icon(action.icon)}<span>${escapeHtml(action.label)}</span><span class="switch-track" aria-hidden="true"><span class="switch-thumb"></span></span></button>`;
  }
  const check = action.checked === undefined ? "" : `<span class="bar-menu-check" aria-hidden="true">${action.checked ? icon("check") : ""}</span>`;
  const inner = `${icon(action.icon)}<span>${escapeHtml(action.label)}</span>${check}`;
  return action.href
    ? `<a ${role} tabindex="-1" class="bar-menu-item" data-action="${action.id}" href="${action.href}">${inner}</a>`
    : `<button type="button" ${role} tabindex="-1" class="bar-menu-item" data-action="${action.id}">${inner}</button>`;
}

/**
 * The bar's actions as HTML: the fixed icons, a divider and the frequent
 * icons, and ⋮ with the menu. `screen` keeps each screen's usage apart.
 */
/** `maxFrequent`: fewer frequent icons for a bar that already has many fixed ones. */
export function barActions(screen: string, actions: BarAction[], maxFrequent = MAX_FREQUENT): string {
  const inMenu = actions.filter((action) => !action.fixed);
  const usage = readUsage(screen);
  const shown = frequent(usage, inMenu.map((action) => action.id), Date.now(), maxFrequent);
  writeUsage(screen, usage);
  const often = inMenu.filter((action) => shown.includes(action.id));
  const fixed = actions.filter((action) => action.fixed);
  // Fixed icons first; the frequent ones sit by ⋮, where they come from,
  // behind a thin divider.
  return `<div class="bar-actions" data-bar-screen="${screen}">
    ${fixed.map((action) => barButton(action, false)).join("")}
    ${often.length ? `<span class="bar-divider" aria-hidden="true"></span><span class="bar-frequent">${often.map((action) => barButton(action, true)).join("")}</span>` : ""}
    ${inMenu.length ? `<button type="button" class="icon-button ghost bar-more" aria-haspopup="menu" aria-expanded="false" aria-label="More actions" title="More actions">${icon("more")}</button>
    <div class="bar-menu" role="menu" aria-label="More actions" hidden>${inMenu.map(menuItem).join("")}</div>` : ""}
  </div>`;
}

/**
 * Flips a switch action in place, in the menu and in the bar (when it is
 * used often enough to sit there), so the open menu is not redrawn.
 */
export function setSwitch(root: HTMLElement, actionId: string, on: boolean): void {
  root.querySelectorAll<HTMLElement>(`.bar-actions [data-action="${actionId}"]`).forEach((element) => {
    if (element.closest(".bar-menu")) element.setAttribute("aria-checked", String(on));
    else {
      element.setAttribute("aria-pressed", String(on));
      element.classList.toggle("on", on);
    }
  });
}

/**
 * Opens the menu again after the screen redrew its bar (a transpose step in
 * the menu), with focus back on the control that was pressed.
 */
export function reopenMenu(root: HTMLElement, actionId: string): void {
  const list = root.querySelector<HTMLElement>(".bar-menu");
  if (!list) return;
  list.hidden = false;
  root.querySelector(".bar-more")?.setAttribute("aria-expanded", "true");
  list.querySelector<HTMLElement>(`[data-action="${actionId}"]`)?.focus();
}

/**
 * Opens and closes the menu (click, Escape, arrows, a click outside) and
 * counts the uses of menu actions, wherever they were picked. Returns a
 * cleanup for the screen's own cleanup.
 */
export function bindBarActions(root: HTMLElement): () => void {
  const menu = () => root.querySelector<HTMLElement>(".bar-menu");
  const more = () => root.querySelector<HTMLButtonElement>(".bar-more");
  const items = () => [...(menu()?.querySelectorAll<HTMLElement>(".bar-menu-item:not(.bar-menu-stepper), .bar-menu .bar-step") ?? [])];
  const close = (refocus: boolean) => {
    const list = menu();
    if (!list || list.hidden) return;
    list.hidden = true;
    more()?.setAttribute("aria-expanded", "false");
    if (refocus) more()?.focus();
  };
  const open = () => {
    const list = menu();
    if (!list) return;
    list.hidden = false;
    more()?.setAttribute("aria-expanded", "true");
    items()[0]?.focus();
  };

  const onClick = (event: Event) => {
    const target = event.target as HTMLElement;
    if (target.closest(".bar-more")) {
      if (menu()?.hidden) open();
      else close(false);
      return;
    }
    const action = target.closest<HTMLElement>("[data-action]");
    const bar = action?.closest<HTMLElement>("[data-bar-screen]");
    if (action && bar) {
      const screen = bar.dataset.barScreen!;
      const inMenu = Boolean(action.closest(".bar-menu"));
      const isMenuAction = inMenu || Boolean(action.closest(".frequent"));
      const id = action.dataset.usage ?? action.dataset.action!;
      if (isMenuAction) writeUsage(screen, recordUse(readUsage(screen), id, Date.now()));
      if (!(inMenu && action.hasAttribute("data-keep-open"))) close(false);
      return;
    }
    if (!target.closest(".bar-menu")) close(false);
  };
  const onKey = (event: KeyboardEvent) => {
    const list = menu();
    if (!list || list.hidden) return;
    if (event.key === "Escape") {
      event.preventDefault();
      close(true);
      return;
    }
    const all = items();
    const index = all.indexOf(document.activeElement as HTMLElement);
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      all[(index + step + all.length) % all.length]?.focus();
    } else if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      all[event.key === "Home" ? 0 : all.length - 1]?.focus();
    } else if (event.key === "Tab") {
      close(false);
    }
  };
  const onOutside = (event: Event) => {
    if (!root.querySelector(".bar-actions")?.contains(event.target as Node)) close(false);
  };
  root.addEventListener("click", onClick);
  root.addEventListener("keydown", onKey);
  document.addEventListener("pointerdown", onOutside);
  return () => {
    root.removeEventListener("click", onClick);
    root.removeEventListener("keydown", onKey);
    document.removeEventListener("pointerdown", onOutside);
  };
}
