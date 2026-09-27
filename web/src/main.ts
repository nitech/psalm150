import "./psa150-tokens.css";
import "./styles.css";
import { ApiError, SongServerApi } from "./api.ts";
import type { AppContext, Cleanup, View } from "./context.ts";
import { icon, type IconName } from "./icons.ts";
import type { Session } from "./types.ts";
import { errorMessage, escapeHtml, readPreference, setFormBusy, showToast } from "./ui.ts";
import { moreView } from "./views/more.ts";
import { remoteDesktop, remoteList } from "./views/remote.ts";
import { setDetail, setEditor, setList, setPlay } from "./views/sets.ts";
import { songDetail, songEditor, songList } from "./views/songs.ts";

const app = document.querySelector<HTMLDivElement>("#app")!;
if (!app) throw new Error("Application mount point is missing");

const SESSION_KEY = "psa150-server-session";
let session = readSession();
let busy = false;
const api = new SongServerApi(() => session?.token ?? null);

applyTheme();

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
    const status = await api.setupStatus();
    if (!status.initialized) {
      renderSetup();
    } else if (!session || new Date(session.expires_at) <= new Date()) {
      clearSession();
      renderLogin();
    } else {
      showSignedIn();
    }
  } catch (error) {
    renderFatal(error);
  }
}

function renderSetup(): void {
  app.innerHTML = authFrame(
    "Set up your song server",
    "Create your church and the first owner account. The songs stay on this server, under your church's care.",
    `<form class="stack" id="setup-form">
      <label>Church name<input name="church" autocomplete="organization" required /></label>
      <label>Your name<input name="owner" autocomplete="name" required /></label>
      <label>Username<input name="username" autocomplete="username" autocapitalize="none" required /></label>
      <label>Password<input name="password" type="password" minlength="10" autocomplete="new-password" required /></label>
      <button class="button primary wide" type="submit">Create the library</button>
      <p class="form-message" role="status"></p>
    </form>`,
  );

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
    </form>`,
  );

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
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
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
  app.innerHTML = authFrame(
    "This desktop sign-in link is not valid",
    "Start the connection again from the Psalm150 desktop app. Nothing has been shared.",
    `<a class="button secondary wide" href="/">Open the song library</a>`,
  );
}

function renderDesktopConsent(): void {
  const desktop = pendingDesktop();
  if (!desktop || !session) return;
  const forbiddenMessage = "Only leaders can connect a desktop. Ask a leader to sign in.";
  const canConnect = session.role !== "viewer";
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

  document.querySelector("#desktop-cancel")?.addEventListener("click", () => {
    returnToDesktop(desktop, { error: "access_denied" });
  });
  document.querySelector("#switch-account")?.addEventListener("click", () => {
    clearSession();
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

/* ── Signed-in shell and routing ─────────────────────────────────────────── */

interface Route {
  pattern: RegExp;
  view: View;
  tab: Tab;
}

type Tab = "songs" | "sets" | "remote" | "more";

const ROUTES: Route[] = [
  { pattern: /^\/songs$/, view: songList, tab: "songs" },
  { pattern: /^\/songs\/new$/, view: (ctx) => songEditor(ctx, []), tab: "songs" },
  { pattern: /^\/songs\/([0-9a-f-]{36})$/, view: songDetail, tab: "songs" },
  { pattern: /^\/songs\/([0-9a-f-]{36})\/edit$/, view: songEditor, tab: "songs" },
  { pattern: /^\/sets$/, view: setList, tab: "sets" },
  { pattern: /^\/sets\/new$/, view: (ctx) => setEditor(ctx, []), tab: "sets" },
  { pattern: /^\/sets\/([0-9a-f-]{36})$/, view: setDetail, tab: "sets" },
  { pattern: /^\/sets\/([0-9a-f-]{36})\/edit$/, view: setEditor, tab: "sets" },
  { pattern: /^\/sets\/([0-9a-f-]{36})\/play\/(\d+)$/, view: setPlay, tab: "sets" },
  { pattern: /^\/remote$/, view: remoteList, tab: "remote" },
  { pattern: /^\/remote\/([0-9a-f-]{36})$/, view: remoteDesktop, tab: "remote" },
  { pattern: /^\/more$/, view: moreView, tab: "more" },
];

const TABS: Array<{ tab: Tab; label: string; icon: IconName; href: string }> = [
  { tab: "songs", label: "Songs", icon: "songs", href: "#/songs" },
  { tab: "sets", label: "Sets", icon: "sets", href: "#/sets" },
  { tab: "remote", label: "Remote", icon: "remote", href: "#/remote" },
  { tab: "more", label: "More", icon: "more", href: "#/more" },
];

let cleanup: Cleanup | void;
let routeToken = 0;
let hashListener: (() => void) | null = null;

function renderShell(): void {
  if (!session) return;
  app.innerHTML = `<div class="shell">
    <nav class="tabbar" aria-label="Sections">
      <div class="brand" aria-hidden="true"><span class="brand-mark">150</span><span>PSA150</span></div>
      ${TABS.map((tab) => `<a class="tab" href="${tab.href}" data-tab="${tab.tab}">${icon(tab.icon)}<span>${tab.label}</span></a>`).join("")}
    </nav>
    <main class="page" id="page" tabindex="-1"></main>
  </div>
  <div class="toast" id="toast" role="status" aria-live="polite"></div>`;

  if (!hashListener) {
    hashListener = () => void route();
    window.addEventListener("hashchange", hashListener);
  }
  if (!location.hash || location.hash === "#" || location.hash === "#/") {
    history.replaceState(null, "", "#/sets");
  }
  void route();
}

async function route(): Promise<void> {
  if (!session) return;
  const main = document.querySelector<HTMLElement>("#page");
  if (!main) return;
  const path = location.hash.replace(/^#/, "").split("?")[0] || "/sets";
  const match = ROUTES.map((entry) => ({ entry, found: entry.pattern.exec(path) })).find((candidate) => candidate.found);
  if (!match?.found) {
    history.replaceState(null, "", "#/sets");
    return route();
  }

  if (typeof cleanup === "function") cleanup();
  cleanup = undefined;
  const token = ++routeToken;
  document.querySelectorAll<HTMLElement>("[data-tab]").forEach((tab) => {
    const on = tab.dataset.tab === match.entry.tab;
    tab.classList.toggle("on", on);
    if (on) tab.setAttribute("aria-current", "page");
    else tab.removeAttribute("aria-current");
  });
  document.body.dataset.route = path.split("/").slice(0, 4).join("/").replace(/[0-9a-f-]{36}/g, "id").replace(/\/\d+$/, "");
  main.classList.add("loading");

  try {
    const result = await match.entry.view(context(main), match.found.slice(1));
    if (token !== routeToken) {
      if (typeof result === "function") result();
      return;
    }
    cleanup = result;
    main.classList.remove("loading");
    window.scrollTo({ top: 0 });
  } catch (error) {
    if (token !== routeToken) return;
    main.classList.remove("loading");
    if (error instanceof ApiError && error.status === 401) {
      signOut();
      return;
    }
    main.innerHTML = `<div class="empty-state"><h2>${error instanceof ApiError && error.status === 404 ? "Not found" : "Could not load this page"}</h2><p>${escapeHtml(errorMessage(error))}</p><a class="button secondary" href="#/sets">Go to sets</a></div>`;
  }
}

function context(main: HTMLElement): AppContext {
  return {
    api,
    session: session!,
    canEdit: session!.role !== "viewer",
    main,
    navigate(target: string, replace = false) {
      if (location.hash === target) {
        void route();
      } else if (replace) {
        history.replaceState(null, "", target);
        void route();
      } else {
        location.hash = target;
      }
    },
    run,
    signOut,
    applyTheme,
  };
}

async function run(action: () => Promise<void>): Promise<void> {
  if (busy) return;
  busy = true;
  document.body.classList.add("is-busy");
  try {
    await action();
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      signOut();
      return;
    }
    showToast(errorMessage(error), true);
  } finally {
    busy = false;
    document.body.classList.remove("is-busy");
  }
}

function signOut(): void {
  if (typeof cleanup === "function") cleanup();
  cleanup = undefined;
  clearSession();
  renderLogin();
}

/** Theme preference: light, dark, or (unset) follow the system. */
function applyTheme(): void {
  const theme = readPreference("theme");
  if (theme === "light" || theme === "dark") document.documentElement.dataset.theme = theme;
  else delete document.documentElement.dataset.theme;
  const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  const dark = theme === "dark" || (!theme && matchMedia("(prefers-color-scheme: dark)").matches);
  if (meta) meta.content = dark ? "#060606" : "#f4f4f1";
}

function authFrame(title: string, copy: string, form: string): string {
  return `<main class="auth">
    <div class="auth-card">
      <div class="brand large"><span class="brand-mark">150</span><span>PSA150</span></div>
      <h1>${escapeHtml(title)}</h1>
      <p class="lede">${copy}</p>
      ${form}
    </div>
    <p class="fine-print">"Let everything that has breath praise the Lord." Psalm 150:6</p>
  </main>`;
}

function renderFatal(error: unknown): void {
  app.innerHTML = `<main class="auth"><div class="auth-card"><div class="brand large"><span class="brand-mark">150</span><span>PSA150</span></div><h1>The song server is not reachable</h1><p class="lede">${escapeHtml(errorMessage(error))}</p><button class="button primary wide" id="retry">Try again</button></div></main>`;
  document.querySelector("#retry")?.addEventListener("click", () => location.reload());
}

function readSession(): Session | null {
  try {
    const stored = sessionStorage.getItem(SESSION_KEY);
    return stored ? JSON.parse(stored) as Session : null;
  } catch {
    return null;
  }
}

function clearSession(): void {
  session = null;
  try {
    sessionStorage.removeItem(SESSION_KEY);
  } catch {
    // Nothing stored.
  }
}
