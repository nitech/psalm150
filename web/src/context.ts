import type { SongServerApi } from "./api.ts";
import type { CurrentSet } from "./current-set.ts";
import type { Favorites } from "./favorites.ts";
import type { Live } from "./live.ts";
import { icon } from "./icons.ts";
import type { Session } from "./types.ts";
import { escapeHtml } from "./ui.ts";

/**
 * What the song list and reader get from the shell. A visitor to a public
 * library has no session; every other screen gets an `AppContext`.
 */
export interface LibraryContext {
  api: SongServerApi;
  session: Session | null;
  /** The church whose songs these are. */
  libraryName: string;
  /** Anyone may read the songs without signing in. */
  isPublic: boolean;
  /** Tell the shell that an owner opened or closed the library. */
  setPublic(value: boolean): void;
  /** Owners and leaders change songs and sets and steer desktops. */
  canEdit: boolean;
  /** The set this phone adds songs to (see `current-set.ts`). */
  currentSet: CurrentSet;
  /** The signed-in person's favourite songs (none for a visitor). */
  favorites: Favorites;
  /** Following, leading and controlling the projector (live.ts). */
  live: Live;
  /** The screen's container; a view owns its contents. */
  main: HTMLElement;
  /** Go to a route such as `#/sets/…`; `replace` keeps history short. */
  navigate(route: string, replace?: boolean): void;
  /**
   * Runs an action with error toasts; 401 signs out. By default one action
   * runs at a time; `exclusive: false` lets quick taps (adding songs) overlap.
   */
  run(action: () => Promise<void>, options?: { exclusive?: boolean }): Promise<void>;
  signOut(): void;
  /**
   * Reads the role, name and church again from the server (at most once a
   * minute unless `force`), so a role an owner changed applies without
   * signing in again. The current screen is redrawn when something changed.
   */
  refreshSession(force?: boolean): Promise<void>;
  /** Re-reads the theme preference and applies it. */
  applyTheme(): void;
}

/** What every signed-in screen gets from the shell. */
export interface AppContext extends LibraryContext {
  session: Session;
}

/** A view renders into `ctx.main` and may return a cleanup (timers, listeners). */
export type Cleanup = () => void;
export type View = (ctx: AppContext, params: string[]) => Promise<Cleanup | void>;
/** A view that visitors to a public library may also open. */
export type LibraryView = (ctx: LibraryContext, params: string[]) => Promise<Cleanup | void>;

/**
 * The page's top: a sticky bar (back, actions, and the title once the large
 * title has scrolled away) above a large title that scrolls with the page.
 * `panel` is extra content that drops down from the bar, such as the reader
 * settings. `autohide` slides the bar away while reading downwards.
 */
export function pageHead(options: {
  title: string;
  subtitle?: string;
  back?: string;
  actions?: string;
  panel?: string;
  autohide?: boolean;
  /** The church's name above the title; left out on phones, where room is short. */
  church?: string;
  /** On phones the title sits in the bar and the large title is left out. */
  compact?: boolean;
  /** No header at all on phones, for screens whose own content starts the page. */
  wideOnly?: boolean;
  /** A section's top screen: ☰ opens the sections drawer on phones (in place of Back). */
  menu?: boolean;
  /** The screen shows its own title (the song editor): the heading stays for screen readers only. */
  quietTitle?: boolean;
}): string {
  const eyebrow = options.subtitle
    ? `<p class="eyebrow">${escapeHtml(options.subtitle)}</p>`
    : options.church ? `<p class="eyebrow wide-only">${escapeHtml(options.church)}</p>` : "";
  // The h1 takes focus after a route change (main.ts). On phones a compact
  // or wide-only title is hidden visually but stays for screen readers.
  const titles = `<div class="page-titles${options.compact ? " compact" : ""}${options.wideOnly ? " wide-only" : ""}${options.quietTitle ? " quiet" : ""}">
      ${eyebrow}
      <h1 tabindex="-1">${escapeHtml(options.title)}</h1>
    </div>`;
  if (!options.back && !options.actions && !options.panel && !options.compact && !options.menu) return titles;
  const back = options.back
    ? `<a class="icon-button ghost bar-back" href="${options.back}" aria-label="Back">${icon("back")}<span class="bar-back-text" aria-hidden="true">Back</span></a>`
    : options.menu ? menuButton() : "";
  // On wide screens the rail replaces ☰, so a bar with nothing else goes.
  const menuOnly = options.menu && !options.back && !options.actions && !options.panel;
  // A compact screen under another (with Back) has a plain bar title.
  return `<header class="app-bar${options.autohide ? " autohide" : ""}${options.compact ? " compact" : ""}${options.compact && options.back ? " sub" : ""}${menuOnly ? " menu-only" : ""}">
      <div class="app-bar-row">
        ${back}
        <p class="bar-title" aria-hidden="true">${escapeHtml(options.title)}</p>
        <div class="page-actions">${options.actions ?? ""}</div>
      </div>
      ${options.panel ?? ""}
    </header>
    ${titles}`;
}

/** ☰: opens the sections drawer on phones (main.ts); hidden on wide screens. */
export function menuButton(): string {
  return `<button type="button" class="icon-button ghost menu-button" data-menu aria-label="Menu" aria-controls="sections" aria-expanded="false">${icon("menu")}</button>`;
}

export function emptyState(title: string, copy: string): string {
  return `<div class="empty-state"><h2>${escapeHtml(title)}</h2><p>${escapeHtml(copy)}</p></div>`;
}

/** Query parameters of the current hash route (`#/sets/new?song=…`). */
export function routeQuery(): URLSearchParams {
  const hash = location.hash;
  const index = hash.indexOf("?");
  return new URLSearchParams(index >= 0 ? hash.slice(index + 1) : "");
}
