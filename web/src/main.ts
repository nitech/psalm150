import "../../shared/psa150-tokens.css";
import "../../shared/songs/song-controls.css";
import "./styles.css";
import "../../shared/songs/songs.css";
import { announce, refocus, selectorFor, setTitle } from "../../shared/songs/a11y.ts";
import { ApiError, SongServerApi } from "./api.ts";
import type { Cleanup, LibraryContext, LibraryView, View } from "./context.ts";
import { CurrentSet } from "./current-set.ts";
import { Favorites } from "./favorites.ts";
import { installFollow } from "./follow.ts";
import { installLive, type Live } from "./live.ts";
import { icon, type IconName } from "./icons.ts";
import { installLyricsCopy } from "./song-render.ts";
import { installChordViewer } from "../../shared/songs/chord-viewer.ts";
import { setSongHost } from "../../shared/songs/host.ts";
import { holdScreen } from "./wake-lock.ts";
import { appGoesBack, installedApp, slideBetween, swapScreen, takeBrowserAnimated } from "./transitions.ts";
import "./install.ts";
import type { SessionInfo, SetDetail, Session } from "./types.ts";
import { dateBadge, errorMessage, escapeHtml, hideToast, installSearchClear, readPreference, setFormBusy, showToast } from "./ui.ts";
import { settingsHref, settingsPages, settingsView } from "./views/settings.ts";
import { peopleView } from "./views/people.ts";
import { apiDocs } from "./views/api-docs.ts";
import { remoteDesktop, remoteList } from "./views/remote.ts";
import { accountLinkPath, renderAccountLink } from "./views/account-link.ts";
import { joinPath, renderJoin, renderRoomFromPath } from "./views/room.ts";
import { setDetail, setEditor, setList, setPlay } from "./views/sets.ts";
import { renderSharedSet, sharedSetPath } from "./views/shared-set.ts";
import { songDetail, songEditor, songList } from "./views/songs.ts";
import { findChords } from "./views/find-chords.ts";

const app = document.querySelector<HTMLDivElement>("#app")!;
if (!app) throw new Error("Application mount point is missing");

const SESSION_KEY = "psa150-server-session";
let session = readSession();
/** The church whose library anyone may read, from `/info`; null when private. */
let publicLibrary: string | null = null;
/** Anyone may follow a desktop's projection by its room name (`/join`). */
let roomsOpen = false;
let busy = false;
/** When the session's role and names were last read from the server. */
let lastSessionCheck = 0;
const api = new SongServerApi(() => session?.token ?? null);
const currentSet = new CurrentSet(api);
const favorites = new Favorites(api);
/** Following the projector from the dock's card (signed in only). */
const follow = installFollow(api, () => live?.draw());
/** Following, leading and controlling the projector, behind the dock's Live card. */
let live: Live | null = null;
live = installLive({
  api,
  follow,
  currentSet,
  canLead: () => Boolean(session && canEditSets()),
});
/** The first load of the current set, so the first screen can show it. */
let currentReady: Promise<unknown> = Promise.resolve();
/**
 * Someone has pressed a key or touched the page. Until then focus is left
 * alone, so a screen reader starts reading the first page at its top.
 */
let userActed = false;
for (const type of ["keydown", "pointerdown"]) {
  document.addEventListener(type, () => { userActed = true; }, { capture: true, once: true });
}

applyTheme();
registerServiceWorker();
setSongHost({ toast: (message, options) => showToast(message, options), holdScreen });
installLyricsCopy();
installChordViewer();
installSearchClear();
openPermalink();

/**
 * Permalinks are real paths (`/songs/{id}`, which the server answers with
 * this app) so the server sees which song a link is for. Routing happens in
 * the hash, so move there.
 */
function openPermalink(): void {
  const song = /^\/songs\/([0-9a-f-]{36})\/?$/i.exec(location.pathname);
  if (song) history.replaceState(null, "", `/#/songs/${song[1].toLowerCase()}`);
  if (/^\/api\/docs\/?$/.test(location.pathname)) history.replaceState(null, "", "/#/api");
}

/**
 * A desktop asking to be connected through the browser. The desktop opens
 * `/?desktop_redirect=…&state=…&code_challenge=…&device_name=…`; after the
 * person approves, the browser returns to the desktop's loopback URL with a
 * one-time code (or `error=access_denied`).
 */
interface DesktopRequest {
  redirect: URL;
  state: string;
  codeChallenge: string;
  deviceName: string;
}

const desktopRequest = readDesktopRequest();

void boot();

async function boot(): Promise<void> {
  try {
    if (desktopRequest === "invalid") {
      renderDesktopInvalid();
      return;
    }
    // Following a room needs no account, signed in or not.
    const room = joinPath();
    if (room !== null) {
      if (room) await renderRoomFromPath(app, api, room);
      else renderJoin(app, api);
      return;
    }
    // So does a set shared on a link.
    const shared = sharedSetPath();
    if (shared) {
      await renderSharedSet(app, api, shared);
      return;
    }
    // And an invite or reset link, which ends in a session.
    const link = accountLinkPath();
    if (link) {
      await renderAccountLink(app, api, link, (next) => {
        // Whoever was signed in on this phone before gives way.
        endSession();
        session = next;
        storeSession(next);
        location.replace("/#/songs");
      });
      return;
    }
    const info = await api.info();
    publicLibrary = info.public_library ? info.public_library_name ?? "Song library" : null;
    roomsOpen = info.rooms;
    if (!info.initialized) {
      renderSetup();
    } else if (!session || new Date(session.expires_at) <= new Date()) {
      clearSession();
      // A public library opens on its songs; a desktop asking to connect
      // still needs someone to sign in.
      if (publicLibrary && !pendingDesktop()) renderShell();
      else renderLogin();
    } else {
      showSignedIn();
      void refreshSession();
    }
  } catch (error) {
    renderFatal(error);
  }
}

function renderSetup(): void {
  setTitle("Set up");
  app.innerHTML = authFrame(
    "Set up your song server",
    "Create your church and the first owner account. The songs stay on this server, under your church's care.",
    `<form class="stack" id="setup-form">
      <label>Church name<input name="church" autocomplete="organization" required /></label>
      <label>Your name<input name="owner" autocomplete="name" required /></label>
      <label>Username<input name="username" autocomplete="username" autocapitalize="none" required /></label>
      <label>Password<input name="password" type="password" minlength="10" autocomplete="new-password" aria-describedby="setup-password-hint" required /></label>
      <p class="hint field-hint" id="setup-password-hint">At least 10 characters.</p>
      <button class="button primary wide" type="submit">Create the library</button>
      <p class="form-message" role="status"></p>
    </form>`,
  );
  focusAuth();

  document.querySelector<HTMLFormElement>("#setup-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget as HTMLFormElement;
    const data = new FormData(form);
    await submitAuth(form, async () => api.setup({
      church_name: String(data.get("church")),
      owner_name: String(data.get("owner")),
      username: String(data.get("username")),
      password: String(data.get("password")),
    }));
  });
}

function renderLogin(): void {
  const desktop = pendingDesktop();
  setTitle("Sign in");
  app.innerHTML = authFrame(
    "Sign in",
    desktop
      ? `Sign in to connect <strong>${escapeHtml(desktop.deviceName)}</strong> to this song server.`
      : "Your church's songs and sets, on any device.",
    `<form class="stack" id="login-form">
      <label>Username<input name="username" autocomplete="username" autocapitalize="none" required autofocus /></label>
      <label>Password<input name="password" type="password" autocomplete="current-password" required /></label>
      <button class="button primary wide" type="submit">Sign in</button>
      <p class="form-message" role="status"></p>
      ${publicLibrary && !desktop ? `<button class="button secondary wide" type="button" id="back-to-songs">Back to the songs</button>` : ""}
      ${roomsOpen && !desktop ? `<a class="button secondary wide" href="/join">Follow the words in a room</a>` : ""}
    </form>`,
  );
  focusAuth();

  document.querySelector("#back-to-songs")?.addEventListener("click", () => {
    // The page behind the sign-in may be one only members can open.
    if (!visitorRoute(currentPath())) history.replaceState(null, "", "#/songs");
    renderShell();
  });
  document.querySelector<HTMLFormElement>("#login-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget as HTMLFormElement;
    const data = new FormData(form);
    await submitAuth(form, () => api.login(String(data.get("username")), String(data.get("password"))));
  });
}

async function submitAuth(form: HTMLFormElement, action: () => Promise<Session>): Promise<void> {
  const message = form.querySelector<HTMLElement>(".form-message");
  setFormBusy(form, true);
  try {
    session = await action();
    storeSession(session);
    lastSessionCheck = Date.now();
    showSignedIn();
  } catch (error) {
    if (message) message.textContent = errorMessage(error);
  } finally {
    setFormBusy(form, false);
  }
}

function showSignedIn(): void {
  if (pendingDesktop()) {
    renderDesktopConsent();
  } else {
    renderShell();
  }
}

function readDesktopRequest(): DesktopRequest | "invalid" | null {
  const params = new URLSearchParams(location.search);
  const target = params.get("desktop_redirect");
  if (target === null) return null;
  let redirect: URL;
  try {
    redirect = new URL(target);
  } catch {
    return "invalid";
  }
  // Only hand codes to a loopback listener on this computer, never to a
  // remote site that crafted the link.
  const loopback = ["127.0.0.1", "localhost", "[::1]"].includes(redirect.hostname);
  if (redirect.protocol !== "http:" || !loopback || !redirect.port) return "invalid";
  const codeChallenge = params.get("code_challenge") ?? "";
  if (!/^[A-Za-z0-9_-]{43,128}$/.test(codeChallenge)) return "invalid";
  const deviceName = (params.get("device_name") ?? "").trim().slice(0, 120) || "this desktop";
  return { redirect, state: params.get("state") ?? "", codeChallenge, deviceName };
}

function pendingDesktop(): DesktopRequest | null {
  return desktopRequest && desktopRequest !== "invalid" ? desktopRequest : null;
}

/** Leave for the desktop's loopback URL, keeping any query it already had. */
function returnToDesktop(desktop: DesktopRequest, result: Record<string, string>): void {
  const url = new URL(desktop.redirect.href);
  for (const [key, value] of Object.entries(result)) url.searchParams.set(key, value);
  url.searchParams.set("state", desktop.state);
  location.replace(url.href);
}

function renderDesktopInvalid(): void {
  setTitle("Desktop sign-in link not valid");
  app.innerHTML = authFrame(
    "This desktop sign-in link is not valid",
    "Start the connection again from the Psalm150 desktop app. Nothing has been shared.",
    `<a class="button secondary wide" href="/">Open the song library</a>`,
  );
  focusAuth();
}

function renderDesktopConsent(): void {
  const desktop = pendingDesktop();
  if (!desktop || !session) return;
  const forbiddenMessage = "Only leaders can connect a desktop. Ask a leader to sign in.";
  const canConnect = session.role !== "viewer";
  setTitle("Connect a desktop");
  app.innerHTML = authFrame(
    "Connect this desktop?",
    `<strong>${escapeHtml(desktop.deviceName)}</strong> will be connected to <strong>${escapeHtml(session.church_name)}</strong>'s song library. It can read the songs and sets and keep them in sync, including adding, editing and deleting songs and sets.`,
    `<form class="stack" id="desktop-consent">
      <p class="muted">Signed in as <strong>${escapeHtml(session.display_name)}</strong> · <button type="button" class="link-button" id="switch-account">Use another account</button></p>
      <p class="form-message" role="status">${canConnect ? "" : forbiddenMessage}</p>
      <div class="form-actions">
        <button class="button secondary" type="button" id="desktop-cancel">Cancel</button>
        ${canConnect ? `<button class="button primary" type="submit" id="desktop-connect">Connect</button>` : ""}
      </div>
    </form>`,
  );
  focusAuth();

  document.querySelector("#desktop-cancel")?.addEventListener("click", () => {
    returnToDesktop(desktop, { error: "access_denied" });
  });
  document.querySelector("#switch-account")?.addEventListener("click", () => {
    endSession();
    renderLogin();
  });
  document.querySelector<HTMLFormElement>("#desktop-consent")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget as HTMLFormElement;
    const message = form.querySelector<HTMLElement>(".form-message");
    setFormBusy(form, true);
    try {
      const { code } = await api.createDesktopAuthCode(desktop.deviceName, desktop.codeChallenge);
      returnToDesktop(desktop, { code });
    } catch (error) {
      setFormBusy(form, false);
      if (error instanceof ApiError && error.status === 401) {
        clearSession();
        renderLogin();
        return;
      }
      if (error instanceof ApiError && error.status === 403) {
        form.querySelector("#desktop-connect")?.remove();
        if (message) message.textContent = forbiddenMessage;
        return;
      }
      if (message) message.textContent = errorMessage(error);
    }
  });
}

/* ── Shell and routing ───────────────────────────────────────────────────── */

/** `visitors`: open to everyone, signed in or not, when the library is public. */
type Route = { pattern: RegExp; tab: Tab } & (
  | { visitors: true; view: LibraryView }
  | { visitors?: false; view: View }
);

type Tab = "songs" | "sets" | "remote" | "settings";

const ROUTES: Route[] = [
  { pattern: /^\/songs$/, view: songList, tab: "songs", visitors: true },
  { pattern: /^\/songs\/new$/, view: (ctx) => songEditor(ctx, []), tab: "songs" },
  { pattern: /^\/songs\/([0-9a-f-]{36})$/, view: songDetail, tab: "songs", visitors: true },
  { pattern: /^\/songs\/([0-9a-f-]{36})\/edit$/, view: songEditor, tab: "songs" },
  { pattern: /^\/songs\/([0-9a-f-]{36})\/chords$/, view: findChords, tab: "songs" },
  { pattern: /^\/sets$/, view: setList, tab: "sets" },
  { pattern: /^\/sets\/new$/, view: (ctx) => setEditor(ctx, []), tab: "sets" },
  { pattern: /^\/sets\/([0-9a-f-]{36})$/, view: setDetail, tab: "sets" },
  { pattern: /^\/sets\/([0-9a-f-]{36})\/edit$/, view: setEditor, tab: "sets" },
  { pattern: /^\/sets\/([0-9a-f-]{36})\/play\/(\d+)$/, view: setPlay, tab: "sets" },
  { pattern: /^\/remote$/, view: remoteList, tab: "remote" },
  { pattern: /^\/remote\/([0-9a-f-]{36})$/, view: remoteDesktop, tab: "remote" },
  // More was renamed Settings; old links still arrive.
  { pattern: /^\/more$/, view: async (ctx) => ctx.navigate("#/settings", true), tab: "settings" },
  { pattern: /^\/settings$/, view: settingsView, tab: "settings" },
  { pattern: /^\/settings\/([a-z]+)$/, view: settingsView, tab: "settings" },
  { pattern: /^\/people$/, view: peopleView, tab: "settings" },
  { pattern: /^\/api$/, view: apiDocs, tab: "settings", visitors: true },
];

const TABS: Array<{ tab: Tab; label: string; icon: IconName; href: string }> = [
  { tab: "songs", label: "Songs", icon: "songs", href: "#/songs" },
  { tab: "sets", label: "Sets", icon: "sets", href: "#/sets" },
  { tab: "remote", label: "Remote", icon: "remote", href: "#/remote" },
  { tab: "settings", label: "Settings", icon: "settings", href: "#/settings" },
];

let cleanup: Cleanup | void;
let routeToken = 0;
/** The route on screen, so a redraw of the same screen keeps focus in place. */
let shownRoute: Route | null = null;
/** The hash path of the screen shown, to know which way the next one slides. */
let shownPath: string | null = null;
/**
 * Each history entry remembers the screen it was opened from (`prev`), so
 * a screen's Back button can go back in history (to the same place in a
 * list) instead of opening that screen anew at the top. Only a new entry
 * (no state yet) gets it; one reached with Back or Forward keeps its own.
 */
let hashListener: (() => void) | null = null;

/** "Version 0.1.0 · 15 Oct, 16:27": the build time tells deploys apart. */
function versionLabel(): string {
  const built = new Date(__BUILD_TIME__).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  return `Version ${escapeHtml(__APP_VERSION__)} · <time datetime="${__BUILD_TIME__}" title="Built ${escapeHtml(new Date(__BUILD_TIME__).toLocaleString())}">${escapeHtml(built)}</time>`;
}

/**
 * Inside Settings the menu is Settings' own: Back to the songs, then its
 * pages. Rebuilt on each route, as the pages depend on the person's role.
 */
function settingsNav(): string {
  if (!session) return "";
  const pages = settingsPages({ session, canEdit: canEditSets() });
  return `<a class="tab nav-back" href="#/songs" title="Back">${icon("back")}<span class="tab-label">Back</span></a>
    <p class="nav-heading">Settings</p>
    ${pages.map((page) => `<a class="tab" href="${settingsHref(page)}" data-setting="${page.href ? page.href.slice(2) : `/settings/${page.id}`}" title="${page.label}">${icon(page.icon)}<span class="tab-label">${page.label}</span></a>`).join("")}`;
}

function currentPath(): string {
  return location.hash.replace(/^#/, "").split("?")[0];
}

function visitorRoute(path: string): boolean {
  return ROUTES.some((entry) => entry.visitors && entry.pattern.test(path));
}

/** Signed in, or visiting a public library. */
function renderShell(): void {
  if (!session && !publicLibrary) return;
  // On wide screens the sections are a rail of icons, as in the desktop app;
  // their names show beside them in the phone's drawer and as tooltips.
  const tabs = session
    ? TABS.map((tab) => `<a class="tab" href="${tab.href}" data-tab="${tab.tab}" title="${tab.label}">${icon(tab.icon)}<span class="tab-label">${tab.label}</span></a>`).join("")
    : `<a class="tab" href="#/songs" data-tab="songs" title="Songs">${icon("songs")}<span class="tab-label">Songs</span></a>
      ${roomsOpen ? `<a class="tab" href="/join" title="Join a room">${icon("project")}<span class="tab-label">Join a room</span></a>` : ""}
      <button type="button" class="tab" id="sign-in" title="Sign in">${icon("login")}<span class="tab-label">Sign in</span></button>`;
  app.innerHTML = `<a class="skip-link" href="#page" id="skip-link">Skip to content</a>
  <div class="shell${session ? "" : " visitor"}">
    <nav class="tabbar" id="sections" aria-label="Sections">
      <div class="brand" aria-hidden="true" title="PSA150 · Version ${escapeHtml(__APP_VERSION__)}"><span class="brand-mark">150</span><span>PSA150</span></div>
      <div class="nav-main">${tabs}</div>
      ${session ? `<div class="nav-settings" aria-label="Settings">${settingsNav()}</div>` : ""}
      <p class="app-version">${versionLabel()}</p>
    </nav>
    <div class="nav-scrim" id="nav-scrim" aria-hidden="true"></div>
    <aside class="browse-pane" id="browse" aria-label="Song list" hidden></aside>
    <main class="page" id="page" tabindex="-1"></main>
  </div>
  <section class="follow-view room" id="follow-view" aria-label="The projector's words" hidden></section>
  <aside class="dock" id="dock" aria-label="Current set and projector">
    <p class="offline-bar" id="offline-bar" role="status" hidden>${icon("offline")}<span>Offline. Showing the songs and sets saved on this phone.</span></p>
    <div class="current-bar" id="current-bar" hidden>
      <a class="current-link" id="current-link" hidden></a>
      <button type="button" class="icon-button ghost current-close" id="current-close" aria-label="Put the current set away" title="No current set" hidden>${icon("close")}</button>
    </div>
  </aside>
  <div class="toast" id="toast" role="status" aria-live="polite"></div>
  <p class="sr-only" id="announcer" role="status" aria-live="polite"></p>`;

  if (!hashListener) {
    hashListener = () => {
      // Going somewhere else (a tab, a link) shows it, not the projector.
      follow.off();
      void route();
    };
    window.addEventListener("hashchange", hashListener);
    startShellListeners();
  }
  // The route lives in the hash, so the skip link moves focus itself.
  document.querySelector("#skip-link")?.addEventListener("click", (event) => {
    event.preventDefault();
    focusPageStart();
  });
  document.querySelector("#sign-in")?.addEventListener("click", () => {
    closeMenu(false);
    leaveShell(renderLogin);
  });
  bindMenuSwipe(document.querySelector<HTMLElement>("#sections")!, document.querySelector<HTMLElement>("#nav-scrim")!);
  document.querySelector("#current-close")?.addEventListener("click", () => void dismissCurrentSet());
  currentSet.subscribe(renderCurrentBar);
  renderCurrentBar(currentSet.value);
  showOffline();
  new ResizeObserver(([entry]) => {
    document.documentElement.style.setProperty("--dock-h", `${Math.round(entry.contentRect.height)}px`);
  }).observe(document.querySelector("#dock")!);
  currentReady = session ? currentSet.refresh().catch(() => undefined) : Promise.resolve();
  if (session) void favorites.refresh().catch(() => undefined);
  if (session) follow.start();
  else follow.stop();
  if (!location.hash || location.hash === "#" || location.hash === "#/") {
    history.replaceState(null, "", homeRoute());
  }
  // More is now Settings.
  if (location.hash === "#/more") history.replaceState(null, "", "#/settings");
  void route();
}

/* ── Songs beside the song (wide screens) ────────────────────────────────── */

/**
 * Wide enough for the desktop's layout: the song list in a pane of its own,
 * the song chosen beside it. Narrower, the list and a song are each a screen.
 */
const SPLIT = matchMedia("(min-width: 1100px)");
/** The routes shown beside the list: the list itself and a song. */
const SPLIT_PATH = /^\/songs(?:\/[0-9a-f-]{36})?$/;
/** The song list in the pane, while it is there (its view's cleanup). */
let browse: { cleanup: Cleanup | void; observer: MutationObserver } | null = null;

/**
 * Shows the song list in its pane for the songs' routes on a wide screen,
 * and takes it away elsewhere. The list stays as it is (search, scroll)
 * while songs open beside it.
 */
async function syncBrowsePane(path: string): Promise<boolean> {
  const pane = document.querySelector<HTMLElement>("#browse");
  const split = Boolean(pane) && SPLIT.matches && SPLIT_PATH.test(path);
  document.body.classList.toggle("split", split);
  if (!pane) return false;
  if (split && !browse) {
    pane.hidden = false;
    const cleanup = await songList(libraryContext(pane));
    // The rows are drawn again as the list loads: mark the open song each time.
    const observer = new MutationObserver(() => markBrowsed());
    observer.observe(pane, { childList: true, subtree: true });
    browse = { cleanup, observer };
  } else if (!split && browse) {
    browse.observer.disconnect();
    if (typeof browse.cleanup === "function") browse.cleanup();
    browse = null;
    pane.replaceChildren();
    pane.hidden = true;
  }
  markBrowsed();
  return split;
}

/** The song open beside the list is marked in it. */
function markBrowsed(): void {
  const pane = document.querySelector<HTMLElement>("#browse");
  if (!pane || pane.hidden) return;
  const href = `#${currentPath()}`;
  pane.querySelectorAll<HTMLElement>("#song-results > li").forEach((row) => {
    const on = Boolean(row.querySelector(`a[href="${href}"]`));
    if (row.classList.contains("on") === on) return;
    row.classList.toggle("on", on);
    const link = row.querySelector("a");
    if (on) link?.setAttribute("aria-current", "page");
    else link?.removeAttribute("aria-current");
  });
}

/** Beside the list, before a song is chosen. */
async function chooseSongView(ctx: LibraryContext): Promise<void> {
  ctx.main.innerHTML = `<div class="page-titles quiet"><h1 tabindex="-1">Songs</h1></div>
    <div class="empty-state pick-song">${icon("songs")}<h2>Choose a song</h2><p>Pick one from the list, or search for a title, a number or a line.</p></div>`;
}

/** Everyone starts at the songs. */
function homeRoute(): string {
  return "#/songs";
}

/** Stops the current screen and shows a full-page one, such as sign-in. */
function leaveShell(render: () => void): void {
  if (typeof cleanup === "function") cleanup();
  cleanup = undefined;
  routeToken++;
  render();
}

/* ── Sections drawer (phones) ────────────────────────────────────────────── */

/** The ☰ that opened the drawer, to return focus to when it closes. */
let menuOpener: HTMLElement | null = null;

function menuIsOpen(): boolean {
  return document.body.classList.contains("menu-open");
}

/** `opener`: the ☰ tapped; null when a swipe opened it, so focus returns to the screen's ☰. */
function openMenu(opener: HTMLElement | null): void {
  menuOpener = opener ?? Array.from(document.querySelectorAll<HTMLElement>("[data-menu]")).find((button) => button.offsetParent) ?? null;
  document.body.classList.add("menu-open");
  setBackgroundInert(true);
  document.querySelectorAll("[data-menu]").forEach((button) => button.setAttribute("aria-expanded", "true"));
  const nav = document.querySelector<HTMLElement>("#sections");
  // After the slide starts, so the browser does not scroll to it.
  // The current section, else the first.
  // Of the menu shown (Settings has its own), the current section, else the first.
  requestAnimationFrame(() => {
    const tabs = Array.from(nav?.querySelectorAll<HTMLElement>(".tab") ?? []).filter((tab) => tab.getClientRects().length);
    (tabs.find((tab) => tab.classList.contains("on")) ?? tabs[0])?.focus({ preventScroll: true });
  });
}

/**
 * While the drawer is open, the screen under its shade cannot be reached with
 * Tab or a screen reader, as with a modal dialog.
 */
function setBackgroundInert(value: boolean): void {
  for (const id of ["page", "browse", "dock", "skip-link"]) {
    const element = document.getElementById(id);
    if (element) element.inert = value;
  }
}

/** `restoreFocus`: back to ☰, unless the drawer closes because you went somewhere. */
function closeMenu(restoreFocus = true): void {
  if (!menuIsOpen()) return;
  document.body.classList.remove("menu-open", "menu-dragging");
  document.body.style.removeProperty("--menu-drag");
  document.body.style.removeProperty("--menu-shade");
  document.querySelectorAll("[data-menu]").forEach((button) => button.setAttribute("aria-expanded", "false"));
  setBackgroundInert(false);
  if (restoreFocus && menuOpener?.isConnected) menuOpener.focus({ preventScroll: true });
  menuOpener = null;
}

/**
 * Swiping left on the open drawer (or the shade beside it) slides it shut,
 * following the finger; a short or slow swipe springs back open.
 */
function bindMenuSwipe(nav: HTMLElement, scrim: HTMLElement): void {
  let startX = 0;
  let startY = 0;
  let startTime = 0;
  let offset = 0;
  let mode: "undecided" | "drag" | "scroll" = "undecided";

  const start = (event: TouchEvent) => {
    if (!menuIsOpen() || event.touches.length !== 1) return;
    startX = event.touches[0].clientX;
    startY = event.touches[0].clientY;
    startTime = event.timeStamp;
    offset = 0;
    mode = "undecided";
  };
  const move = (event: TouchEvent) => {
    if (!menuIsOpen() || mode === "scroll") return;
    const dx = event.touches[0].clientX - startX;
    const dy = event.touches[0].clientY - startY;
    if (mode === "undecided") {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
      // Mostly vertical: let the drawer's list scroll.
      mode = Math.abs(dx) > Math.abs(dy) ? "drag" : "scroll";
      if (mode === "scroll") return;
      document.body.classList.add("menu-dragging");
    }
    event.preventDefault();
    offset = Math.min(0, dx);
    const width = nav.offsetWidth || 1;
    document.body.style.setProperty("--menu-drag", `${offset}px`);
    document.body.style.setProperty("--menu-shade", String(Math.max(0, 1 + offset / width)));
  };
  const end = (event: TouchEvent) => {
    if (mode !== "drag") return;
    mode = "undecided";
    document.body.classList.remove("menu-dragging");
    const width = nav.offsetWidth || 1;
    const speed = -offset / Math.max(1, event.timeStamp - startTime); // px per ms, leftwards
    if (offset < -width * 0.35 || (offset < -24 && speed > 0.5)) {
      closeMenu();
    } else {
      document.body.style.removeProperty("--menu-drag");
      document.body.style.removeProperty("--menu-shade");
    }
  };
  for (const element of [nav, scrim]) {
    element.addEventListener("touchstart", start, { passive: true });
    element.addEventListener("touchmove", move, { passive: false });
    element.addEventListener("touchend", end);
    element.addEventListener("touchcancel", end);
  }
  scrim.addEventListener("click", () => closeMenu());
  // The section you are already in does not change the route; close anyway.
  nav.addEventListener("click", (event) => {
    if ((event.target as HTMLElement).closest("a.tab")) closeMenu(false);
  });
}


/**
 * In the installed app on a phone, a swipe in from the left edge pulls the
 * drawer out under the finger; past a third of its width, or on a quick flick,
 * it stays open. In the browser that edge is Safari's Back, so it is left alone.
 */
function bindEdgeSwipe(): void {
  const EDGE = 24;
  let startX = 0;
  let startY = 0;
  let startTime = 0;
  let pulled = 0;
  let width = 1;
  let mode: "off" | "undecided" | "drag" = "off";

  document.addEventListener("touchstart", (event) => {
    mode = "off";
    if (event.touches.length !== 1 || event.touches[0].clientX > EDGE) return;
    if (!installedApp() || menuIsOpen() || matchMedia("(min-width: 900px)").matches) return;
    // Only where ☰ shows, so the swipe does what the button does: not on
    // screens with Back (songs, sets, the service view and its own swipes),
    // and not while a sheet is open.
    const nav = document.querySelector<HTMLElement>("#sections");
    const menuShown = Array.from(document.querySelectorAll<HTMLElement>("#page [data-menu]")).some((button) => button.offsetParent);
    if (!nav || !menuShown || document.querySelector("dialog[open]")) return;
    startX = event.touches[0].clientX;
    startY = event.touches[0].clientY;
    startTime = event.timeStamp;
    width = nav.offsetWidth || 300;
    pulled = 0;
    mode = "undecided";
  }, { passive: true });

  document.addEventListener("touchmove", (event) => {
    if (mode === "off") return;
    const dx = event.touches[0].clientX - startX;
    const dy = event.touches[0].clientY - startY;
    if (mode === "undecided") {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
      if (dx <= 0 || Math.abs(dy) > Math.abs(dx)) {
        mode = "off";
        return;
      }
      mode = "drag";
      document.body.classList.add("menu-open", "menu-dragging");
    }
    event.preventDefault();
    pulled = Math.max(0, Math.min(width, dx));
    document.body.style.setProperty("--menu-drag", `${pulled - width}px`);
    document.body.style.setProperty("--menu-shade", String(pulled / width));
  }, { passive: false });

  const end = (event: TouchEvent) => {
    if (mode !== "drag") {
      mode = "off";
      return;
    }
    mode = "off";
    document.body.classList.remove("menu-dragging");
    const speed = pulled / Math.max(1, event.timeStamp - startTime);
    if (pulled > width * 0.35 || (pulled > 24 && speed > 0.5)) {
      document.body.style.removeProperty("--menu-drag");
      document.body.style.removeProperty("--menu-shade");
      openMenu(null);
    } else {
      closeMenu(false);
    }
  };
  document.addEventListener("touchend", end);
  document.addEventListener("touchcancel", end);
}

/**
 * The installed app has no browser Back gesture, so it gets one: a swipe in
 * from the left edge on a screen with Back pulls the screen to the right
 * under the finger. Past a third of the width, or on a flick, it goes back,
 * and the slide carries on from where the finger let go; otherwise it
 * springs back. (Screens with the menu button open the drawer from that edge.)
 */
function bindSwipeBack(): void {
  const EDGE = 24;
  let startX = 0;
  let startY = 0;
  let startTime = 0;
  let offset = 0;
  let mode: "off" | "maybe" | "drag" = "off";
  let page: HTMLElement | null = null;
  let back: HTMLAnchorElement | null = null;

  document.addEventListener("touchstart", (event) => {
    mode = "off";
    if (event.touches.length !== 1 || event.touches[0].clientX > EDGE || !installedApp()) return;
    // Chords and sections in the song editor are dragged, not swiped.
    if ((event.target as Element).closest?.(".ce-chip, .ce-grip")) return;
    if (menuIsOpen() || document.querySelector("dialog[open]")) return;
    page = document.querySelector<HTMLElement>("#page");
    back = page?.querySelector<HTMLAnchorElement>('.app-bar a[aria-label="Back"]') ?? null;
    if (!page || !back) return;
    startX = event.touches[0].clientX;
    startY = event.touches[0].clientY;
    startTime = event.timeStamp;
    offset = 0;
    mode = "maybe";
  }, { passive: true });

  document.addEventListener("touchmove", (event) => {
    if (mode === "off" || !page) return;
    const dx = event.touches[0].clientX - startX;
    const dy = event.touches[0].clientY - startY;
    if (mode === "maybe") {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
      if (dx <= 0 || Math.abs(dy) > Math.abs(dx)) {
        mode = "off";
        return;
      }
      mode = "drag";
      page.classList.remove("settling-back");
      page.classList.add("swiping-back");
    }
    event.preventDefault();
    offset = Math.max(0, dx);
    page.style.setProperty("--back", `${offset}px`);
  }, { passive: false });

  const end = (event: TouchEvent) => {
    if (mode !== "drag" || !page) {
      mode = "off";
      return;
    }
    mode = "off";
    const speed = offset / Math.max(1, event.timeStamp - startTime);
    if (back && (offset > window.innerWidth * 0.33 || (offset > 40 && speed > 0.4))) {
      back.click();
      return;
    }
    const settling = page;
    settling.classList.replace("swiping-back", "settling-back");
    settling.style.setProperty("--back", "0px");
    window.setTimeout(() => settling.classList.remove("settling-back"), 260);
  };
  document.addEventListener("touchend", end);
  document.addEventListener("touchcancel", end);
}

async function route(): Promise<void> {
  // Going somewhere from the drawer closes it.
  closeMenu(false);
  if (!session && !publicLibrary) return;
  const main = document.querySelector<HTMLElement>("#page");
  if (!main) return;
  const path = currentPath() || homeRoute().slice(1);
  const match = ROUTES.map((entry) => ({ entry, found: entry.pattern.exec(path) })).find((candidate) => candidate.found);
  if (!match?.found) {
    history.replaceState(null, "", homeRoute());
    return route();
  }
  if (!session && !match.entry.visitors) {
    // A members' page, such as a shared set: sign in, then land on it.
    leaveShell(renderLogin);
    return;
  }

  // The control in use, to focus again if this screen is only redrawn
  // (a setting saved, the next item of a set).
  const focused = main.contains(document.activeElement) ? selectorFor(document.activeElement) : null;
  const sameScreen = shownRoute === match.entry;
  // An error toast belongs to the screen it came from.
  if (document.querySelector("#toast.error.visible")) hideToast();
  const token = ++routeToken;
  // Swiping back in Safari already moved the screens; do not slide again.
  const slide = takeBrowserAnimated() ? null : slideBetween(shownPath, path);
  const state = history.state as { prev?: string | null } | null;
  if (state?.prev === undefined) history.replaceState({ ...(state ?? {}), prev: shownPath === path ? null : shownPath }, "");
  // Views name their screen more exactly ("Amazing Grace · Songs · PSA150").
  setTitle(TABS.find((tab) => tab.tab === match.entry.tab)?.label);
  main.classList.add("loading");

  // The new screen is drawn off the page and swapped in once it is ready, so
  // the old one stays until then and the two can slide past each other.
  const next = document.createElement("main");
  next.className = "page";
  next.id = "page";
  next.tabIndex = -1;
  let result: Cleanup | void = undefined;
  let failed = false;
  try {
    await currentReady;
    const params = match.found.slice(1);
    const ctx = libraryContext(next);
    // Beside the list in its pane, the songs' own screen asks for a song.
    const split = await syncBrowsePane(path);
    if (token !== routeToken) return;
    result = split && path === "/songs"
      ? await chooseSongView(ctx)
      : match.entry.visitors
        ? await match.entry.view(ctx, params)
        : await match.entry.view({ ...ctx, session: session! }, params);
  } catch (error) {
    if (token !== routeToken) return;
    main.classList.remove("loading");
    if (error instanceof ApiError && error.status === 401) {
      signOut();
      return;
    }
    failed = true;
    const notFound = error instanceof ApiError && error.status === 404;
    setTitle(notFound ? "Not found" : "Could not load this page");
    const home = `<a class="button secondary" href="#/songs">Go to songs</a>`;
    next.innerHTML = `<div class="empty-state"><h1 tabindex="-1">${notFound ? "Not found" : "Could not load this page"}</h1><p>${escapeHtml(errorMessage(error))}</p>${home}</div>`;
  }
  if (token !== routeToken) {
    if (typeof result === "function") result();
    return;
  }
  const previous = cleanup;
  cleanup = result;
  shownRoute = failed ? null : match.entry;
  shownPath = path;
  swapScreen(slide, () => {
    if (typeof previous === "function") previous();
    main.replaceWith(next);
    document.querySelectorAll<HTMLElement>("[data-tab]").forEach((tab) => {
      const on = tab.dataset.tab === match.entry.tab;
      tab.classList.toggle("on", on);
      if (on) tab.setAttribute("aria-current", "page");
      else tab.removeAttribute("aria-current");
    });
    // Settings has its own menu; its pages are marked in it.
    const inSettings = Boolean(session) && match.entry.tab === "settings";
    document.body.classList.toggle("settings-nav", inSettings);
    if (inSettings) {
      const nav = document.querySelector<HTMLElement>(".nav-settings");
      if (nav) nav.innerHTML = settingsNav();
      const shown = path === "/settings" && matchMedia("(min-width: 900px)").matches
        ? nav?.querySelector<HTMLElement>("[data-setting]")?.dataset.setting
        : path === "/api" ? "/settings/about" : path;
      nav?.querySelectorAll<HTMLElement>("[data-setting]").forEach((tab) => {
        const on = tab.dataset.setting === shown;
        tab.classList.toggle("on", on);
        if (on) tab.setAttribute("aria-current", "page");
        else tab.removeAttribute("aria-current");
      });
    }
    document.body.dataset.route = path.split("/").slice(0, 4).join("/").replace(/[0-9a-f-]{36}/g, "id").replace(/\/\d+$/, "");
    document.body.classList.remove("bar-away", "title-away", "scrolled");
    // Back and Forward return to where you were; anything else starts at the top.
    const saved = (history.state as { scrollY?: number } | null)?.scrollY;
    window.scrollTo({ top: saved ?? 0 });
    updateScrollState();
    // A new screen: focus its heading, so a screen reader says where you are
    // and Tab starts from the top. The same screen redrawn: the same control.
    if (userActed && !document.querySelector("dialog[open]") && !(sameScreen && !failed && refocus(next, focused))) focusPageStart();
  });
}

/** The screen's heading, or the main area when it has none. */
function focusPageStart(): void {
  const main = document.querySelector<HTMLElement>("#page");
  const heading = main?.querySelector<HTMLElement>("h1");
  (heading ?? main)?.focus({ preventScroll: true });
}

function libraryContext(main: HTMLElement): LibraryContext {
  return {
    api,
    session,
    libraryName: session?.church_name ?? publicLibrary ?? "",
    isPublic: Boolean(publicLibrary),
    setPublic(value) {
      publicLibrary = value ? session?.church_name ?? "Song library" : null;
    },
    canEdit: canEditSets(),
    main,
    navigate(target: string, replace = false) {
      if (location.hash === target) {
        void route();
      } else if (replace) {
        // The same entry: it keeps the screen it was opened from.
        history.replaceState({ prev: (history.state as { prev?: string | null } | null)?.prev ?? null }, "", target);
        void route();
      } else {
        location.hash = target;
      }
    },
    currentSet,
    favorites,
    live: live!,
    run,
    signOut,
    refreshSession,
    applyTheme,
  };
}

/**
 * The role, name and church shown come from sign-in. Read them again when
 * the app opens or comes back into view (at most once a minute), so a role
 * an owner changed applies without signing in again. A token the server no
 * longer accepts signs out; offline, nothing changes.
 */
async function refreshSession(force = false): Promise<void> {
  if (!session || !navigator.onLine) return;
  if (!force && Date.now() - lastSessionCheck < 60_000) return;
  lastSessionCheck = Date.now();
  const token = session.token;
  let info: SessionInfo;
  try {
    info = await api.currentSession();
  } catch (error) {
    if (error instanceof ApiError && error.status === 401 && session?.token === token) signOut();
    return;
  }
  if (!session || session.token !== token || !info.role) return;
  const changed = info.role !== session.role
    || info.church_name !== session.church_name
    || (info.display_name !== null && info.display_name !== session.display_name);
  if (!changed) return;
  session = {
    ...session,
    role: info.role,
    church_name: info.church_name,
    display_name: info.display_name ?? session.display_name,
  };
  storeSession(session);
  if (document.querySelector("#page")) void route();
}

async function run(action: () => Promise<void>, options: { exclusive?: boolean } = {}): Promise<void> {
  const exclusive = options.exclusive ?? true;
  if (exclusive && busy) return;
  if (exclusive) {
    busy = true;
    document.body.classList.add("is-busy");
  }
  try {
    await action();
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      signOut();
      return;
    }
    showToast(errorMessage(error), true);
  } finally {
    if (exclusive) {
      busy = false;
      document.body.classList.remove("is-busy");
    }
  }
}

/** Back to the public songs when the library is open, else to sign-in. */
function signOut(): void {
  endSession();
  leaveShell(() => {
    if (!publicLibrary) return renderLogin();
    if (!visitorRoute(currentPath())) history.replaceState(null, "", "#/songs");
    renderShell();
  });
}

/* ── Current set bar, offline notice, scrolling ──────────────────────────── */

/** Leaders and owners may edit sets. */
function canEditSets(): boolean {
  return Boolean(session && session.role !== "viewer");
}

/** The card shows when it holds a current set, a projector to follow, or both. */
function syncCurrentBar(): void {
  const bar = document.querySelector<HTMLElement>("#current-bar");
  if (!bar) return;
  bar.hidden = Boolean(document.querySelector("#current-link")?.hasAttribute("hidden"));
}

function renderCurrentBar(set: SetDetail | null): void {
  const bar = document.querySelector<HTMLElement>("#current-bar");
  const link = document.querySelector<HTMLAnchorElement>("#current-link");
  if (!bar || !link) return;
  link.hidden = !set;
  document.querySelector<HTMLElement>("#current-close")!.hidden = !set;
  syncCurrentBar();
  if (!set) {
    delete bar.dataset.count;
    return;
  }
  const songs = set.items.filter((item) => item.kind === "song").length;
  const previous = bar.dataset.count;
  // Leaders go straight to editing the set; the set's own page is one Back away.
  link.href = canEditSets() ? `#/sets/${set.id}/edit` : `#/sets/${set.id}`;
  bar.dataset.count = String(songs);
  link.setAttribute("aria-label", `Current set: ${set.name}, ${songs} ${songs === 1 ? "song" : "songs"}`);
  // When a song is added or removed (the + / ✓ on a song), the card says so
  // for a moment in place of "Current set", with a small pulse. No toast:
  // tapping the same button again undoes it.
  const change = previous === undefined ? 0 : songs - Number(previous);
  const note = change > 0 ? "Song added" : change < 0 ? "Song removed" : "";
  const count = `${songs} ${songs === 1 ? "song" : "songs"}`;
  // Compact, so the projector switch fits beside it: name over count.
  link.innerHTML = `${dateBadge(set.service_date)}
    <span class="row-main"><strong>${escapeHtml(set.name)}</strong><small class="current-label">${note || count}</small></span>`;
  window.clearTimeout(currentNoteTimer);
  bar.classList.toggle("noted", Boolean(note));
  if (!note) return;
  bar.classList.remove("bump");
  void bar.offsetWidth;
  bar.classList.add("bump");
  announce(`${note} ${change > 0 ? "to" : "from"} ${set.name}, ${songs} ${songs === 1 ? "song" : "songs"}`);
  currentNoteTimer = window.setTimeout(() => {
    bar.classList.remove("noted");
    const label = bar.querySelector(".current-label");
    if (label) label.textContent = count;
  }, 2500);
}
let currentNoteTimer = 0;

/** The bar's ✕: no current set on this phone until one is chosen, with Undo. */
async function dismissCurrentSet(): Promise<void> {
  const name = currentSet.value?.name;
  const hadFocus = document.activeElement?.id === "current-close";
  const previous = await currentSet.dismiss();
  // The button is gone with the bar; keep focus on the page, not the body.
  if (hadFocus) document.querySelector<HTMLElement>("#page")?.focus({ preventScroll: true });
  showToast(name ? `${name} is no longer the current set.` : "No current set.", {
    action: { label: "Undo", run: () => void currentSet.choose(previous).catch(() => undefined) },
  });
}

function showOffline(): void {
  const bar = document.querySelector<HTMLElement>("#offline-bar");
  if (!bar) return;
  const was = bar.hidden;
  bar.toggleAttribute("hidden", navigator.onLine);
  // A status that appears is not always read out; say it.
  if (was && !bar.hidden) announce(bar.textContent ?? "");
  else if (!was && bar.hidden) announce("Back online.");
}

let lastScrollY = 0;
let scrollFrame = 0;
let scrollSaveTimer = 0;

/**
 * Scroll-driven chrome: the bar gets a border once the page moves, shows the
 * title once the large title is under it, and (on reading screens) slides
 * away while reading down and returns on any scroll up.
 */
function updateScrollState(): void {
  const y = window.scrollY;
  const body = document.body;
  body.classList.toggle("scrolled", y > 4);
  const bar = document.querySelector<HTMLElement>("#page .app-bar");
  const title = document.querySelector<HTMLElement>("#page .page-titles h1");
  body.classList.toggle("title-away", Boolean(bar && title && title.getBoundingClientRect().bottom < bar.offsetHeight));
  const delta = y - lastScrollY;
  // An open ⋮ menu keeps the bar in place.
  const menuOpen = Boolean(document.querySelector(".bar-menu:not([hidden])"));
  if (y < 160 || menuOpen) {
    body.classList.remove("bar-away");
    lastScrollY = y;
  } else if (Math.abs(delta) >= 12) {
    body.classList.toggle("bar-away", delta > 0);
    lastScrollY = y;
  }
}

function startShellListeners(): void {
  history.scrollRestoration = "manual";
  // Back to the screen this one was opened from: history's Back, so it
  // comes back where it was (scrolled, searched) rather than at the top.
  document.addEventListener("click", (event) => {
    const back = (event.target as HTMLElement).closest<HTMLAnchorElement>("a.bar-back");
    const target = back?.getAttribute("href")?.replace(/^#/, "");
    const prev = (history.state as { prev?: string | null } | null)?.prev;
    if (!back || !target || !prev || prev !== target || event.metaKey || event.ctrlKey || event.shiftKey) return;
    event.preventDefault();
    appGoesBack();
  });
  // ☰ buttons are re-rendered with each screen, so listen once for all of them.
  document.addEventListener("click", (event) => {
    const opener = (event.target as HTMLElement).closest<HTMLElement>("[data-menu]");
    if (opener) openMenu(opener);
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && menuIsOpen()) closeMenu();
  });
  // Turning a tablet to landscape shows the rail; the drawer state must not linger.
  matchMedia("(min-width: 900px)").addEventListener("change", () => closeMenu(false));
  // Wide enough for the list beside the song, or no longer: lay the screen out again.
  SPLIT.addEventListener("change", () => void route());

  bindEdgeSwipe();
  bindSwipeBack();
  // Start reading a song or set as the finger lands on its link, so the
  // screen is usually ready by the time the tap ends.
  document.addEventListener("pointerdown", (event) => {
    const href = (event.target as HTMLElement).closest<HTMLAnchorElement>('a[href^="#/"]')?.getAttribute("href") ?? "";
    const song = /^#\/songs\/([0-9a-f-]{36})$/i.exec(href);
    const set = /^#\/sets\/([0-9a-f-]{36})(?:\/play\/\d+)?$/i.exec(href);
    if (song) void api.getSong(song[1]).catch(() => undefined);
    if (set && session) void api.getSet(set[1]).catch(() => undefined);
  }, { capture: true, passive: true });
  window.addEventListener("scroll", () => {
    if (!scrollFrame) {
      scrollFrame = requestAnimationFrame(() => {
        scrollFrame = 0;
        updateScrollState();
      });
    }
    // Remember the position in this history entry, for Back. Safari limits
    // how often replaceState may run, so only once scrolling settles.
    window.clearTimeout(scrollSaveTimer);
    scrollSaveTimer = window.setTimeout(() => {
      try {
        history.replaceState({ ...(history.state ?? {}), scrollY: window.scrollY }, "");
      } catch {
        // Too many updates; the next pause saves it.
      }
    }, 250);
  }, { passive: true });

  const refresh = () => {
    if (session) {
      void currentSet.refresh().catch(() => undefined);
      void favorites.refresh().catch(() => undefined);
    }
    void refreshSession();
  };
  window.addEventListener("online", () => {
    showOffline();
    refresh();
  });
  window.addEventListener("offline", showOffline);
  // Someone may have changed the set while the phone was in a pocket.
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) refresh();
  });
}

/* ── App install and offline support ─────────────────────────────────────── */

function registerServiceWorker(): void {
  if (!import.meta.env.PROD || !("serviceWorker" in navigator)) return;
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => undefined);
  });
  // The first time the worker takes over, save the current set for offline use.
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (session) void currentSet.refresh().catch(() => undefined);
  });
}

/** Removes cached songs and sets, so the next person on this phone sees none. */
async function clearCachedData(): Promise<void> {
  // Tell the worker first, so a read still in flight is not saved afterwards.
  navigator.serviceWorker?.controller?.postMessage("clear-api-cache");
  if (!("caches" in window)) return;
  for (const key of await caches.keys()) {
    if (key.startsWith("psa150-api")) await caches.delete(key);
  }
}

/** Theme preference: light, dark, or (unset) follow the system. */
function applyTheme(): void {
  const theme = readPreference("theme");
  if (theme === "light" || theme === "dark") document.documentElement.dataset.theme = theme;
  else delete document.documentElement.dataset.theme;
  const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  const dark = theme === "dark" || (!theme && matchMedia("(prefers-color-scheme: dark)").matches);
  // The phone header's tint (--psa-bg-subtle), so the browser bar meets it.
  if (meta) meta.content = dark ? "#141414" : "#f0f0ec";
}

function authFrame(title: string, copy: string, form: string): string {
  return `<main class="auth">
    <div class="auth-card">
      <div class="brand large"><span class="brand-mark" aria-hidden="true">150</span><span>PSA150</span></div>
      <h1 tabindex="-1">${escapeHtml(title)}</h1>
      <p class="lede">${copy}</p>
      ${form}
    </div>
    <p class="fine-print">"Let everything that has breath praise the Lord." Psalm 150:6</p>
  </main>`;
}

/**
 * After a full-page screen replaces another (sign-in after signing out, say),
 * focus goes to its first field, or its heading. Not on the first page load:
 * a screen reader starts at the top by itself.
 */
function focusAuth(): void {
  if (!userActed) return;
  (app.querySelector<HTMLElement>("[autofocus]") ?? app.querySelector<HTMLElement>("h1"))?.focus();
}

function renderFatal(error: unknown): void {
  setTitle("Not reachable");
  app.innerHTML = `<main class="auth"><div class="auth-card"><div class="brand large"><span class="brand-mark" aria-hidden="true">150</span><span>PSA150</span></div><h1 tabindex="-1">The song server is not reachable</h1><p class="lede">${escapeHtml(errorMessage(error))}</p><button class="button primary wide" id="retry">Try again</button></div></main>`;
  focusAuth();
  document.querySelector("#retry")?.addEventListener("click", () => location.reload());
}

/**
 * The session lives in localStorage so an installed app, which the phone
 * closes often, stays signed in until the session expires or you sign out.
 * Older versions kept it in sessionStorage; it moves over on first read.
 */
function readSession(): Session | null {
  try {
    const stored = localStorage.getItem(SESSION_KEY) ?? sessionStorage.getItem(SESSION_KEY);
    const parsed = stored ? JSON.parse(stored) as Session : null;
    if (parsed) storeSession(parsed);
    return parsed;
  } catch {
    return null;
  }
}

function storeSession(value: Session): void {
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify(value));
    sessionStorage.removeItem(SESSION_KEY);
  } catch {
    // Storage is blocked: the session lasts as long as this page.
  }
}

/**
 * Signs out here and on the server, so the token stops working. Offline (or
 * when the server already refused it) it simply runs out.
 */
function endSession(): void {
  const token = session?.token;
  clearSession();
  if (token) void api.endSession(token).catch(() => undefined);
}

function clearSession(): void {
  session = null;
  for (const storage of [localStorage, sessionStorage]) {
    try {
      storage.removeItem(SESSION_KEY);
    } catch {
      // Nothing stored.
    }
  }
  // Every way out (sign-out, an expired session, another account) leaves
  // nothing of this person's library on the phone.
  currentSet.clear();
  favorites.clear();
  live?.stop();
  follow.stop();
  void clearCachedData();
}
