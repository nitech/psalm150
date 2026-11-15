import { announce } from "../../shared/songs/a11y.ts";
import type { SongServerApi } from "./api.ts";
import type { LibraryContext } from "./context.ts";
import { mountFollowSong, type FollowSong } from "./follow-song.ts";
import { icon } from "./icons.ts";
import type { RemoteDesktop } from "./types.ts";
import { escapeHtml, readPreference, writePreference } from "./ui.ts";
import { SIZES, slideHtml } from "./views/room.ts";
import { t } from "../../shared/songs/i18n.ts";

/**
 * Following the projector from the app, one of the modes behind the Live
 * button in the top bar (live.ts). Switched on, the projected song fills the
 * screen and follows along; switched off, the screen underneath (a set, a
 * song) is back where it was, since the follow view lies over it rather than
 * replacing it.
 *
 * Two ways to see it, switched in the view's bar and remembered:
 * - **The song** as on its own page (follow-song.ts): chords, key and its
 *   bar, the lines on the screen marked; owners and leaders edit it there.
 *   A projection that is no song in the library shows its words instead.
 * - **Words only**, as people following the room (`/join`) see them: large,
 *   slide by slide, the slide on the screen marked.
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

type Mode = "song" | "words";

export function installFollow(
  api: SongServerApi,
  /** The shell's context for a screen drawn in `main` (the song in the view). */
  context: (main: HTMLElement) => LibraryContext,
  changed: () => void,
): Follow {
  let desktops: RemoteDesktop[] = [];
  let on = false;
  let controller: AbortController | null = null;
  let wanted = false;
  let mode: Mode = readPreference("follow-mode") === "words" ? "words" : "song";
  /** The song in the view, made with the view's frame. */
  let song: FollowSong | null = null;
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
    // An editor open in the view keeps its changes as a draft.
    if (!on) song?.clear();
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
    const host = root.querySelector<HTMLElement>("#follow-song")!;
    const state = desktop?.state;
    const status = !desktop?.online ? "offline" : !state?.projecting ? "idle" : state.blanked ? "blank" : "live";
    root.dataset.status = status;
    root.querySelector("#follow-title")!.textContent = desktop?.room_name ?? t("Projector");
    root.querySelector("#follow-status")!.textContent = { live: t("Live"), blank: t("Screen is blank"), idle: t("Waiting"), offline: t("Not connected") }[status];
    const modeButton = root.querySelector<HTMLElement>("#follow-mode")!;
    modeButton.setAttribute("aria-pressed", String(mode === "words"));
    modeButton.classList.toggle("on", mode === "words");
    // The editor has its own modes; Back or Save first.
    modeButton.hidden = Boolean(song?.editing);

    // The song, while there is one to show; its editor stays, whatever the projector does.
    const songShown = Boolean(song?.editing)
      || (mode === "song" && Boolean(state) && (status === "live" || status === "blank") && Boolean(song?.show(state!)));
    host.hidden = !songShown;
    body.hidden = songShown;
    if (songShown) {
      drawnSong = "";
      shownSlide = null;
      return;
    }
    song?.clear();

    if (status === "idle" || status === "offline" || !state) {
      drawnSong = "";
      shownSlide = null;
      body.innerHTML = `<div class="room-waiting">
        <h2>${status === "idle" ? t("Nothing is on the screen") : t("The projection computer is not connected")}</h2>
        <p>${t("The words show here as soon as the next song is projected.")}</p>
      </div>`;
      return;
    }
    const words = JSON.stringify([state.song_title, state.slides]);
    if (words !== drawnSong) {
      drawnSong = words;
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
    const slide = `${words}:${state.slide_index}`;
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
    if (!root || !body || root.hidden || body.hidden) return;
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

  /** Words only, or the song as on its page. */
  const switchMode = () => {
    mode = mode === "song" ? "words" : "song";
    writePreference("follow-mode", mode === "words" ? "words" : null);
    // An editor open in the view keeps its changes as a draft.
    song?.clear();
    drawnSong = "";
    shownSlide = null;
    draw();
  };

  /** The view's frame, made once per shell; `draw` fills it. */
  const mount = () => {
    const root = view();
    if (!root || root.childElementCount) return;
    const words = t("Words only, as in the room");
    root.innerHTML = `<header class="room-bar follow-bar">
        <span class="follow-live live" aria-hidden="true"></span>
        <div class="room-title"><h2 id="follow-title" tabindex="-1"></h2></div>
        <span class="sr-only" id="follow-status" role="status"></span>
        <div class="bar-actions">
          <button type="button" class="icon-button ghost" id="follow-mode" aria-pressed="${mode === "words"}" aria-label="${words}" title="${words}">${icon("eye")}</button>
          <button type="button" class="icon-button ghost" id="follow-close" aria-label="${t("Back to your screen")}" title="${t("Back to your screen")}">${icon("close")}</button>
        </div>
      </header>
      <div class="follow-scroll">
        <div class="room-body" id="follow-body"></div>
        <div class="page follow-song" id="follow-song" hidden></div>
      </div>`;
    // The words keep the size chosen for rooms (/join).
    const size = Math.min(SIZES.length - 1, Math.max(0, Number(readPreference("room-size") ?? 2)));
    root.style.setProperty("--room-scale", String(SIZES[size]));
    song?.clear();
    song = mountFollowSong(root.querySelector<HTMLElement>("#follow-song")!, context, () => draw());
    root.querySelector("#follow-mode")?.addEventListener("click", switchMode);
    root.querySelector("#follow-close")?.addEventListener("click", () => {
      setOn(false);
      document.querySelector<HTMLElement>(".live-icon")?.focus({ preventScroll: true });
    });
    // The song and its editor open in the view; any other link leaves it.
    root.addEventListener("click", (event) => {
      const link = (event.target as HTMLElement).closest<HTMLAnchorElement>("a[href^='#/']");
      if (!link || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      if (song?.open(link.getAttribute("href")!)) event.preventDefault();
    }, true);
    root.addEventListener("keydown", (event) => {
      if (event.key !== "Escape" || event.defaultPrevented || song?.editing) return;
      // Escape in a field or a menu is theirs.
      if ((event.target as HTMLElement).closest("input, textarea, select, [contenteditable], dialog")) return;
      root.querySelector<HTMLElement>("#follow-close")?.click();
    });
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
