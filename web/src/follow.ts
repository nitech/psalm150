import { announce } from "../../shared/songs/a11y.ts";
import type { SongServerApi } from "./api.ts";
import { icon } from "./icons.ts";
import type { RemoteDesktop } from "./types.ts";
import { escapeHtml, readPreference, writePreference } from "./ui.ts";
import { SIZES, slideHtml } from "./views/room.ts";
import { t } from "../../shared/songs/i18n.ts";

/**
 * Following the projector from the app, one of the modes behind the Live
 * button in the top bar (live.ts). Switched on, the words the desktop shows fill
 * the screen in large text, as in `/join`, and follow along; switched off,
 * the screen underneath (a set, a song) is back where it was, since the
 * words lie over it rather than replacing it.
 *
 * Signed-in people only: it reads the church's desktops from the same live
 * stream as Remote (`GET /remote/desktops/events`), which carries the words
 * whether or not the desktop shares them in its room. The stream is open
 * while the app is in view.
 */
export interface Follow {
  /** Starts watching the church's desktops (signed in, app in view). */
  start(): void;
  /** Stops watching and switches following off (signed out). */
  stop(): void;
  /** Back to the screen underneath. */
  off(): void;
  /** Follows a desktop (the one given, else the one followed last), or stops. */
  setOn(value: boolean, deviceId?: string): void;
  readonly on: boolean;
  /** The church's desktops, as the live stream last told. */
  readonly desktops: RemoteDesktop[];
  /** The desktop followed now, or the one that would be. */
  readonly target: RemoteDesktop | null;
}

export function installFollow(api: SongServerApi, changed: () => void): Follow {
  let desktops: RemoteDesktop[] = [];
  let on = false;
  let controller: AbortController | null = null;
  let wanted = false;
  /** The words drawn now, so a slide change only moves the highlight. */
  let drawnSong = "";
  let shownSlide: string | null = null;

  /** The desktop to follow: the one followed last if it projects, else the first that does. */
  const target = (): RemoteDesktop | null => {
    const online = desktops.filter((desktop) => desktop.online);
    const projecting = online.filter((desktop) => desktop.state.projecting);
    const preferred = readPreference("follow-desktop") ?? readPreference("desktop");
    return projecting.find((desktop) => desktop.device_id === preferred)
      ?? projecting[0]
      // While following, stay with the desktop between songs.
      ?? (on ? online.find((desktop) => desktop.device_id === preferred) ?? null : null);
  };

  const connect = () => {
    if (controller || !wanted || document.hidden) return;
    controller = new AbortController();
    api.watchDesktops((list) => {
      desktops = list;
      draw();
    }, () => {
      // Signed out or not allowed: nothing to follow.
      desktops = [];
      draw();
    }, controller.signal);
  };
  const disconnect = () => {
    controller?.abort();
    controller = null;
  };
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) disconnect();
    else connect();
  });

  const view = (): HTMLElement | null => document.querySelector("#follow-view");

  const setOn = (value: boolean, deviceId?: string) => {
    if (deviceId) writePreference("follow-desktop", deviceId);
    if (on === value) {
      draw();
      return;
    }
    on = value;
    const desktop = target();
    if (on && desktop) writePreference("follow-desktop", desktop.device_id);
    document.body.classList.toggle("following", on);
    const page = document.getElementById("page");
    if (page) page.inert = on;
    drawnSong = "";
    shownSlide = null;
    draw();
    if (on) {
      view()?.querySelector<HTMLElement>("#follow-title")?.focus({ preventScroll: true });
      announce(desktop ? t("Following {desktop}", { desktop: desktop.room_name }) : t("Following the projector"));
    } else {
      announce(t("Back to your screen"));
    }
  };

  const draw = () => {
    const desktop = target();
    if (on && !desktop && !desktops.some((entry) => entry.online)) {
      // Every desktop went away: nothing left to follow.
      setOn(false);
      return;
    }
    changed();
    const root = view();
    if (!root) return;
    root.hidden = !on;
    if (!on) return;
    const body = root.querySelector<HTMLElement>("#follow-body")!;
    const state = desktop?.state;
    const status = !desktop?.online ? "offline" : !state?.projecting ? "idle" : state.blanked ? "blank" : "live";
    root.dataset.status = status;
    root.querySelector("#follow-title")!.textContent = desktop?.room_name ?? t("Projector");
    root.querySelector("#follow-status")!.textContent = { live: t("Live"), blank: t("Screen is blank"), idle: t("Waiting"), offline: t("Not connected") }[status];
    if (status === "idle" || status === "offline" || !state) {
      drawnSong = "";
      shownSlide = null;
      body.innerHTML = `<div class="room-waiting">
        <h2>${status === "idle" ? t("Nothing is on the screen") : t("The projection computer is not connected")}</h2>
        <p>${t("The words show here as soon as the next song is projected.")}</p>
      </div>`;
      return;
    }
    const song = JSON.stringify([state.song_title, state.slides]);
    if (song !== drawnSong) {
      drawnSong = song;
      shownSlide = null;
      body.innerHTML = `<h2 class="room-song">${escapeHtml(state.song_title ?? "")}</h2>
        ${state.slides.map((slide, index) => slideHtml(slide, index)).join("")}`;
    }
    body.querySelectorAll<HTMLElement>(".room-slide").forEach((element) => {
      const current = Number(element.dataset.index) === state.slide_index;
      element.classList.toggle("current", current);
      if (current) element.setAttribute("aria-current", "true");
      else element.removeAttribute("aria-current");
    });
    fitLines();
    const slide = `${song}:${state.slide_index}`;
    if (slide !== shownSlide) {
      const first = shownSlide === null;
      shownSlide = slide;
      const current = body.querySelector<HTMLElement>(".room-slide.current");
      const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
      current?.scrollIntoView({ block: "center", behavior: first || reduce ? "auto" : "smooth" });
    }
  };

  /**
   * Lines stay whole, as on the projector: the text shrinks below the chosen
   * size until the song's longest line fits the screen.
   */
  const fitLines = () => {
    const root = view();
    const body = root?.querySelector<HTMLElement>("#follow-body");
    if (!root || !body || root.hidden) return;
    root.style.setProperty("--room-fit", "1");
    const slide = body.querySelector<HTMLElement>(".room-slide");
    if (!slide) return;
    const style = getComputedStyle(slide);
    const room = slide.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
    let widest = 0;
    body.querySelectorAll<HTMLElement>(".room-line").forEach((line) => { widest = Math.max(widest, line.scrollWidth); });
    if (room > 0 && widest > room) root.style.setProperty("--room-fit", String(Math.max(0.4, (room / widest) * 0.98)));
  };
  window.addEventListener("resize", fitLines);

  let size = Math.min(SIZES.length - 1, Math.max(0, Number(readPreference("room-size") ?? 2)));
  const applySize = () => {
    view()?.style.setProperty("--room-scale", String(SIZES[size]));
    view()?.querySelector("#follow-smaller")?.setAttribute("aria-disabled", String(size === 0));
    view()?.querySelector("#follow-larger")?.setAttribute("aria-disabled", String(size === SIZES.length - 1));
  };
  const resize = (step: number) => {
    const next = Math.min(SIZES.length - 1, Math.max(0, size + step));
    if (next === size) return;
    size = next;
    writePreference("room-size", String(size));
    applySize();
    announce(t("Text size {percent}%", { percent: Math.round(SIZES[size] * 100) }));
    shownSlide = null;
    draw();
  };

  /** The view's frame, made once per shell; `draw` fills it. */
  const mount = () => {
    const root = view();
    if (!root || root.childElementCount) return;
    root.innerHTML = `<header class="room-bar follow-bar">
        <span class="follow-live live" aria-hidden="true"></span>
        <div class="room-title"><h2 id="follow-title" tabindex="-1"></h2></div>
        <span class="room-status" id="follow-status" role="status"></span>
        <div class="room-tools" role="group" aria-label="${t("Reading settings")}">
          <button class="icon-button" id="follow-smaller" aria-label="${t("Smaller text")}" title="${t("Smaller text")}">${icon("minus")}</button>
          <button class="icon-button" id="follow-larger" aria-label="${t("Larger text")}" title="${t("Larger text")}">${icon("plus")}</button>
          <button class="icon-button" id="follow-close" aria-label="${t("Back to your screen")}" title="${t("Back to your screen")}">${icon("close")}</button>
        </div>
      </header>
      <div class="room-body" id="follow-body"></div>`;
    root.querySelector("#follow-smaller")?.addEventListener("click", () => resize(-1));
    root.querySelector("#follow-larger")?.addEventListener("click", () => resize(1));
    root.querySelector("#follow-close")?.addEventListener("click", () => {
      setOn(false);
      document.querySelector<HTMLElement>(".live-icon")?.focus({ preventScroll: true });
    });
    root.addEventListener("keydown", (event) => {
      if (event.key === "Escape") root.querySelector<HTMLElement>("#follow-close")?.click();
    });
    applySize();
  };

  return {
    start() {
      wanted = true;
      // A new shell starts on its own screen.
      setOn(false);
      mount();
      connect();
      draw();
    },
    stop() {
      wanted = false;
      disconnect();
      desktops = [];
      setOn(false);
      draw();
    },
    off() {
      setOn(false);
    },
    setOn,
    get on() {
      return on;
    },
    get desktops() {
      return desktops;
    },
    get target() {
      return target();
    },
  };
}
