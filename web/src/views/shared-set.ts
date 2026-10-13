import { announce, keepFocus, setTitle } from "../a11y.ts";
import { ApiError, type SongServerApi } from "../api.ts";
import { emptyState, pageHead } from "../context.ts";
import { icon } from "../icons.ts";
import {
  bindReaderControls,
  keyLabel,
  prepareSong,
  readReaderOptions,
  readerPanel,
  readerToggle,
  renderSongBody,
  stepTranspose,
} from "../song-render.ts";
import type { SetItem, SharedSet, SharedSetLive, SongDetail } from "../types.ts";
import { errorMessage, escapeHtml, serviceDate, showToast, startPolling, transposeLabel } from "../ui.ts";
import { itemTitle, openSongPicker, playNav } from "./sets.ts";

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
    shown = screen;
    try {
      cleanup = itemId ? await showItem(itemId) : showSet();
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) {
        gone(main, error);
        return;
      }
      main.innerHTML = `<div class="empty-state"><h1 tabindex="-1">Could not load this page</h1><p>${escapeHtml(errorMessage(error))}</p><a class="button secondary" href="#/">Back to the set</a></div>`;
    }
    if (!same) {
      window.scrollTo({ top: 0 });
      if (document.activeElement !== document.body || userActed) main.querySelector<HTMLElement>("h1")?.focus({ preventScroll: true });
    }
    scrolled();
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
    showToast(done, undo ? { action: { label: "Undo", run: () => void change(undo, "Put back.") } } : false);
  };

  const drawSet = () => {
    setTitle(set.name, set.church_name);
    const first = set.items[0];
    main.innerHTML = `${pageHead({
      title: set.name,
      subtitle: `${set.church_name} · ${serviceDate(set.service_date, true)}`,
    })}
    <p class="current-note">${icon(set.editable ? "edit" : "link")}<span>${set.editable
      ? "Shared with you on a link. Anyone with it can add songs and remove them."
      : "Shared with you on a link."}</span></p>
    ${first
      ? `<a class="button primary wide" href="#/item/${first.id}">${icon("play")}Go through the songs</a>
         <ol class="list numbered" id="shared-items" aria-label="Songs in the set">${set.items.map(itemRow).join("")}</ol>`
      : emptyState("This set is empty", set.editable ? "Add the first song." : "No songs have been added yet.")}
    ${set.editable ? `<button type="button" class="button secondary wide" id="add-songs">${icon("plus")}Add songs</button>` : ""}
    <p class="fine-print">Updated ${new Date(set.updated_at).toLocaleString()}</p>`;
  };

  const itemRow = (item: SetItem, index: number) => {
    const details = [
      item.song?.song_number ? `No. ${escapeHtml(item.song.song_number)}` : "",
      item.transpose ? `Transpose ${transposeLabel(item.transpose)}` : "",
      escapeHtml(item.note),
    ].filter(Boolean).join(" · ") || "&nbsp;";
    const main = `<span class="row-lead">${index + 1}</span>
      <span class="row-main"><strong class="${item.kind === "song" && !item.song ? "missing" : ""}">${escapeHtml(itemTitle(item))}</strong><small>${details}</small></span>`;
    if (!set.editable || item.kind !== "song") {
      return `<li><a class="list-row" href="#/item/${item.id}">${main}${icon("next")}</a></li>`;
    }
    return `<li class="list-row song-row" data-key="${item.id}">
      <a class="row-link" href="#/item/${item.id}">${main}</a>
      <button type="button" class="icon-button small danger" data-remove="${item.id}" aria-label="Remove: ${escapeHtml(`${index + 1}, ${itemTitle(item)}`)}">${icon("close")}</button>
    </li>`;
  };

  const showSet = () => {
    drawSet();
    main.addEventListener("click", onSetClick);
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
    };
  };

  const onSetClick = (event: Event) => {
    const target = event.target as HTMLElement;
    const remove = target.closest<HTMLButtonElement>("[data-remove]");
    if (remove) {
      const index = set.items.findIndex((item) => item.id === remove.dataset.remove);
      const item = set.items[index];
      if (!item) return;
      const songId = item.song_id;
      void change(
        () => api.removeSharedSong(key, item.id),
        `Removed ${itemTitle(item)}.`,
        songId ? () => api.addSharedSong(key, songId, index) : undefined,
      );
      return;
    }
    if (target.closest("#add-songs")) {
      const count = (songId: string) => set.items.filter((item) => item.song_id === songId).length;
      openSongPicker((search) => api.searchSharedSongs(key, search), count, (song) => {
        void change(() => api.addSharedSong(key, song.id), `Added ${song.title}.`);
      });
    }
  };

  const showItem = async (itemId: string) => {
    const index = set.items.findIndex((item) => item.id === itemId);
    const item = set.items[index];
    if (!item) {
      // Removed meanwhile, or an old link to one item.
      history.replaceState(null, "", location.pathname);
      shown = "set";
      showToast("That item is no longer in the set.");
      return showSet();
    }
    const song = item.kind === "song" && item.song_id ? await loadSong(item.song_id) : null;
    const options = readReaderOptions();
    let extraTranspose = 0;
    let wakeLock: { release(): Promise<void> } | null = null;
    const go = (next: number) => {
      const target = set.items[next];
      if (target) location.replace(`#/item/${target.id}`);
    };
    setTitle(`${itemTitle(item)} (${index + 1} of ${set.items.length})`, set.name);
    announce(`${itemTitle(item)}, ${index + 1} of ${set.items.length}`);

    const draw = () => {
      const prev = set.items[index - 1];
      const next = set.items[index + 1];
      const transpose = stepTranspose(item.transpose, extraTranspose);
      const display = song ? prepareSong(song.chordpro, transpose) : null;
      const key = display ? keyLabel(display, transpose) : "";
      main.innerHTML = `<div class="play">
        ${pageHead({
          title: itemTitle(item),
          subtitle: `${set.name} · ${index + 1} of ${set.items.length}`,
          back: "#/",
          actions: display ? readerToggle(options) : "",
          panel: display ? readerPanel(display, options, transpose) : "",
        })}
        ${key ? `<p class="page-meta">${escapeHtml(key)}</p>` : ""}
        ${item.note ? `<p class="set-note">${escapeHtml(item.note)}</p>` : ""}
        ${display ? renderSongBody(display, options) : item.kind === "blank" ? `<div class="blank-slide">Blank screen</div>` : emptyState("This song was deleted", "It is no longer in the library.")}
        ${playNav(prev && itemTitle(prev), next && itemTitle(next))}
      </div>`;
      if (display) {
        bindReaderControls(main, options, (step) => {
          extraTranspose = stepTranspose(extraTranspose, step);
          draw();
        });
      }
      main.querySelector("#play-prev")?.addEventListener("click", () => go(index - 1));
      main.querySelector("#play-next")?.addEventListener("click", () => go(index + 1));
    };

    // Swipe left or right, or the arrow keys, to move through the set.
    let startX = 0;
    let startY = 0;
    const touchStart = (event: TouchEvent) => {
      startX = event.touches[0].clientX;
      startY = event.touches[0].clientY;
    };
    const touchEnd = (event: TouchEvent) => {
      const dx = event.changedTouches[0].clientX - startX;
      const dy = event.changedTouches[0].clientY - startY;
      if (Math.abs(dx) < 70 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
      go(dx < 0 ? index + 1 : index - 1);
    };
    const keys = (event: KeyboardEvent) => {
      if ((event.target as HTMLElement).closest("input,textarea")) return;
      if (event.key === "ArrowRight") go(index + 1);
      if (event.key === "ArrowLeft") go(index - 1);
    };
    // Keep the phone awake while reading from it; the browser drops the lock
    // when the page is hidden, so take it again.
    const nav = navigator as Navigator & { wakeLock?: { request(type: "screen"): Promise<{ release(): Promise<void> }> } };
    const lockScreen = () => {
      nav.wakeLock?.request("screen").then((lock) => { wakeLock = lock; }).catch(() => undefined);
    };
    const visibility = () => {
      if (document.visibilityState === "visible") lockScreen();
    };
    main.addEventListener("touchstart", touchStart, { passive: true });
    main.addEventListener("touchend", touchEnd);
    document.addEventListener("keydown", keys);
    document.addEventListener("visibilitychange", visibility);
    lockScreen();
    draw();
    return () => {
      main.removeEventListener("touchstart", touchStart);
      main.removeEventListener("touchend", touchEnd);
      document.removeEventListener("keydown", keys);
      document.removeEventListener("visibilitychange", visibility);
      void wakeLock?.release().catch(() => undefined);
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
      const text = live.item_id && live.leader_name ? `Following ${live.leader_name}` : "";
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
  setTitle(missing ? "Link not found" : "Could not open the set");
  main.innerHTML = `<div class="empty-state">
    <h1 tabindex="-1">${missing ? "This link does not open a set" : "Could not open the set"}</h1>
    <p>${missing
      ? "The leader may have stopped sharing it, or the set was deleted. Ask whoever sent you the link for a new one."
      : escapeHtml(errorMessage(error))}</p>
    ${missing ? "" : `<button type="button" class="button secondary" id="try-again">Try again</button>`}
  </div>`;
  main.querySelector("#try-again")?.addEventListener("click", () => location.reload());
}
