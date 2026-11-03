import { announce, keepFocus, setTitle } from "../../../shared/songs/a11y.ts";
import { ApiError, type SongServerApi } from "../api.ts";
import { emptyState, pageHead } from "../context.ts";
import { icon } from "../icons.ts";
import { barActions, bindBarActions } from "../bar-menu.ts";
import {
  keyLabel,
  onReaderAction,
  prepareSong,
  readReaderOptions,
  readerBarActions,
  renderSongBody,
  songKey,
  stepTranspose,
} from "../song-render.ts";
import type { SetItem, SharedSet, SharedSetLive, SongDetail } from "../types.ts";
import { errorMessage, escapeHtml, serviceDate, showToast, startPolling, transposeLabel } from "../ui.ts";
import { itemPeek, itemTitle, keyCell, openSongPicker, playNav } from "./sets.ts";
import { bindSwipeDelete, swipeRow } from "../swipe-delete.ts";
import { bindItemSwipe, swapScreen, type Slide } from "../transitions.ts";
import { holdScreen } from "../wake-lock.ts";
import { locale, t } from "../../../shared/songs/i18n.ts";

/**
 * A set a leader shared on a link: anyone who has `/shared/{key}` reads the
 * set and goes through its songs with words and chords, without an account.
 * There is nothing here to steer a desktop or change a song. When the
 * leader made the link editable, people with it may also add songs from
 * the church's library and remove songs.
 *
 * Lives outside the app shell, like the room reader. The hash picks the
 * screen: none for the set, `#/item/{itemId}` for one of its items.
 */

/** How often the set is read again while its list is open, to show others' changes. */
const REFRESH_MS = 30_000;

export function sharedSetPath(): string | null {
  return /^\/shared\/([A-Za-z0-9]{16,64})\/?$/.exec(location.pathname)?.[1] ?? null;
}

export async function renderSharedSet(app: HTMLElement, api: SongServerApi, key: string): Promise<void> {
  app.innerHTML = `<p class="live-banner" id="live-banner" role="status" hidden></p>
    <main class="page shared-page" id="page" tabindex="-1"></main>
    <div class="toast" id="toast" role="status" aria-live="polite"></div>
    <p class="sr-only" id="announcer" role="status" aria-live="polite"></p>`;
  const main = app.querySelector<HTMLElement>("#page")!;

  let set: SharedSet;
  try {
    set = await api.getSharedSet(key);
  } catch (error) {
    gone(main, error);
    return;
  }

  /** Songs opened already, so moving back and forth is instant. */
  const songs = new Map<string, SongDetail>();
  let cleanup: (() => void) | undefined;
  let shown = "";

  const route = async () => {
    cleanup?.();
    cleanup = undefined;
    const itemId = /^#\/item\/([0-9a-f-]{36})$/i.exec(location.hash)?.[1];
    const screen = itemId ? `item:${itemId}` : "set";
    const same = screen === shown;
    const slide = same ? null : slideFrom(shown, screen);
    shown = screen;
    // Draws the screen, sliding from the last one, and starts it at the top.
    const present = (draw: () => void) => swapScreen(slide, () => {
      draw();
      if (!same) {
        window.scrollTo({ top: 0 });
        if (document.activeElement !== document.body || userActed) main.querySelector<HTMLElement>("h1")?.focus({ preventScroll: true });
      }
      scrolled();
    });
    try {
      cleanup = itemId ? await showItem(itemId, present) : showSet(present);
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) {
        gone(main, error);
        return;
      }
      present(() => {
        main.innerHTML = `<div class="empty-state"><h1 tabindex="-1">${t("Could not load this page")}</h1><p>${escapeHtml(errorMessage(error))}</p><a class="button secondary" href="#/">${t("Back to the set")}</a></div>`;
      });
    }
  };

  /** Into an item slides in, out to the set slides back, between items sideways. */
  const slideFrom = (from: string, to: string): Slide => {
    if (!from) return null;
    if (from === "set") return "push";
    if (to === "set") return "pop";
    const position = (screen: string) => set.items.findIndex((item) => `item:${item.id}` === screen);
    return position(to) > position(from) ? "next" : "prev";
  };

  /** Reads the set again; true when it changed. A stopped link shows as gone. */
  const reload = async (): Promise<boolean> => {
    const next = await api.getSharedSet(key);
    const changed = next.version !== set.version || next.editable !== set.editable;
    set = next;
    return changed;
  };

  /** Runs a change through the link and shows the set it returns. */
  const change = async (action: () => Promise<SharedSet>, done: string, undo?: () => Promise<SharedSet>) => {
    try {
      set = await action();
    } catch (error) {
      if (error instanceof ApiError && error.status === 403) {
        // The leader made the link read-only meanwhile.
        await reload().catch(() => undefined);
        void route();
      }
      showToast(errorMessage(error), true);
      return;
    }
    if (shown === "set") keepFocus(main, drawSet, () => main.querySelector<HTMLElement>("#add-songs, h1"));
    showToast(done, undo ? { action: { label: t("Undo"), run: () => void change(undo, t("Put back.")) } } : false);
  };

  const drawSet = () => {
    setTitle(set.service_date ? `${set.name}, ${serviceDate(set.service_date, true)}` : set.name, set.church_name);
    const first = set.items[0];
    main.innerHTML = `${pageHead({
      title: set.name,
      subtitle: `${set.church_name} · ${serviceDate(set.service_date, true)}`,
    })}
    <p class="current-note">${icon(set.editable ? "edit" : "link")}<span>${set.editable
      ? t("Shared with you on a link. Anyone with it can add songs and remove them.")
      : t("Shared with you on a link.")}</span></p>
    ${first
      ? `<a class="button primary wide" href="#/item/${first.id}">${icon("play")}${t("Go through the songs")}</a>
         <ol class="list numbered" id="shared-items" aria-label="${t("Songs in the set")}">${set.items.map(itemRow).join("")}</ol>`
      : emptyState(t("This set is empty"), set.editable ? t("Add the first song.") : t("No songs have been added yet."))}
    ${set.editable ? `<button type="button" class="button secondary wide" id="add-songs">${icon("plus")}${t("Add songs")}</button>` : ""}
    <p class="fine-print">${t("Updated {when}", { when: new Date(set.updated_at).toLocaleString(locale()) })}</p>`;
  };

  const itemRow = (item: SetItem, index: number) => {
    const details = [
      item.song?.song_number ? t("No. {number}", { number: escapeHtml(item.song.song_number) }) : "",
      item.transpose ? t("Transpose {steps}", { steps: transposeLabel(item.transpose) }) : "",
      escapeHtml(item.note),
    ].filter(Boolean).join(" · ") || "&nbsp;";
    const main = `<span class="row-main"><strong class="${item.kind === "song" && !item.song ? "missing" : ""}">${escapeHtml(itemTitle(item))}</strong><small>${details}</small></span>${keyCell(item.song?.song_key, item.transpose)}`;
    if (!set.editable || item.kind !== "song") {
      return `<li><a class="list-row" href="#/item/${item.id}">${main}${icon("next")}</a></li>`;
    }
    // Phones swipe a row left to remove the song; a mouse has the × button.
    return `<li data-key="${item.id}" data-item="${item.id}" data-swipe-row>${swipeRow(`<a class="row-link" href="#/item/${item.id}">${main}</a>
      <button type="button" class="icon-button small danger swipe-alt" data-remove="${item.id}" aria-label="${t("Remove: {item}", { item: escapeHtml(`${index + 1}, ${itemTitle(item)}`) })}">${icon("close")}</button>`, t("Remove"), "list-row song-row")}</li>`;
  };

  const removeItem = (itemId: string) => {
    const index = set.items.findIndex((item) => item.id === itemId);
    const item = set.items[index];
    if (!item) return;
    const songId = item.song_id;
    void change(
      () => api.removeSharedSong(key, item.id),
      t("Removed {title}.", { title: itemTitle(item) }),
      songId ? () => api.addSharedSong(key, songId, index) : undefined,
    );
  };

  const showSet = (present: (draw: () => void) => void = (draw) => draw()) => {
    present(drawSet);
    main.addEventListener("click", onSetClick);
    const unbindSwipe = bindSwipeDelete(main, (row) => removeItem(row.dataset.item!));
    // The first tick would only read again what was just drawn.
    let fresh = true;
    const poller = startPolling(async () => {
      if (fresh) {
        fresh = false;
        return;
      }
      try {
        if (await reload()) keepFocus(main, drawSet, () => main.querySelector<HTMLElement>("h1"));
      } catch (error) {
        if (error instanceof ApiError && error.status === 404) {
          poller.stop();
          gone(main, error);
        }
      }
    }, () => REFRESH_MS);
    return () => {
      poller.stop();
      main.removeEventListener("click", onSetClick);
      unbindSwipe();
    };
  };

  const onSetClick = (event: Event) => {
    const target = event.target as HTMLElement;
    const remove = target.closest<HTMLButtonElement>("[data-remove]");
    if (remove) {
      removeItem(remove.dataset.remove!);
      return;
    }
    if (target.closest("#add-songs")) {
      const count = (songId: string) => set.items.filter((item) => item.song_id === songId).length;
      openSongPicker((search) => api.searchSharedSongs(key, search), count, (song) => {
        void change(() => api.addSharedSong(key, song.id), t("Added {title}.", { title: song.title }));
      });
    }
  };

  const showItem = async (itemId: string, present: (draw: () => void) => void) => {
    const index = set.items.findIndex((item) => item.id === itemId);
    const item = set.items[index];
    if (!item) {
      // Removed meanwhile, or an old link to one item.
      history.replaceState(null, "", location.pathname);
      shown = "set";
      showToast(t("That item is no longer in the set."));
      return showSet(present);
    }
    const song = item.kind === "song" && item.song_id ? await loadSong(item.song_id) : null;
    const options = readReaderOptions();
    let extraTranspose = 0;
    const go = (next: number) => {
      const target = set.items[next];
      if (target) location.replace(`#/item/${target.id}`);
    };
    setTitle(t("{title} ({position} of {total})", { title: itemTitle(item), position: index + 1, total: set.items.length }), set.name);
    announce(t("{title}, {position} of {total}", { title: itemTitle(item), position: index + 1, total: set.items.length }));

    const draw = () => {
      const prev = set.items[index - 1];
      const next = set.items[index + 1];
      const transpose = stepTranspose(item.transpose, extraTranspose);
      const display = song ? prepareSong(song.chordpro, transpose) : null;
      const key = display ? keyLabel(display, transpose) : "";
      main.innerHTML = `<div class="play swipe-view">
        ${pageHead({
          title: itemTitle(item),
          subtitle: `${set.name} · ${t("{position} of {total}", { position: index + 1, total: set.items.length })}`,
          back: "#/",
          actions: display ? barActions("shared-song", readerBarActions(display, options, transpose)) : "",
        })}
        ${key ? `<p class="page-meta">${escapeHtml(key)}</p>` : ""}
        ${item.note ? `<p class="set-note">${escapeHtml(item.note)}</p>` : ""}
        ${display ? renderSongBody(display, options) : item.kind === "blank" ? `<div class="blank-slide">${t("Blank screen")}</div>` : emptyState(t("This song was deleted"), t("It is no longer in the library."))}
        ${playNav(prev && itemTitle(prev), next && itemTitle(next))}
      </div>`;
      main.querySelector("#play-prev")?.addEventListener("click", () => go(index - 1));
      main.querySelector("#play-next")?.addEventListener("click", () => go(index + 1));
    };

    const unbindBar = bindBarActions(main);
    const onBar = (event: Event) => {
      onReaderAction(main, event.target as HTMLElement, options, {
        step: (by) => { extraTranspose = stepTranspose(extraTranspose, by); },
        redraw: draw,
        key: () => (song ? songKey(prepareSong(song.chordpro, stepTranspose(item.transpose, extraTranspose))) : null),
        transpose: () => stepTranspose(item.transpose, extraTranspose),
      });
    };
    main.addEventListener("click", onBar);

    // Swipe sideways (the item follows the finger), or the arrow keys.
    const unbindSwipe = bindItemSwipe(main, { previous: index > 0, next: index + 1 < set.items.length }, (step) => go(index + step), (step) => {
      const neighbour = set.items[index + step];
      return itemPeek(set.name, set.items, index + step, neighbour?.song_id ? songs.get(neighbour.song_id) : null, options);
    });
    // The neighbours' songs, read now so a swipe to them opens at once.
    for (const neighbour of [set.items[index + 1], set.items[index - 1]]) {
      if (neighbour?.song_id) void loadSong(neighbour.song_id).catch(() => undefined);
    }
    const keys = (event: KeyboardEvent) => {
      if ((event.target as HTMLElement).closest("input,textarea")) return;
      if (event.key === "ArrowRight") go(index + 1);
      if (event.key === "ArrowLeft") go(index - 1);
    };
    // Keep the phone awake while reading from it.
    const releaseScreen = holdScreen();
    document.addEventListener("keydown", keys);
    present(draw);
    return () => {
      unbindBar();
      main.removeEventListener("click", onBar);
      unbindSwipe();
      document.removeEventListener("keydown", keys);
      releaseScreen();
    };
  };

  const loadSong = async (songId: string): Promise<SongDetail | null> => {
    if (songs.has(songId)) return songs.get(songId)!;
    try {
      const song = await api.getSharedSong(key, songId);
      songs.set(songId, song);
      return song;
    } catch (error) {
      // A song deleted from the library since; the set itself is still there.
      if (error instanceof ApiError && error.status === 404) return null;
      throw error;
    }
  };

  /** The large title has scrolled under the bar: show the title in the bar. */
  const scrolled = () => {
    const bar = main.querySelector<HTMLElement>(".app-bar");
    const title = main.querySelector<HTMLElement>(".page-titles h1");
    document.body.classList.toggle("scrolled", window.scrollY > 4);
    document.body.classList.toggle("title-away", Boolean(bar && title && title.getBoundingClientRect().bottom < bar.offsetHeight));
  };
  window.addEventListener("scroll", scrolled, { passive: true });
  window.addEventListener("hashchange", () => void route());
  await route();
  followLeader();

  /**
   * A leader may go through the set live: this page then moves to the item
   * they show whenever they move. Between moves people may look elsewhere.
   * While the stream is open, the leader counts this page as watching.
   */
  function followLeader() {
    const banner = app.querySelector<HTMLElement>("#live-banner")!;
    let lastItem: string | null = null;
    let checkTimer = 0;
    const source = new EventSource(`/api/v1/public/sets/${encodeURIComponent(key)}/live/events`);
    source.addEventListener("live", (event) => {
      const live = JSON.parse((event as MessageEvent<string>).data) as SharedSetLive;
      const text = live.item_id && live.leader_name ? t("Following {name}", { name: live.leader_name }) : "";
      if (banner.textContent !== text) {
        banner.textContent = text;
        banner.hidden = !text;
      }
      if (!live.item_id || live.item_id === lastItem) {
        lastItem = live.item_id;
        return;
      }
      lastItem = live.item_id;
      void show(live.item_id);
    });
    // EventSource reconnects by itself; when it gives up, the link may have
    // been stopped: look, and say so.
    source.addEventListener("error", () => {
      if (source.readyState !== EventSource.CLOSED) return;
      window.clearTimeout(checkTimer);
      checkTimer = window.setTimeout(async () => {
        try {
          await api.getSharedSet(key);
          followLeader();
        } catch (error) {
          banner.hidden = true;
          if (error instanceof ApiError && error.status === 404) gone(main, error);
          else checkTimer = window.setTimeout(followLeader, 10_000);
        }
      }, 4000);
    });
  }

  /** Goes to the leader's item, reading the set again if it is new here. */
  async function show(itemId: string) {
    if (!set.items.some((item) => item.id === itemId)) await reload().catch(() => false);
    if (!set.items.some((item) => item.id === itemId)) return;
    const target = `#/item/${itemId}`;
    if (location.hash === target) return;
    // From the list, Back returns to it; between items, history stays short.
    if (shown.startsWith("item:")) location.replace(target);
    else location.hash = target;
  }
}

/**
 * Someone has pressed a key or touched the page. Until then focus is left
 * alone, so a screen reader starts reading the first page at its top.
 */
let userActed = false;
for (const type of ["keydown", "pointerdown"]) {
  document.addEventListener(type, () => { userActed = true; }, { capture: true, once: true });
}

/** The link was stopped, the set deleted, or the link was never right. */
function gone(main: HTMLElement, error: unknown): void {
  const missing = error instanceof ApiError && error.status === 404;
  setTitle(missing ? t("Link not found") : t("Could not open the set"));
  main.innerHTML = `<div class="empty-state">
    <h1 tabindex="-1">${missing ? t("This link does not open a set") : t("Could not open the set")}</h1>
    <p>${missing
      ? t("The leader may have stopped sharing it, or the set was deleted. Ask whoever sent you the link for a new one.")
      : escapeHtml(errorMessage(error))}</p>
    ${missing ? "" : `<button type="button" class="button secondary" id="try-again">${t("Try again")}</button>`}
  </div>`;
  main.querySelector("#try-again")?.addEventListener("click", () => location.reload());
}
