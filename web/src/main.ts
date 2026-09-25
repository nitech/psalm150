import "./styles.css";
import { ApiError, SongServerApi } from "./api.ts";
import type { DeviceToken, Session, SongDetail, SongSummary } from "./types.ts";

const app = document.querySelector<HTMLDivElement>("#app")!;
if (!app) throw new Error("Application mount point is missing");

const SESSION_KEY = "psa150-server-session";
let session = readSession();
let songs: SongSummary[] = [];
let selected: SongDetail | null = null;
let search = "";
let busy = false;
const api = new SongServerApi(() => session?.token ?? null);

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
      await showSignedIn();
    }
  } catch (error) {
    renderFatal(error);
  }
}

function renderSetup(): void {
  app.innerHTML = authFrame(
    "Begin your library",
    "Create the first church and owner. Everything remains under your church’s care.",
    `<form class="auth-form" id="setup-form">
      <label>Church name<input name="church" autocomplete="organization" required /></label>
      <label>Your name<input name="owner" autocomplete="name" required /></label>
      <label>Username<input name="username" autocomplete="username" required /></label>
      <label>Password<input name="password" type="password" minlength="10" autocomplete="new-password" required /></label>
      <button class="primary wide" type="submit">Create the library <span>→</span></button>
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
    "Return to the songs",
    desktop
      ? `Sign in to connect <strong>${escapeHtml(desktop.deviceName)}</strong> to this song server.`
      : "Sign in to tend your church’s shared library.",
    `<form class="auth-form" id="login-form">
      <label>Username<input name="username" autocomplete="username" required autofocus /></label>
      <label>Password<input name="password" type="password" autocomplete="current-password" required /></label>
      <button class="primary wide" type="submit">Open the library <span>→</span></button>
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
    await showSignedIn();
  } catch (error) {
    if (message) message.textContent = errorMessage(error);
  } finally {
    setFormBusy(form, false);
  }
}

async function showSignedIn(): Promise<void> {
  if (pendingDesktop()) {
    renderDesktopConsent();
  } else {
    await loadLibrary();
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
    `<a class="secondary desktop-link" href="/">Open the song library</a>`,
  );
}

function renderDesktopConsent(): void {
  const desktop = pendingDesktop();
  if (!desktop || !session) return;
  const forbiddenMessage = "Only leaders can connect a desktop. Ask a leader to sign in.";
  const canConnect = session.role !== "viewer";
  app.innerHTML = authFrame(
    "Connect this desktop?",
    `<strong>${escapeHtml(desktop.deviceName)}</strong> will be connected to <strong>${escapeHtml(session.church_name)}</strong>’s song library. It can read the songs and keep them in sync, including adding, editing and deleting songs.`,
    `<form class="auth-form" id="desktop-consent">
      <p class="desktop-account">Signed in as <strong>${escapeHtml(session.display_name)}</strong> · <button type="button" class="link-button" id="switch-account">Use another account</button></p>
      <p class="form-message" role="status">${canConnect ? "" : forbiddenMessage}</p>
      <div class="consent-actions">
        ${canConnect ? `<button class="primary" type="submit" id="desktop-connect">Connect <span>→</span></button>` : ""}
        <button class="secondary" type="button" id="desktop-cancel">Cancel</button>
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

async function loadLibrary(): Promise<void> {
  try {
    songs = await api.listSongs(search);
    if (selected && !songs.some((song) => song.id === selected?.id)) selected = null;
    renderLibrary();
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      clearSession();
      renderLogin();
      return;
    }
    throw error;
  }
}

function renderLibrary(): void {
  if (!session) return;
  const initials = session.display_name
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  app.innerHTML = `<div class="library-shell">
    <aside class="rail">
      <div class="brand"><span class="brand-cross" aria-hidden="true">✦</span><div><strong>PSA150</strong><small>Song Library</small></div></div>
      <div class="psalm-mark" aria-hidden="true">150</div>
      <nav aria-label="Library sections">
        <button class="nav-item active"><span>01</span>Songs</button>
        <button class="nav-item" disabled title="Planned for a later phase"><span>02</span>Plans <em>Later</em></button>
        <button class="nav-item" disabled title="Planned for a later phase"><span>03</span>People <em>Later</em></button>
      </nav>
      <div class="rail-foot"><span class="pulse"></span><span>Private church server</span></div>
    </aside>
    <main class="workspace">
      <header class="topbar">
        <div><p class="eyebrow">${escapeHtml(session.church_name)}</p><h1>Song library</h1></div>
        <div class="account"><div><strong>${escapeHtml(session.display_name)}</strong><small>${session.role}</small></div><span class="avatar">${escapeHtml(initials)}</span><button class="quiet" id="logout" title="Sign out">↗</button></div>
      </header>
      <section class="toolbar" aria-label="Song actions">
        <form class="search" id="search-form"><span aria-hidden="true">⌕</span><input name="search" value="${escapeHtml(search)}" placeholder="Find a title, lyric, number…" aria-label="Search songs" /></form>
        <input id="file-import" type="file" accept=".pro,.cho,.chordpro,text/plain" multiple hidden />
        <button class="secondary" id="import">Import ChordPro</button>
        <button class="secondary" id="export" ${songs.length ? "" : "disabled"}>Export</button>
        <button class="secondary desktop-access" id="connect-device">Connect desktop <span aria-hidden="true">↗</span></button>
        <button class="primary" id="new-song">New song <span>＋</span></button>
      </section>
      <section class="library-body">
        <div class="song-index">
          <div class="index-heading"><span>${songs.length} ${songs.length === 1 ? "song" : "songs"}</span><span>Updated</span></div>
          <div class="song-list">${renderSongRows()}</div>
        </div>
        <aside class="detail-pane${selected ? " open" : ""}" aria-label="Song detail">${renderDetail()}</aside>
      </section>
    </main>
  </div>
  <dialog id="song-dialog" class="editor-dialog"></dialog>
  <dialog id="device-dialog" class="token-dialog"></dialog>
  <div class="toast" id="toast" role="status" aria-live="polite"></div>`;

  document.body.classList.toggle("detail-open", Boolean(selected));
  bindLibraryEvents();
}

function renderSongRows(): string {
  if (!songs.length) {
    return `<div class="empty-state"><span class="empty-note">♪</span><h2>${search ? "No songs found" : "A library ready to be filled"}</h2><p>${search ? "Try another title or a line from the lyrics." : "Import your ChordPro folder or begin with one song."}</p></div>`;
  }
  return songs.map((song, index) => `<button class="song-row ${selected?.id === song.id ? "selected" : ""}" data-song-id="${song.id}" style="--order:${index}">
    <span class="song-number">${escapeHtml(song.song_number ?? String(index + 1).padStart(2, "0"))}</span>
    <span class="song-identity"><strong>${escapeHtml(song.title)}</strong><small>${escapeHtml(song.authors || "Author not recorded")}${song.language ? ` · ${escapeHtml(song.language.toUpperCase())}` : ""}</small></span>
    <time datetime="${song.updated_at}">${relativeDate(song.updated_at)}</time><span class="row-arrow">→</span>
  </button>`).join("");
}

function renderDetail(): string {
  if (!selected) {
    return `<div class="detail-empty"><span>SELECT A SONG</span><div class="staff" aria-hidden="true">𝄞</div><p>Lyrics, metadata, and the current ChordPro source will appear here.</p></div>`;
  }
  const lyricText = selected.chordpro
    .split("\n")
    .filter((line) => !line.trim().startsWith("{") && line.trim())
    .map((line) => line.replace(/\[[^\]]*\]/g, ""))
    .join("\n");
  return `<div class="detail-content">
    <button class="detail-close" id="close-detail" aria-label="Back to songs">← Back</button>
    <p class="eyebrow">Current revision</p>
    <h2>${escapeHtml(selected.title)}</h2>
    <p class="detail-byline">${escapeHtml(selected.authors || "Author not recorded")}</p>
    <pre class="lyric-preview">${escapeHtml(lyricText || "No lyric lines yet.")}</pre>
    <dl><div><dt>Revision</dt><dd>${selected.revision_id.slice(0, 8)}</dd></div><div><dt>Language</dt><dd>${escapeHtml(selected.language?.toUpperCase() ?? "—")}</dd></div></dl>
    <button class="primary wide" id="edit-song">Edit ChordPro <span>→</span></button>
  </div>`;
}

function bindLibraryEvents(): void {
  document.querySelector("#logout")?.addEventListener("click", () => {
    clearSession();
    renderLogin();
  });
  document.querySelector<HTMLFormElement>("#search-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    search = String(new FormData(event.currentTarget as HTMLFormElement).get("search") ?? "");
    await run(() => loadLibrary());
  });
  document.querySelectorAll<HTMLElement>("[data-song-id]").forEach((row) => row.addEventListener("click", async () => {
    await run(async () => {
      selected = await api.getSong(String(row.dataset.songId));
      renderLibrary();
    });
  }));
  document.querySelector("#close-detail")?.addEventListener("click", () => {
    selected = null;
    renderLibrary();
  });
  document.querySelector("#new-song")?.addEventListener("click", () => openEditor());
  document.querySelector("#edit-song")?.addEventListener("click", () => openEditor(selected ?? undefined));
  document.querySelector("#import")?.addEventListener("click", () => document.querySelector<HTMLInputElement>("#file-import")?.click());
  document.querySelector<HTMLInputElement>("#file-import")?.addEventListener("change", async (event) => {
    const input = event.currentTarget as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    if (!files.length) return;
    await run(async () => {
      const payload = await Promise.all(files.map(async (file) => ({ filename: file.name, chordpro: await file.text() })));
      const result = await api.importSongs(payload);
      search = "";
      songs = await api.listSongs();
      renderLibrary();
      const skipped = result.skipped_existing
        ? ` ${result.skipped_existing} already ${result.skipped_existing === 1 ? "exists" : "exist"}.`
        : "";
      showToast(`Imported ${result.songs.length} ${result.songs.length === 1 ? "song" : "songs"}.${skipped}`);
    });
  });
  document.querySelector("#export")?.addEventListener("click", () => void run(exportLibrary));
  document.querySelector("#connect-device")?.addEventListener("click", () => void run(openDeviceDialog));
}

function openEditor(song?: SongDetail): void {
  const dialog = document.querySelector<HTMLDialogElement>("#song-dialog");
  if (!dialog) return;
  const initial = song?.chordpro ?? "{title: }\n{author: }\n{language: }\n\n{start_of_verse}\n\n{end_of_verse}\n";
  dialog.innerHTML = `<form method="dialog" class="editor-form" id="editor-form">
    <header><div><p class="eyebrow">${song ? "Edit current revision" : "Add to the library"}</p><h2>${song ? escapeHtml(song.title) : "New song"}</h2></div><button class="dialog-close" value="cancel" aria-label="Close">×</button></header>
    <label for="chordpro">ChordPro source</label>
    <textarea id="chordpro" name="chordpro" spellcheck="true">${escapeHtml(initial)}</textarea>
    <footer><p class="form-message" role="status"></p><button class="secondary" value="cancel">Cancel</button><button class="primary" id="save-song" value="default">Save revision <span>→</span></button></footer>
  </form>`;
  dialog.showModal();
  requestAnimationFrame(() => dialog.querySelector<HTMLTextAreaElement>("textarea")?.focus());

  dialog.querySelector<HTMLFormElement>("#editor-form")?.addEventListener("submit", async (event) => {
    if ((event.submitter as HTMLButtonElement | null)?.value === "cancel") return;
    event.preventDefault();
    const form = event.currentTarget as HTMLFormElement;
    const source = String(new FormData(form).get("chordpro") ?? "");
    setFormBusy(form, true);
    try {
      if (song) {
        selected = await api.updateSong(song.id, song.revision_id, source);
      } else {
        const created = await api.createSong(source);
        selected = await api.getSong(created.id);
      }
      songs = await api.listSongs(search);
      dialog.close();
      renderLibrary();
      showToast(song ? "Saved a new revision." : "Added the song.");
    } catch (error) {
      const message = form.querySelector<HTMLElement>(".form-message");
      if (message) message.textContent = errorMessage(error);
    } finally {
      setFormBusy(form, false);
    }
  });
}

async function openDeviceDialog(): Promise<void> {
  const dialog = document.querySelector<HTMLDialogElement>("#device-dialog");
  if (!dialog) return;
  const devices = await api.listDeviceTokens();
  const deviceRows = devices.length
    ? `<div class="device-list"><p class="eyebrow">Connected desktops</p>${devices.map((device) => `<div><span><strong>${escapeHtml(device.name)}</strong><small>${device.last_used_at ? `Last used ${relativeDate(device.last_used_at)}` : "Not used yet"}</small></span><button type="button" class="revoke-device" data-device-id="${device.id}">Revoke</button></div>`).join("")}</div>`
    : "";
  dialog.innerHTML = `<form method="dialog" class="device-form" id="device-form">
    <button class="dialog-close" value="cancel" aria-label="Close">×</button>
    <p class="eyebrow">Offline-capable replica</p><h2>Connect a desktop</h2>
    <p>Name the projection computer. The token is shown once and can read the church library and add songs that are not already there. It cannot change or delete existing songs.</p>
    <label>Computer name<input name="name" placeholder="Sanctuary PC" required maxlength="120" /></label>
    <p class="form-message" role="status"></p>
    <button class="primary wide" id="create-token" value="default">Create connection token <span>→</span></button>
    ${deviceRows}
  </form>`;
  dialog.showModal();
  dialog.querySelector<HTMLInputElement>("input")?.focus();
  dialog.querySelector<HTMLFormElement>("#device-form")?.addEventListener("submit", async (event) => {
    if ((event.submitter as HTMLButtonElement | null)?.value === "cancel") return;
    event.preventDefault();
    const form = event.currentTarget as HTMLFormElement;
    setFormBusy(form, true);
    try {
      const token = await api.createDeviceToken(String(new FormData(form).get("name")));
      renderToken(dialog, token);
    } catch (error) {
      const message = form.querySelector<HTMLElement>(".form-message");
      if (message) message.textContent = errorMessage(error);
      setFormBusy(form, false);
    }
  });
  dialog.querySelectorAll<HTMLButtonElement>(".revoke-device").forEach((button) => {
    button.addEventListener("click", async () => {
      button.disabled = true;
      try {
        await api.revokeDeviceToken(String(button.dataset.deviceId));
        button.closest("div")?.remove();
        showToast("Desktop access revoked.");
      } catch (error) {
        button.disabled = false;
        showToast(errorMessage(error), true);
      }
    });
  });
}

function renderToken(dialog: HTMLDialogElement, device: DeviceToken): void {
  dialog.innerHTML = `<div class="device-form token-result"><button class="dialog-close" id="close-token" aria-label="Close">×</button>
    <p class="eyebrow">${escapeHtml(device.name)}</p><h2>Token created</h2>
    <p>Copy this token now. For safety, the server will not show it again.</p>
    <code>${escapeHtml(device.token)}</code>
    <button class="primary wide" id="copy-token">Copy token <span>⧉</span></button>
  </div>`;
  dialog.querySelector("#close-token")?.addEventListener("click", () => dialog.close());
  dialog.querySelector("#copy-token")?.addEventListener("click", async () => {
    await navigator.clipboard.writeText(device.token);
    showToast("Connection token copied.");
  });
}

async function exportLibrary(): Promise<void> {
  const blob = await api.exportSongs();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "psa150-library.zip";
  anchor.click();
  URL.revokeObjectURL(url);
  showToast("Library export prepared.");
}

async function run(action: () => Promise<void>): Promise<void> {
  if (busy) return;
  busy = true;
  document.body.classList.add("is-busy");
  try {
    await action();
  } catch (error) {
    showToast(errorMessage(error), true);
  } finally {
    busy = false;
    document.body.classList.remove("is-busy");
  }
}

function authFrame(title: string, copy: string, form: string): string {
  return `<main class="auth-shell">
    <section class="auth-story"><div class="auth-brand"><span>✦</span> PSA150</div><div class="scripture-mark" aria-hidden="true">150</div><blockquote>“Let everything that has breath praise the Lord.”</blockquote><p>Psalm 150:6</p></section>
    <section class="auth-panel"><div class="auth-card"><p class="eyebrow">Your church · Your songs</p><h1>${title}</h1><p class="lede">${copy}</p>${form}</div><small class="privacy-note">Private by default · Self-hosted · Made for worship</small></section>
  </main>`;
}

function renderFatal(error: unknown): void {
  app.innerHTML = `<main class="fatal"><span>PSA150</span><h1>The Song Server is not reachable.</h1><p>${escapeHtml(errorMessage(error))}</p><button onclick="location.reload()">Try again</button></main>`;
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
  selected = null;
  sessionStorage.removeItem(SESSION_KEY);
  document.body.classList.remove("detail-open");
}

function setFormBusy(form: HTMLFormElement, value: boolean): void {
  form.querySelectorAll<HTMLInputElement | HTMLButtonElement | HTMLTextAreaElement>("input,button,textarea")
    .forEach((control) => { control.disabled = value; });
  form.classList.toggle("busy", value);
}

function showToast(message: string, error = false): void {
  const toast = document.querySelector<HTMLElement>("#toast");
  if (!toast) return;
  toast.textContent = message;
  toast.classList.toggle("error", error);
  toast.classList.add("visible");
  window.setTimeout(() => toast.classList.remove("visible"), 3200);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong.";
}

function relativeDate(value: string): string {
  const date = new Date(value);
  const days = Math.floor((Date.now() - date.getTime()) / 86_400_000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 14) return `${days} days ago`;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    '"': "&quot;",
  })[character] ?? character);
}
