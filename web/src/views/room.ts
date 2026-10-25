import { announce as say, setTitle } from "../a11y.ts";
import { ApiError, type SongServerApi } from "../api.ts";
import { icon } from "../icons.ts";
import type { RoomSlide, RoomView } from "../types.ts";
import { errorMessage, escapeHtml, readPreference, showFormError, writePreference } from "../ui.ts";

/**
 * Following a room: anyone, signed in or not, types the room name a desktop
 * shows (such as "Lily") and sees the words it projects on their own phone,
 * live, in large text. Made for people who cannot read the screen well, so
 * the text size, contrast and following are theirs to set, the screen stays
 * on, and a screen reader can be told each new slide.
 *
 * Lives outside the app shell at `/join` and `/join/{room}`, so it needs no
 * account and no public library.
 */

export const SIZES = [1, 1.25, 1.5, 1.75, 2, 2.5, 3];
const RECONNECT_CHECK_MS = 4000;

export function joinPath(): string | null {
  const match = /^\/join(?:\/([^/]*))?\/?$/.exec(location.pathname);
  if (!match) return null;
  if (!match[1]) return "";
  try {
    return decodeURIComponent(match[1]);
  } catch {
    // A broken link such as /join/%ZZ: ask for the room instead.
    return "";
  }
}

export function renderJoin(app: HTMLElement, api: SongServerApi, message = ""): void {
  history.replaceState(null, "", "/join");
  setTitle("Join a room");
  const last = readPreference("room") ?? "";
  app.innerHTML = `<main class="auth">
    <div class="auth-card">
      <div class="brand large"><span class="brand-mark" aria-hidden="true">150</span><span>PSA150</span></div>
      <h1>Follow the words</h1>
      <p class="lede">Type the room name shown by your church, such as <strong>Lily</strong>, to read the words on the screen on this phone, as large as you like.</p>
      <form class="stack" id="join-form">
        <label>Room name<input name="room" value="${escapeHtml(last)}" autocomplete="off" autocapitalize="words" enterkeyhint="go" maxlength="30" required autofocus /></label>
        <button class="button primary wide" type="submit">Join</button>
        <p class="form-message" role="status"></p>
      </form>
      <a class="button secondary wide" href="/">Open the song library</a>
    </div>
  </main>`;
  const form = app.querySelector<HTMLFormElement>("#join-form")!;
  const field = form.querySelector<HTMLInputElement>("input[name=room]")!;
  // Like autofocus, also when coming back from a room. A message (no such
  // room) is tied to the field, so it is read when the field gets focus.
  if (message) showFormError(form, message, field);
  else field.focus();
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const name = String(new FormData(form).get("room")).trim();
    if (!name) return;
    const status = form.querySelector<HTMLElement>(".form-message")!;
    status.textContent = "";
    form.querySelector("button")!.disabled = true;
    try {
      const view = await api.getRoom(name);
      openRoom(app, api, view);
    } catch (error) {
      form.querySelector("button")!.disabled = false;
      showFormError(form, error instanceof ApiError && error.status === 404
        ? `There is no room called ${name}. Check the name on the screen and try again.`
        : errorMessage(error), field);
    }
  });
}

/** `/join/{room}`: open the room straight away, or ask again if it is not there. */
export async function renderRoomFromPath(app: HTMLElement, api: SongServerApi, name: string): Promise<void> {
  try {
    openRoom(app, api, await api.getRoom(name));
  } catch (error) {
    renderJoin(app, api, error instanceof ApiError && error.status === 404
      ? `There is no room called ${name}. Check the name on the screen and try again.`
      : errorMessage(error));
  }
}

function openRoom(app: HTMLElement, api: SongServerApi, first: RoomView): void {
  writePreference("room", first.room_name);
  history.replaceState(null, "", `/join/${encodeURIComponent(first.room_name)}`);

  let size = Math.min(SIZES.length - 1, Math.max(0, Number(readPreference("room-size") ?? 2)));
  let contrast = readPreference("room-contrast") === "on";
  let follow = readPreference("room-follow") !== "off";
  let announce = readPreference("room-announce") === "on";
  let view = first;
  /** The words drawn now, so a slide change only moves the highlight. */
  let drawnSong = "";
  let connected = true;

  app.innerHTML = `<main class="room" id="room">
    <header class="room-bar">
      <div class="room-title">
        <p class="eyebrow">Room</p>
        <h1 id="room-name" tabindex="-1"></h1>
      </div>
      <span class="room-status" id="room-status" role="status"></span>
      <div class="room-tools" role="group" aria-label="Reading settings">
        <button class="icon-button" id="room-smaller" aria-label="Smaller text" title="Smaller text">${icon("minus")}</button>
        <button class="icon-button" id="room-larger" aria-label="Larger text" title="Larger text">${icon("plus")}</button>
        <button class="icon-button" id="room-contrast" aria-label="High contrast" title="High contrast">${icon("sun")}</button>
        <button class="icon-button" id="room-follow" aria-label="Follow the screen" title="Follow the screen">${icon("follow")}</button>
        <button class="icon-button" id="room-announce" aria-label="Read each new slide aloud with the screen reader" title="Announce new slides (screen readers)">${icon("text")}</button>
        <button class="icon-button" id="room-leave" aria-label="Leave the room" title="Leave the room">${icon("close")}</button>
      </div>
    </header>
    <section class="room-body" id="room-body" aria-live="off"></section>
    <p class="sr-only" id="room-announcer" aria-live="polite"></p>
    <p class="sr-only" id="announcer" role="status"></p>
  </main>`;

  const root = app.querySelector<HTMLElement>("#room")!;
  const body = app.querySelector<HTMLElement>("#room-body")!;
  const announcer = app.querySelector<HTMLElement>("#room-announcer")!;

  const applySettings = () => {
    root.style.setProperty("--room-scale", String(SIZES[size]));
    root.classList.toggle("contrast", contrast);
    setPressed("#room-contrast", contrast);
    setPressed("#room-follow", follow);
    setPressed("#room-announce", announce);
    // At either end the button stays focusable (aria-disabled), so focus is
    // not lost from under a finger or the keyboard.
    app.querySelector("#room-smaller")!.setAttribute("aria-disabled", String(size === 0));
    app.querySelector("#room-larger")!.setAttribute("aria-disabled", String(size === SIZES.length - 1));
  };
  const setPressed = (selector: string, on: boolean) => {
    app.querySelector(selector)?.setAttribute("aria-pressed", String(on));
  };

  const render = (previous: RoomView | null) => {
    app.querySelector("#room-name")!.textContent = view.room_name;
    setTitle(view.room_name, "Room");
    app.querySelector("#room-status")!.textContent = !connected
      ? "Reconnecting…"
      : { live: "Live", blank: "Screen is blank", idle: "Waiting", offline: "Not connected" }[view.status];
    root.dataset.status = connected ? view.status : "reconnecting";

    if (view.status === "idle" || view.status === "offline") {
      drawnSong = "";
      body.innerHTML = `<div class="room-waiting">
        <h2>${view.status === "idle" ? "Nothing is on the screen" : "The projection computer is not connected"}</h2>
        <p>${view.status === "idle"
          ? "The words show here as soon as the next song is projected. You can leave this page open."
          : "This page will show the words again when it is back. You can leave it open."}</p>
      </div>`;
      return;
    }

    const song = JSON.stringify([view.song_title, view.slides]);
    if (song !== drawnSong) {
      drawnSong = song;
      body.innerHTML = `<h2 class="room-song">${escapeHtml(view.song_title ?? "")}</h2>
        ${view.slides.map((slide, index) => slideHtml(slide, index)).join("")}`;
    }
    body.querySelectorAll<HTMLElement>(".room-slide").forEach((element) => {
      const current = Number(element.dataset.index) === view.slide_index;
      element.classList.toggle("current", current);
      if (current) element.setAttribute("aria-current", "true");
      else element.removeAttribute("aria-current");
    });

    const moved = !previous || previous.slide_index !== view.slide_index || previous.song_title !== view.song_title
      || previous.status === "idle" || previous.status === "offline";
    if (moved) {
      if (follow) scrollToCurrent(!previous);
      if (announce && view.status === "live") {
        const slide = view.slide_index === null ? undefined : view.slides[view.slide_index];
        if (slide) announcer.textContent = [slide.label, ...slide.lines].filter(Boolean).join(". ");
      }
    }
  };

  const scrollToCurrent = (instant: boolean) => {
    const current = body.querySelector<HTMLElement>(".room-slide.current");
    if (!current) return;
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    current.scrollIntoView({ block: "center", behavior: instant || reduce ? "auto" : "smooth" });
  };

  const update = (next: RoomView) => {
    const previous = view;
    view = next;
    render(previous);
    void keepAwake(next.status === "live" || next.status === "blank");
  };

  const resize = (step: number) => {
    const next = Math.min(SIZES.length - 1, Math.max(0, size + step));
    if (next === size) return;
    size = next;
    writePreference("room-size", String(size));
    applySettings();
    say(`Text size ${Math.round(SIZES[size] * 100)}%`);
    if (follow) scrollToCurrent(true);
  };
  app.querySelector("#room-smaller")?.addEventListener("click", () => resize(-1));
  app.querySelector("#room-larger")?.addEventListener("click", () => resize(1));
  app.querySelector("#room-contrast")?.addEventListener("click", () => {
    contrast = !contrast;
    writePreference("room-contrast", contrast ? "on" : null);
    applySettings();
  });
  app.querySelector("#room-follow")?.addEventListener("click", () => {
    follow = !follow;
    writePreference("room-follow", follow ? null : "off");
    applySettings();
    if (follow) scrollToCurrent(false);
  });
  app.querySelector("#room-announce")?.addEventListener("click", () => {
    announce = !announce;
    writePreference("room-announce", announce ? "on" : null);
    applySettings();
  });

  // EventSource reconnects by itself after a dropped connection. When the
  // room has gone (renamed, closed), it gives up: then look why.
  const source = new EventSource(`/api/v1/public/rooms/${encodeURIComponent(first.room_name)}/events`);
  let checkTimer = 0;
  source.addEventListener("room", (event) => {
    connected = true;
    update(JSON.parse((event as MessageEvent<string>).data) as RoomView);
  });
  source.addEventListener("error", () => {
    connected = false;
    render(view);
    if (source.readyState !== EventSource.CLOSED) return;
    window.clearTimeout(checkTimer);
    checkTimer = window.setTimeout(async () => {
      try {
        const again = await api.getRoom(view.room_name);
        leave();
        openRoom(app, api, again);
      } catch (error) {
        if (error instanceof ApiError && error.status === 404) {
          leave();
          renderJoin(app, api, `The room ${view.room_name} has closed or was renamed. Check the name on the screen.`);
        } else {
          source.dispatchEvent(new Event("error"));
        }
      }
    }, RECONNECT_CHECK_MS);
  });

  const onVisible = () => {
    if (document.visibilityState === "visible") void keepAwake(view.status === "live" || view.status === "blank");
  };
  document.addEventListener("visibilitychange", onVisible);

  const leave = () => {
    source.close();
    window.clearTimeout(checkTimer);
    document.removeEventListener("visibilitychange", onVisible);
    void keepAwake(false);
  };
  app.querySelector("#room-leave")?.addEventListener("click", () => {
    leave();
    writePreference("room", null);
    renderJoin(app, api);
  });

  applySettings();
  // The first drawing jumps straight to the words on screen.
  render(null);
  // From the join form, focus would be lost with it: start at the room's name.
  if (!app.contains(document.activeElement) || document.activeElement === document.body) {
    app.querySelector<HTMLElement>("#room-name")?.focus({ preventScroll: true });
  }
  void keepAwake(first.status === "live" || first.status === "blank");
}

export function slideHtml(slide: RoomSlide, index: number): string {
  return `<section class="room-slide" data-index="${index}">
    ${slide.label ? `<p class="room-label">${escapeHtml(slide.label)}</p>` : ""}
    ${slide.lines.map((line) => `<p class="room-line">${escapeHtml(line) || "&nbsp;"}</p>`).join("")}
  </section>`;
}

/** Keeps the phone's screen on while words are shown, where the browser allows it. */
let wakeLock: { release(): Promise<void> } | null = null;

async function keepAwake(on: boolean): Promise<void> {
  const wake = (navigator as Navigator & { wakeLock?: { request(type: "screen"): Promise<{ release(): Promise<void>; released: boolean }> } }).wakeLock;
  if (!on) {
    const held = wakeLock;
    wakeLock = null;
    await held?.release().catch(() => undefined);
    return;
  }
  if (!wake || (wakeLock && !(wakeLock as { released?: boolean }).released)) return;
  wakeLock = await wake.request("screen").catch(() => null);
}
