import type { SongServerApi } from "./api.ts";
import { icon } from "./icons.ts";
import type { Session } from "./types.ts";
import { escapeHtml } from "./ui.ts";

/** What every screen gets from the shell. */
export interface AppContext {
  api: SongServerApi;
  session: Session;
  /** Owners and leaders change songs and sets and steer desktops. */
  canEdit: boolean;
  /** The screen's container; a view owns its contents. */
  main: HTMLElement;
  /** Go to a route such as `#/sets/…`; `replace` keeps history short. */
  navigate(route: string, replace?: boolean): void;
  /** Runs an action with the busy state and error toasts; 401 signs out. */
  run(action: () => Promise<void>): Promise<void>;
  signOut(): void;
  /** Re-reads the theme preference and applies it. */
  applyTheme(): void;
}

/** A view renders into `ctx.main` and may return a cleanup (timers, listeners). */
export type Cleanup = () => void;
export type View = (ctx: AppContext, params: string[]) => Promise<Cleanup | void>;

export function pageHead(options: {
  title: string;
  subtitle?: string;
  back?: string;
  actions?: string;
}): string {
  const back = options.back
    ? `<a class="icon-button" href="${options.back}" aria-label="Back">${icon("back")}</a>`
    : "";
  return `<header class="page-head">
    ${back}
    <div class="page-titles">
      ${options.subtitle ? `<p class="eyebrow">${escapeHtml(options.subtitle)}</p>` : ""}
      <h1>${escapeHtml(options.title)}</h1>
    </div>
    <div class="page-actions">${options.actions ?? ""}</div>
  </header>`;
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
