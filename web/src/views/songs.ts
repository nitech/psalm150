import { announce, keepFocus, setTitle } from "../../../shared/songs/a11y.ts";
import { t, tn } from "../../../shared/songs/i18n.ts";
import { ApiError } from "../api.ts";
import { emptyState, menuButton, pageHead, type AppContext, type Cleanup, type LibraryContext } from "../context.ts";
import { groupSets } from "../current-set.ts";
import { barActions, bindBarActions, setSwitch } from "../bar-menu.ts";
import { songBarActions } from "../../../shared/songs/song-actions.ts";
import { closeChordDock } from "../../../shared/songs/chord-viewer.ts";
import { canKeepScreenOn, holdScreen, keepScreenOn, setKeepScreenOn } from "../wake-lock.ts";
import { endSequence, songNeighbours, stepSequence } from "../song-sequence.ts";
import { appGoesBack, bindItemSwipe } from "../transitions.ts";
import { NEW_SONG_TEMPLATE, mountChordEditor } from "../../../shared/songs/chord-editor.ts";
import { hasChords, type DisplaySong } from "../../../shared/songs/chordpro.ts";
import { icon } from "../icons.ts";
import { canRecord, mountSongMedia, type Recordings } from "../../../shared/songs/song-media.ts";
import { closeSheet, openSheet } from "../../../shared/songs/sheet.ts";
import { openSongHistory, type SongHistory } from "../../../shared/songs/song-history.ts";
import {
  keyLabel,
  onReaderAction,
  prepareSong,
  readReaderOptions,
  readerActionState,

  renderSongBody,
  songKey,
  songText,
  stepTranspose,
} from "../song-render.ts";
import type { KeyMode, OnlineSong, SongDetail, SongKeyCount, SongSort, SongSummary, SortDirection } from "../types.ts";
import { copyText, errorMessage, escapeHtml, readPreference, searchClear, serviceDate, setFormBusy, showFormError, showToast, today, writePreference } from "../ui.ts";

/** Kept while the tab is open so Back returns to the same search. */
let lastSearch = "";

/**
 * The song list as last shown, so coming back to it (Back from a song) draws
 * it at once, at the same place, while it is read again quietly; it only
 * changes if the songs did.
 */
let shownList: {
  key: string;
  html: string;
  /** The first page's songs and revisions, to tell whether a new read changed anything. */
  firstPage: string;
  loaded: number;
  numbered: boolean;
  more: boolean;
  sortHidden: boolean;
} | null = null;

/** Songs per request; the list asks for the next page as you reach the end. */
const PAGE_SIZE = 100;

/** Searches at least this long may look online when the library has nothing. */
const ONLINE_MIN_CHARS = 3;

/** A song found online, waiting in the New song editor to be checked and saved. */
let onlineDraft: OnlineSong | null = null;

/** A song as the add buttons need it. */
interface SongRef {
  id: string;
  title: string;
}

export async function songList(ctx: LibraryContext): Promise<Cleanup> {
  // On phones the search is the top of the screen: a magnifier in the
  // bar's button pill (with Live and New) that opens to the full width
  // while in use. Wide, the pill lays out flat (styles.css).
  ctx.main.innerHTML = `${pageHead({ title: t("Songs"), church: ctx.libraryName, wideOnly: true })}
  <div class="search-bar${lastSearch ? " open" : ""}">
    ${menuButton()}
    <p class="search-title" aria-hidden="true">${t("Songs")}</p>
    <div class="bar-actions search-actions">
      <div class="search-field">${icon("search")}<input type="search" id="song-search" value="${escapeHtml(lastSearch)}" placeholder="${t("Title, number or a line")}" aria-label="${t("Search songs")}" enterkeyhint="search" autocomplete="off" />${searchClear}</div>
      <button type="button" class="icon-button search-close" id="search-close" aria-label="${t("Close search")}" title="${t("Close search")}">${icon("close")}</button>
      ${ctx.canEdit ? `<a class="icon-button" href="#/songs/new" aria-label="${t("New song")}" title="${t("New song")}">${icon("plus")}</a>` : ""}
    </div>
  </div>
  <div class="list-sort" id="song-sort" hidden>
    <div class="sort-columns" id="sort-columns" role="group" aria-label="${t("Sort songs")}"></div>
    ${ctx.session ? `<button type="button" class="filter-toggle" id="fav-filter"></button>` : ""}
    <button type="button" class="filter-toggle" id="key-filter" aria-haspopup="dialog"></button>
  </div>
  <div class="filter-summary" id="filter-summary" hidden></div>
  <ul class="list" id="song-results" aria-label="${t("Songs")}" data-song-list><li><p class="muted pad">${t("Loading…")}</p></li></ul>
  <div class="load-more" id="load-more" hidden><button class="button secondary" id="more-songs">${t("Show more songs")}</button></div>
  <div class="online-offer" id="online-offer" hidden><button type="button" class="button secondary" data-online="offer">${icon("search")}<span></span></button></div>`;

  const input = ctx.main.querySelector<HTMLInputElement>("#song-search")!;
  const results = ctx.main.querySelector<HTMLElement>("#song-results")!;
  const more = ctx.main.querySelector<HTMLElement>("#load-more")!;
  const sortBar = ctx.main.querySelector<HTMLElement>("#song-sort")!;
  const sortColumns = ctx.main.querySelector<HTMLElement>("#sort-columns")!;
  const filterButton = ctx.main.querySelector<HTMLButtonElement>("#key-filter")!;
  const filterSummary = ctx.main.querySelector<HTMLElement>("#filter-summary")!;
  const favButton = ctx.main.querySelector<HTMLButtonElement>("#fav-filter");
  const searchBar = ctx.main.querySelector<HTMLElement>(".search-bar")!;
  const onlineOffer = ctx.main.querySelector<HTMLElement>("#online-offer")!;
  /** Only the person's favourites (★), remembered on this device. */
  let onlyFavorites = Boolean(ctx.session) && readPreference("song-favorites") === "on";
  let timer = 0;
  let request = 0;
  /** The online search for `lastSearch`: offered, running (with its abort) or done. */
  let online: { query: string; songs: OnlineSong[] | null; abort: AbortController | null } | null = null;
  let loaded = 0;
  let loading = false;
  let sort = readSongSort();
  let filter = readKeyFilter();
  /** Some song in the list has a number, so the number column is shown. */
  let numbered = false;

  const renderSort = () => {
    const sortBy: Record<SongSort, () => string> = {
      number: () => t("Sort by number"),
      title: () => t("Sort by title"),
      key: () => t("Sort by key"),
    };
    const button = (column: SongSort, label: string) => {
      const on = sort.column === column;
      const arrow = on ? `<span aria-hidden="true">${sort.direction === "asc" ? "↑" : "↓"}</span>` : "";
      const by = sortBy[column]();
      const name = on ? (sort.direction === "asc" ? t("{sort}, ascending", { sort: by }) : t("{sort}, descending", { sort: by })) : by;
      return `<button type="button" class="sort-${column}${on ? " on" : ""}" data-sort="${column}" aria-pressed="${on}" aria-label="${name}">${label}${arrow}</button>`;
    };
    sortBar.classList.toggle("has-numbers", numbered);
    sortColumns.innerHTML = `${numbered ? button("number", t("No")) : ""}${button("title", t("Song"))}${button("key", t("Key"))}`;
    if (favButton) {
      favButton.classList.toggle("on", onlyFavorites);
      favButton.setAttribute("aria-pressed", String(onlyFavorites));
      favButton.innerHTML = `${icon("favorites")}<span class="sr-only">${t("Only favourites")}</span>`;
      favButton.title = onlyFavorites ? t("Showing your favourites. Tap to show all songs.") : t("Only your favourites");
    }
    const active = filterActive(filter);
    filterButton.classList.toggle("on", active);
    filterButton.innerHTML = `${icon("filter")}${t("Filter")}`;
    filterButton.setAttribute("aria-label", active ? t("Filter by key: {keys}", { keys: filterText(filter) }) : t("Filter by key"));
    filterSummary.hidden = !active;
    filterSummary.innerHTML = active
      ? `<button type="button" class="chip on" id="clear-filter" aria-label="${t("Clear the key filter: {keys}", { keys: escapeHtml(filterText(filter)) })}">${escapeHtml(filterText(filter))}${icon("close")}</button>`
      : "";
  };

  const row = (song: SongSummary) => {
    const main = `<span class="row-lead">${escapeHtml(song.song_number ?? "")}</span>
      <span class="row-main"><strong>${escapeHtml(song.title)}</strong></span>
      ${song.song_key ? `<span class="row-key" aria-label="${t("Key {key}", { key: escapeHtml(song.song_key) })}">${escapeHtml(song.song_key)}</span>` : ""}`;
    const action = rowAction(ctx, { id: song.id, title: song.title });
    if (!action) return `<li><a class="list-row" href="#/songs/${song.id}">${main}${icon("next")}</a></li>`;
    return `<li class="list-row song-row">
      <a class="row-link" href="#/songs/${song.id}">${main}</a>
      ${action}
    </li>`;
  };

  const listKey = () => JSON.stringify([ctx.isPublic, ctx.canEdit, lastSearch, sort, filter, onlyFavorites]);
  const signature = (songs: SongSummary[]) => songs.map((song) => `${song.id}:${song.revision_id}`).join(",");
  const remember = (firstPage?: string) => {
    shownList = {
      key: listKey(),
      html: results.innerHTML,
      firstPage: firstPage ?? shownList?.firstPage ?? "",
      loaded,
      numbered,
      more: !more.hidden,
      sortHidden: sortBar.hidden,
    };
  };

  /**
   * `typed`: the search changed, so a screen reader hears how many songs it
   * found. `quiet`: a fresh read of a list already drawn from memory, which
   * leaves it alone unless its songs changed.
   */
  const load = async (append: boolean, typed = false, quiet = false) => {
    const mine = ++request;
    const offset = append ? loaded : 0;
    loading = true;
    try {
      const songs = await ctx.api.listSongs(lastSearch, {
        limit: PAGE_SIZE,
        offset,
        sort: sort.column,
        direction: sort.direction,
        keys: filter.roots.map((root) => KEY_NAMES[root]),
        keyMode: filter.mode === "all" ? undefined : filter.mode,
        favorites: onlyFavorites,
      });
      if (mine !== request) return;
      if (quiet && shownList?.key === listKey() && shownList.firstPage === signature(songs)) return;
      // Sorted by number, numbered songs come first: the first page tells.
      numbered = (append && numbered) || songs.some((song) => song.song_number) || sort.column === "number";
      results.classList.toggle("has-numbers", numbered);
      // A filter that finds nothing keeps its button, to change or clear it.
      sortBar.hidden = !append && !songs.length && !filterActive(filter) && !onlyFavorites;
      keepFocus(sortBar, renderSort);
      const html = songs.map(row).join("");
      if (append) results.insertAdjacentHTML("beforeend", html);
      else if (!songs.length && offersOnline()) {
        online = { query: lastSearch, songs: null, abort: null };
        renderOnline();
      } else {
        const filtered = filterActive(filter);
        results.innerHTML = songs.length
          ? html
          : onlyFavorites
            ? `<li>${emptyState(
              lastSearch || filtered ? t("None of your favourites match") : t("No favourites yet"),
              lastSearch || filtered ? t("Try another search, or show all songs with ★.") : t("Tap ☆ beside a song to make it a favourite. ★ above shows all songs again."),
            )}</li>`
            : `<li>${emptyState(
              lastSearch || filtered ? t("No songs found") : t("No songs yet"),
              lastSearch
                ? filtered ? t("Try another title or a line from the lyrics, or clear the key filter.") : t("Try another title or a line from the lyrics.")
                : filtered
                  ? t("No songs are in these keys. Try another key, or clear the filter.")
                  : ctx.canEdit ? t("Import ChordPro files under Settings, Library, or add a song.") : t("Songs will appear here once they are added."),
            )}</li>`;
      }
      if (typed) {
        announce(songs.length
          ? songs.length === PAGE_SIZE ? tn(songs.length, "{n} or more song", "{n} or more songs") : tn(songs.length, "{n} song", "{n} songs")
          : online ? t("No songs found. Press Enter to search online.") : t("No songs found"));
      }
      loaded = offset + songs.length;
      more.hidden = songs.length < PAGE_SIZE;
      showOnlineOffer();
      if (!online) remember(append ? undefined : signature(songs));
    } catch (error) {
      if (mine !== request) return;
      if (error instanceof ApiError && error.status === 401) return ctx.signOut();
      if (append) showToast(errorMessage(error), true);
      else results.innerHTML = `<li><p class="form-message pad">${escapeHtml(errorMessage(error))}</p></li>`;
    } finally {
      if (mine === request) loading = false;
    }
  };

  /** Nothing in the library: an editor may look online (never by itself, it takes seconds). */
  const offersOnline = () => ctx.canEdit && lastSearch.length >= ONLINE_MIN_CHARS && !filterActive(filter) && !onlyFavorites;

  const stopOnline = () => {
    online?.abort?.abort();
    online = null;
    showOnlineOffer();
  };

  /** Songs in the library match too: online stays a tap away, under the list. */
  function showOnlineOffer() {
    onlineOffer.hidden = Boolean(online) || !offersOnline() || !results.querySelector(".song-row");
    onlineOffer.querySelector("span")!.textContent = t("Search online for “{query}”", { query: lastSearch });
  }

  /** The offer, the running search or what it found, in place of "No songs found". */
  const renderOnline = () => {
    if (!online) return;
    const query = escapeHtml(online.query);
    if (online.abort) {
      results.innerHTML = `<li><div class="empty-state online-state" aria-busy="true">
        <span class="spinner" aria-hidden="true"></span>
        <h2>${t("Searching online for “{query}”…", { query })}</h2>
        <p>${t("Looking through chord and lyric sites. This takes a few seconds.")}</p>
        <button type="button" class="button secondary" data-online="cancel">${t("Cancel")}</button>
      </div></li>`;
      return;
    }
    if (online.songs?.length) {
      results.innerHTML = `<li class="list-heading">${t("Found online")}</li>${online.songs
        .map((song, index) => `<li><button type="button" class="list-row" data-online-song="${index}">
          <span class="row-main"><strong>${escapeHtml(song.title)}</strong><small>${escapeHtml([song.artist, song.source_name].filter(Boolean).join(" · "))}</small></span>${icon("next")}
        </button></li>`)
        .join("")}`;
      return;
    }
    if (online.songs) {
      results.innerHTML = `<li>${emptyState(t("Nothing found online for “{query}”", { query: online.query }), t("Try the full title, or a line from the lyrics."))}</li>`;
      return;
    }
    results.innerHTML = `<li><div class="empty-state online-state">
      <h2>${t("No songs match “{query}”", { query })}</h2>
      <p>${t("It is not in the library. Search online for chords and lyrics? You can check the song before you add it.")}</p>
      <button type="button" class="button primary" data-online="search">${icon("search")}${t("Search online")}</button>
    </div></li>`;
  };

  const searchOnline = async () => {
    if (!online || online.abort) return;
    const mine = online;
    const abort = new AbortController();
    mine.abort = abort;
    mine.songs = null;
    renderOnline();
    announce(t("Searching online for {query}", { query: mine.query }));
    try {
      const songs = await ctx.api.searchOnline(mine.query, abort.signal);
      if (online !== mine || abort.signal.aborted) return;
      mine.songs = songs;
      announce(songs.length ? tn(songs.length, "Found {n} online", "Found {n} online") : t("Nothing found online"));
    } catch (error) {
      if (online !== mine || abort.signal.aborted) return;
      if (error instanceof ApiError && error.status === 401) return ctx.signOut();
      showToast(errorMessage(error), true);
    } finally {
      if (online === mine && mine.abort === abort) {
        mine.abort = null;
        keepFocus(results, renderOnline);
      }
    }
  };

  // Open while the field has focus or a search; an empty field closes on blur.
  input.addEventListener("focus", () => searchBar.classList.add("open"));
  input.addEventListener("blur", () => searchBar.classList.toggle("open", Boolean(input.value.trim())));
  // The × beside the open search (phones), or Escape: empties the search and closes it.
  // It acts on pointerdown, before the field's blur could hide it.
  const closeSearch = () => {
    if (input.value) {
      input.value = "";
      input.dispatchEvent(new Event("input"));
    }
    searchBar.classList.remove("open");
    input.blur();
  };
  const closeButton = ctx.main.querySelector<HTMLButtonElement>("#search-close")!;
  closeButton.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    closeSearch();
  });
  closeButton.addEventListener("click", closeSearch);
  input.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    closeSearch();
  });
  onlineOffer.addEventListener("click", () => {
    online = { query: lastSearch, songs: null, abort: null };
    showOnlineOffer();
    void searchOnline();
    window.scrollTo({ top: 0 });
  });
  input.addEventListener("input", () => {
    lastSearch = input.value.trim();
    stopOnline();
    window.clearTimeout(timer);
    timer = window.setTimeout(() => void load(false, true), 250);
  });
  // Enter in the field asks online when the list offers it.
  input.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" || !online || online.abort || online.songs) return;
    if (online.query !== input.value.trim()) return;
    event.preventDefault();
    void searchOnline();
  });
  results.addEventListener("click", (event) => {
    const target = event.target as HTMLElement;
    const button = target.closest<HTMLButtonElement>("[data-add]");
    if (button) toggleInCurrentSet(ctx, { id: button.dataset.add!, title: button.dataset.title! });
    const star = target.closest<HTMLButtonElement>("[data-fav]");
    if (star) toggleFavorite(ctx, { id: star.dataset.fav!, title: star.dataset.title! });
    const action = target.closest<HTMLButtonElement>("[data-online]")?.dataset.online;
    if (action === "search") void searchOnline();
    if (action === "cancel" && online) {
      online.abort?.abort();
      online.abort = null;
      renderOnline();
      results.querySelector<HTMLButtonElement>("[data-online='search']")?.focus();
    }
    const found = target.closest<HTMLButtonElement>("[data-online-song]");
    const song = found ? online?.songs?.[Number(found.dataset.onlineSong)] : undefined;
    if (song) {
      onlineDraft = song;
      ctx.navigate("#/songs/new");
    }
  });
  ctx.main.querySelector("#more-songs")?.addEventListener("click", () => void load(true));

  const setFilter = (next: KeyFilter) => {
    filter = next;
    writePreference("song-key-filter", filterActive(filter) ? JSON.stringify(filter) : null);
    keepFocus(sortBar, renderSort);
    void load(false, true);
  };
  filterButton.addEventListener("click", () => void ctx.run(() => openKeyFilter(ctx, filter, setFilter), { exclusive: false }));
  filterSummary.addEventListener("click", (event) => {
    if (!(event.target as HTMLElement).closest("#clear-filter")) return;
    setFilter({ roots: [], mode: "all" });
    filterButton.focus();
  });
  // Like the desktop: the sorted column again flips the direction; another
  // column starts ascending.
  sortBar.addEventListener("click", (event) => {
    const column = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-sort]")?.dataset.sort as SongSort | undefined;
    if (!column) return;
    sort = column === sort.column
      ? { column, direction: sort.direction === "asc" ? "desc" : "asc" }
      : { column, direction: "asc" };
    writePreference("song-sort", JSON.stringify(sort));
    keepFocus(sortBar, renderSort);
    void load(false);
  });

  // Load the next page before the reader reaches the end of the list.
  const observer = new IntersectionObserver((entries) => {
    if (entries.some((entry) => entry.isIntersecting) && !loading && !more.hidden) void load(true);
  }, { rootMargin: "600px 0px" });
  observer.observe(more);

  const unsubscribe = ctx.currentSet.subscribe(() => refreshToggles(ctx, results));
  const unsubscribeFavorites = ctx.favorites.subscribe(() => refreshToggles(ctx, results));
  favButton?.addEventListener("click", () => {
    onlyFavorites = !onlyFavorites;
    writePreference("song-favorites", onlyFavorites ? "on" : null);
    keepFocus(sortBar, renderSort);
    announce(onlyFavorites ? t("Showing your favourites") : t("Showing all songs"));
    void load(false, true);
  });
  const memory = shownList?.key === listKey() ? shownList : null;
  if (memory) {
    // Drawn at once from memory (the screen keeps its place), then read again.
    results.innerHTML = memory.html;
    loaded = memory.loaded;
    numbered = memory.numbered;
    results.classList.toggle("has-numbers", numbered);
    more.hidden = !memory.more;
    sortBar.hidden = memory.sortHidden;
    keepFocus(sortBar, renderSort);
    refreshToggles(ctx, results);
    showOnlineOffer();
    void load(false, false, true);
  } else {
    await load(false);
  }
  return () => {
    window.clearTimeout(timer);
    online?.abort?.abort();
    observer.disconnect();
    unsubscribe();
    unsubscribeFavorites();
  };
}

interface SongListSort {
  column: SongSort;
  direction: SortDirection;
}

/** The list's sort, remembered on this device; by title A to Z when unset. */
function readSongSort(): SongListSort {
  try {
    const stored = JSON.parse(readPreference("song-sort") ?? "null") as Partial<SongListSort> | null;
    if ((stored?.column === "title" || stored?.column === "number" || stored?.column === "key") && (stored.direction === "asc" || stored.direction === "desc")) {
      return { column: stored.column, direction: stored.direction };
    }
  } catch {
    // A damaged preference falls back to the default.
  }
  return { column: "title", direction: "asc" };
}

/** The twelve tonics by pitch class, C = 0, spelled as most songs write them. */
const KEY_NAMES = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];

/** Which keys the list shows: no tonics means every tonic. */
interface KeyFilter {
  roots: number[];
  mode: "all" | KeyMode;
}

function filterActive(filter: KeyFilter): boolean {
  return filter.roots.length > 0 || filter.mode !== "all";
}

/** "G, D · minor", "Minor keys", "G". */
function filterText(filter: KeyFilter): string {
  const keys = filter.roots.map((root) => KEY_NAMES[root]).join(", ");
  if (!keys) return filter.mode === "all" ? "" : filter.mode === "major" ? t("Major keys") : t("Minor keys");
  return filter.mode === "all" ? keys : filter.mode === "major" ? t("{keys} · major", { keys }) : t("{keys} · minor", { keys });
}

/** The key filter, remembered on this device; none when unset. */
function readKeyFilter(): KeyFilter {
  try {
    const stored = JSON.parse(readPreference("song-key-filter") ?? "null") as Partial<KeyFilter> | null;
    const roots = Array.isArray(stored?.roots)
      ? [...new Set(stored.roots.filter((root) => Number.isInteger(root) && root >= 0 && root < 12))].sort((a, b) => a - b)
      : [];
    const mode = stored?.mode === "major" || stored?.mode === "minor" ? stored.mode : "all";
    return { roots, mode };
  } catch {
    // A damaged preference falls back to no filter.
  }
  return { roots: [], mode: "all" };
}

/**
 * Sheet: pick keys (several at once) and major, minor or both. The list
 * behind it follows each tap. Keys no song is in are shown but disabled.
 */
async function openKeyFilter(ctx: LibraryContext, start: KeyFilter, apply: (filter: KeyFilter) => void): Promise<void> {
  let counts: SongKeyCount[] = [];
  try {
    counts = await ctx.api.listSongKeys();
  } catch {
    // Without counts every key stays available.
  }
  const known = counts.length > 0;
  let filter = { roots: [...start.roots], mode: start.mode };
  const songsIn = (root: number) => counts
    .filter((count) => count.root === root && (filter.mode === "all" || count.minor === (filter.mode === "minor")))
    .reduce((sum, count) => sum + count.songs, 0);
  const modes: [KeyFilter["mode"], string][] = [["all", t("All")], ["major", t("Major")], ["minor", t("Minor")]];

  const sheet = openSheet(`<h2>${t("Filter by key")}</h2>
    <div class="segmented key-modes" role="group" aria-label="${t("Major or minor")}">
      ${modes.map(([mode, label]) => `<button type="button" data-mode="${mode}">${label}</button>`).join("")}
    </div>
    <div class="key-grid" role="group" aria-label="${t("Keys")}">
      ${KEY_NAMES.map((name, root) => `<button type="button" class="key-choice" data-root="${root}"><strong>${name}</strong><small></small></button>`).join("")}
    </div>
    <p class="hint">${t("Pick one or more keys. C# also finds Db, and a song in “D / E” counts as D.")}</p>
    <div class="form-actions">
      <button type="button" class="button secondary" data-act="clear">${t("Clear")}</button>
      <button type="button" class="button primary" data-act="done">${t("Done")}</button>
    </div>`);

  const sync = () => {
    sheet.querySelectorAll<HTMLButtonElement>("[data-mode]").forEach((button) => {
      const on = button.dataset.mode === filter.mode;
      button.classList.toggle("on", on);
      button.setAttribute("aria-pressed", String(on));
    });
    sheet.querySelectorAll<HTMLButtonElement>("[data-root]").forEach((button) => {
      const root = Number(button.dataset.root);
      const on = filter.roots.includes(root);
      const songs = songsIn(root);
      button.classList.toggle("on", on);
      button.setAttribute("aria-pressed", String(on));
      // A chosen key stays tappable, so it can be taken off again.
      button.disabled = known && !songs && !on;
      button.querySelector("small")!.textContent = known ? String(songs) : "";
      button.setAttribute("aria-label", known ? tn(songs, "{key}, {n} song", "{key}, {n} songs", { key: KEY_NAMES[root] }) : KEY_NAMES[root]);
    });
  };
  const change = (next: KeyFilter) => {
    filter = next;
    sync();
    apply(filter);
  };

  sheet.addEventListener("click", (event) => {
    const target = event.target as HTMLElement;
    const mode = target.closest<HTMLButtonElement>("[data-mode]")?.dataset.mode as KeyFilter["mode"] | undefined;
    if (mode && mode !== filter.mode) return change({ ...filter, mode });
    const root = target.closest<HTMLButtonElement>("[data-root]")?.dataset.root;
    if (root !== undefined) {
      const value = Number(root);
      const roots = filter.roots.includes(value)
        ? filter.roots.filter((other) => other !== value)
        : [...filter.roots, value].sort((a, b) => a - b);
      return change({ ...filter, roots });
    }
    const act = target.closest<HTMLButtonElement>("[data-act]")?.dataset.act;
    if (act === "clear" && filterActive(filter)) change({ roots: [], mode: "all" });
    if (act === "done") closeSheet(sheet);
  });
  sync();
}

/**
 * The button at the right of a song in a list: ＋ / ✓ for the current set
 * while there is one (owners and leaders), else ☆ / ★ for the person's
 * favourites. A visitor without a session gets neither.
 */
function rowAction(ctx: LibraryContext, song: SongRef): string {
  if (ctx.canEdit && ctx.currentSet.value) return addToggle(ctx, song);
  if (ctx.session) return favoriteToggle(ctx, song);
  return "";
}

/**
 * The ＋ / ✓ button that puts a song in the current set or takes it out. Its
 * label says which ("Remove … from …"), so it is not also a pressed toggle.
 */
function addToggle(ctx: LibraryContext, song: SongRef): string {
  const inSet = ctx.currentSet.count(song.id) > 0;
  return `<button type="button" class="icon-button small add-toggle${inSet ? " on" : ""}" data-add="${song.id}" data-title="${escapeHtml(song.title)}">${toggleInner(ctx, song)}</button>`;
}

function toggleInner(ctx: LibraryContext, song: SongRef): string {
  const set = ctx.currentSet.value;
  const inSet = ctx.currentSet.count(song.id) > 0;
  const label = !set
    ? t("Add {title} to a set", { title: song.title })
    : inSet ? t("Remove {title} from {set}", { title: song.title, set: set.name }) : t("Add {title} to {set}", { title: song.title, set: set.name });
  return `${icon(inSet ? "check" : "plus")}<span class="sr-only">${escapeHtml(label)}</span>`;
}

/** ☆ / ★: one of the person's favourites, a pressed toggle. */
function favoriteToggle(ctx: LibraryContext, song: SongRef): string {
  const on = ctx.favorites.has(song.id);
  return `<button type="button" class="icon-button small ghost fav-toggle${on ? " on" : ""}" data-fav="${song.id}" data-title="${escapeHtml(song.title)}" aria-pressed="${on}" aria-label="${escapeHtml(t("Favourite: {title}", { title: song.title }))}" title="${on ? t("A favourite. Tap to remove it.") : t("Make it a favourite")}">${icon("favorites")}</button>`;
}

/** The current set or the favourites changed: each row's button follows. */
function refreshToggles(ctx: LibraryContext, root: HTMLElement): void {
  root.querySelectorAll<HTMLButtonElement>("[data-add], [data-fav]").forEach((button) => {
    const song = { id: (button.dataset.add ?? button.dataset.fav)!, title: button.dataset.title! };
    const focused = document.activeElement === button;
    const template = document.createElement("template");
    template.innerHTML = rowAction(ctx, song);
    const next = template.content.firstElementChild as HTMLElement | null;
    if (!next) return;
    button.replaceWith(next);
    if (focused) next.focus();
  });
}

/** One tap stars the song or takes the star away. */
function toggleFavorite(ctx: LibraryContext, song: SongRef): void {
  void ctx.run(async () => {
    const on = await ctx.favorites.toggle(song.id);
    announce(on ? t("{title} is a favourite", { title: song.title }) : t("{title} is no longer a favourite", { title: song.title }));
  }, { exclusive: false });
}

/**
 * One tap: add the song to the current set, or take it out if it is there.
 * The current set's card says which (tapping again undoes it). Without a
 * current set, offers the sets.
 */
function toggleInCurrentSet(ctx: LibraryContext, song: SongRef, transpose = 0): void {
  const store = ctx.currentSet;
  const set = store.value;
  if (!set) {
    void ctx.run(() => openAddToSet(ctx, song, transpose));
    return;
  }
  void ctx.run(async () => {
    if (store.count(song.id)) await store.removeSong(song.id);
    else await store.addSong(song.id, transpose);
  }, { exclusive: false });
}

/** Songs read lately, so swiping to the next one in a list opens it at once. */
const recentSongs = new Map<string, { song: SongDetail; at: number }>();
const RECENT_MS = 120_000;
/** The song a swipe or step is opening, which may come from `recentSongs`. */
let steppingTo: string | null = null;

async function readSong(ctx: LibraryContext, id: string, fresh = false): Promise<SongDetail> {
  const recent = recentSongs.get(id);
  if (!fresh && recent && Date.now() - recent.at < RECENT_MS) return recent.song;
  const song = await ctx.api.getSong(id);
  recentSongs.set(id, { song, at: Date.now() });
  return song;
}

/** The note under a song: its revision, and what transposing here does. */
function revisionNote(song: SongDetail, canEdit: boolean): string {
  const revision = song.revision_id.slice(0, 8);
  return `<p class="fine-print">${canEdit
    ? t("Revision {revision} · Transposing here only changes what you see and what you add to a set.", { revision })
    : t("Revision {revision} · Transposing here only changes what you see.", { revision })}</p>`;
}

/**
 * A song as it shows on its page, for the neighbour peeking in during a
 * swipe: everything down to the revision note, so nothing pops in when the
 * page takes its place.
 */
function songPeek(song: SongDetail | null, title: string, options: ReturnType<typeof readReaderOptions>, canEdit: boolean): string {
  const heading = `<div class="page-titles"><h1>${escapeHtml(song?.title ?? title)}</h1></div>`;
  if (!song) return heading;
  const display = prepareSong(song.chordpro, 0);
  const meta = [song.song_number ? t("No. {number}", { number: song.song_number }) : "", song.authors, keyLabel(display, 0)].filter(Boolean).map(escapeHtml).join(" · ");
  return `${heading}${meta ? `<p class="page-meta">${meta}</p>` : ""}${renderSongBody(display, options)}${revisionNote(song, canEdit)}`;
}

export async function songDetail(ctx: LibraryContext, [songId]: string[]): Promise<Cleanup> {
  // Read afresh, except when stepping through a list (just read, and fast).
  const stepped = steppingTo === songId;
  steppingTo = null;
  const song = await readSong(ctx, songId, !stepped);
  const options = readReaderOptions();
  let transpose = 0;
  // Opened from a list: its other songs are a swipe (or a step) away.
  const around = songNeighbours(song.id);
  for (const neighbour of [around?.next, around?.previous]) {
    if (neighbour) void readSong(ctx, neighbour.id).catch(() => undefined);
  }

  /**
   * The song's toolbar, as on the desktop (song-actions.ts): chords, the
   * current set's + / ✓ (else ☆ / ★), share and edit in the bar; every
   * action in ⋮, where often used ones also come into the bar.
   */
  const songBar = (display: DisplaySong) => {
    const set = ctx.canEdit ? ctx.currentSet.value : null;
    const bar = songBarActions({
      ...readerActionState(display, options, transpose),
      set: set ? { name: set.name, inSet: ctx.currentSet.count(song.id) > 0 } : undefined,
      addToSet: ctx.canEdit || undefined,
      favorite: ctx.session ? { on: ctx.favorites.has(song.id) } : undefined,
      record: (ctx.canEdit && canRecord() && !hasRecordings) || undefined,
      findChords: ctx.canEdit && !hasChords(display) ? { href: `#/songs/${song.id}/chords` } : undefined,
      copy: true,
      history: Boolean(ctx.session) || undefined,
      keepAwake: canKeepScreenOn() ? { on: keepScreenOn() } : undefined,
      share: true,
      edit: ctx.canEdit ? { href: `#/songs/${song.id}/edit` } : undefined,
    });
    // A phone's bar has room for the fixed icons and ⋮ only; wider, the
    // often used ones come in beside them.
    return barActions("song", bar, matchMedia("(max-width: 899px)").matches ? 0 : 2);
  };
  const actions = (display: DisplaySong) => `<span class="bar-song-actions" id="song-bar">${songBar(display)}</span>`;

  /**
   * Recordings and the YouTube video, as pills under the title, read once;
   * redrawing the song (transposing) keeps them, so a recording playing goes
   * on playing. Record sits in ⋮ until the song has a recording; then the
   * pills have a + of their own.
   */
  const mediaHolder = document.createElement("div");
  mediaHolder.className = "song-media";
  mediaHolder.hidden = true;
  let hasRecordings = true;
  const media = mountSongMedia(songRecordings(ctx), song, mediaHolder, (has) => {
    if (has === hasRecordings) return;
    hasRecordings = has;
    render();
  });

  /**
   * How to play a chord tapped in the song: beside it on a wide screen,
   * along the bottom on a phone (chord-viewer.ts). Kept across redraws like
   * the media; a redraw (transposing) closes it, as its chord moved.
   */
  const chordDock = document.createElement("aside");
  chordDock.className = "chord-dock";
  chordDock.hidden = true;

  const render = () => {
    closeChordDock();
    const display = prepareSong(song.chordpro, transpose);
    const meta = [song.song_number ? t("No. {number}", { number: song.song_number }) : "", song.authors, keyLabel(display, transpose)]
      .filter(Boolean).map(escapeHtml).join(" · ");
    ctx.main.innerHTML = `<div class="swipe-view">${pageHead({
      title: song.title,
      back: around?.back ?? "#/songs",
      autohide: true,
      actions: actions(display),
    })}
    ${meta ? `<p class="page-meta">${meta}</p>` : ""}
    <div id="song-media-slot"></div>
    ${renderSongBody(display, options)}
    ${songNav()}
    ${revisionNote(song, ctx.canEdit)}</div>`;
    ctx.main.querySelector("#song-media-slot")?.replaceWith(mediaHolder);
    ctx.main.append(chordDock);
  };

  /** Previous and Next under the song, for a mouse; phones swipe instead. */
  const songNav = () => {
    if (!around) return "";
    const step = (way: "prev" | "next", label: string, title: string) => `<button type="button" class="play-step${way === "next" ? " next" : ""}" data-song-step="${way}" aria-label="${escapeHtml(`${label}: ${title}`)}">
      ${way === "prev" ? icon("back") : ""}<span><small>${label}</small><strong>${escapeHtml(title)}</strong></span>${way === "next" ? icon("next") : ""}
    </button>`;
    return `<nav class="song-nav" aria-label="${t("Songs in the list")}">
      ${around.previous ? step("prev", t("Previous"), around.previous.title) : step("prev", t("Back"), t("To the list"))}
      ${around.next ? step("next", t("Next"), around.next.title) : "<span></span>"}
    </nav>`;
  };

  /** To the list's next (1) or previous (-1) song; back from the first one tapped, to the list. */
  const goTo = (way: 1 | -1) => {
    if (!around) return;
    const target = way === 1 ? around.next : around.previous;
    if (target) {
      stepSequence(way);
      steppingTo = target.id;
      ctx.navigate(`#/songs/${target.id}`, true);
    } else if (way === -1) {
      endSequence();
      // The list is the screen before this one: Back, so it keeps its place.
      appGoesBack();
    }
  };
  const unbindSwipe = around
    ? bindItemSwipe(ctx.main, { previous: true, next: Boolean(around.next) }, goTo, (way) => {
      const target = way === 1 ? around.next : around.previous;
      // Back to the list: the song slides off and the list comes back (Back's own slide).
      if (!target) return null;
      return songPeek(recentSongs.get(target.id)?.song ?? null, target.title, options, ctx.canEdit);
    })
    : () => undefined;
  const onKeys = (event: KeyboardEvent) => {
    if (!around || (event.target as HTMLElement).closest("input, textarea, [contenteditable]") || event.altKey || event.metaKey || event.ctrlKey) return;
    if (event.key === "ArrowRight" && around.next) goTo(1);
    if (event.key === "ArrowLeft") goTo(-1);
  };
  document.addEventListener("keydown", onKeys);

  const unbindBar = bindBarActions(ctx.main);
  ctx.main.addEventListener("click", onSetAction);
  function onSetAction(event: Event): void {
    const target = event.target as HTMLElement;
    const step = target.closest<HTMLElement>("[data-song-step]")?.dataset.songStep;
    if (step) {
      goTo(step === "next" ? 1 : -1);
      return;
    }
    const reader = onReaderAction(ctx.main, target, options, {
      step: (by) => { transpose = stepTranspose(transpose, by); },
      redraw: render,
      key: () => songKey(prepareSong(song.chordpro, transpose)),
      transpose: () => transpose,
    });
    if (reader) return;
    switch (target.closest<HTMLElement>("[data-action]")?.dataset.action) {
      case "set":
        toggleInCurrentSet(ctx, song, transpose);
        break;
      case "favorite":
        toggleFavorite(ctx, song);
        break;
      case "add-to-set":
        void ctx.run(() => openAddToSet(ctx, song, transpose));
        break;
      case "copy":
        void copyLyrics(song.title, songText(prepareSong(song.chordpro, 0)));
        break;
      case "keep-awake": {
        const on = !keepScreenOn();
        setKeepScreenOn(on);
        setSwitch(ctx.main, "keep-awake", on);
        announce(on ? t("The screen stays on") : t("The screen may turn off"));
        break;
      }
      case "share":
        void shareSong(ctx, song);
        break;
      case "record":
        media.record();
        break;
      case "history":
        openSongHistory(songHistory(ctx), song, () => ctx.navigate(`#/songs/${song.id}`, true));
        break;
    }
  }

  // Only the toolbar changes when the current set or the favourites do, so the reader keeps its place.
  const redrawSetToggle = () => {
    const holder = ctx.main.querySelector<HTMLElement>("#song-bar");
    if (holder) keepFocus(holder, () => { holder.innerHTML = songBar(prepareSong(song.chordpro, transpose)); });
  };
  const unsubscribe = ctx.currentSet.subscribe(redrawSetToggle);
  const unsubscribeFavorites = ctx.favorites.subscribe(redrawSetToggle);
  setTitle(song.title, t("Songs"));
  render();
  const releaseScreen = holdScreen();
  return () => {
    closeChordDock();
    releaseScreen();
    media.cleanup();
    unbindSwipe();
    document.removeEventListener("keydown", onKeys);
    ctx.main.removeEventListener("click", onSetAction);
    unbindBar();
    unsubscribe();
    unsubscribeFavorites();
  };
}

async function copyLyrics(title: string, text: string): Promise<void> {
  if (!text) {
    showToast(t("This song has no words to copy."));
    return;
  }
  if (await copyText(text)) showToast(t("Words copied."));
  else window.prompt(t("Copy the words of {title}:", { title }), text);
}

/**
 * Shares the song's permalink, `/songs/{id}`, through the phone's share sheet
 * with the song's title, or copies it where there is none. The server serves
 * the app there, with a descriptive title for link previews, and the app
 * moves on to `#/songs/{id}`.
 */
async function shareSong(ctx: LibraryContext, song: SongRef): Promise<void> {
  const url = `${location.origin}/songs/${song.id}`;
  if ("share" in navigator && matchMedia("(pointer: coarse)").matches) {
    try {
      await navigator.share({ title: `${song.title} · ${ctx.libraryName}`, text: song.title, url });
      return;
    } catch (error) {
      // Closed without sharing.
      if (error instanceof DOMException && error.name === "AbortError") return;
    }
  }
  if (!(await copyText(url))) {
    window.prompt(t("Copy this link to {title}:", { title: song.title }), url);
    return;
  }
  showToast(ctx.isPublic ? t("Link copied.") : t("Link copied. Only people who can sign in here can open it."));
}

/** Bottom sheet: append this song to any upcoming set, or start a new one. */
export async function openAddToSet(ctx: LibraryContext, song: SongRef, transpose: number): Promise<void> {
  const { upcoming, undated } = groupSets(await ctx.api.listSets(), today());
  const sets = [...upcoming, ...undated];
  const currentId = ctx.currentSet.value?.id;
  const sheet = openSheet(`<h2>${t("Add to a set")}</h2>
    <p class="muted">${escapeHtml(song.title)}${transpose ? ` · ${t("transposed {amount}", { amount: `${transpose > 0 ? "+" : ""}${transpose}` })}` : ""}</p>
    <div class="list">
      ${sets.map((set) => `<button class="list-row" data-set="${set.id}">
        <span class="row-main"><strong>${escapeHtml(set.name)}${set.id === currentId ? ` <span class="badge">${t("Current")}</span>` : ""}</strong><small>${serviceDate(set.service_date)} · ${tn(set.item_count, "{n} item", "{n} items")}</small></span>${icon("plus")}
      </button>`).join("")}
      <a class="list-row" href="#/sets/new?song=${song.id}&transpose=${transpose}"><span class="row-main"><strong>${t("New set…")}</strong><small>${t("Start a set with this song")}</small></span>${icon("next")}</a>
    </div>`);

  sheet.querySelectorAll<HTMLButtonElement>("[data-set]").forEach((button) => {
    button.addEventListener("click", () => void ctx.run(async () => {
      // The set a song goes into becomes the current one, so the next ＋ adds there too.
      const setId = String(button.dataset.set);
      if (setId !== currentId) await ctx.currentSet.choose(setId);
      await ctx.currentSet.addSong(song.id, transpose);
      closeSheet(sheet);
      const name = ctx.currentSet.value?.name;
      showToast(name ? t("Added to {set}.", { set: name }) : t("Added to the set."));
    }));
  });
  sheet.querySelector("a")?.addEventListener("click", () => closeSheet(sheet));
}

export async function songEditor(ctx: AppContext, [songId]: string[]): Promise<Cleanup | void> {
  const song = songId ? await ctx.api.getSong(songId) : null;
  if (!ctx.canEdit) {
    ctx.navigate(song ? `#/songs/${song.id}` : "#/songs", true);
    return;
  }
  const back = song ? `#/songs/${song.id}` : "#/songs";
  // A song picked from an online search opens here once, to check and save.
  const draft = song ? null : onlineDraft;
  onlineDraft = null;
  setTitle(song ? t("Edit {title}", { title: song.title }) : draft ? t("Add {title}", { title: draft.title }) : t("New song"), t("Songs"));
  ctx.main.innerHTML = `${pageHead({ title: song ? t("Edit song") : draft ? t("Add song") : t("New song"), quietTitle: true, back, actions: `<div class="segmented ce-modes" role="group" aria-label="${t("Edit as")}"></div>` })}
  ${draft ? `<p class="online-source">${t('Found on <a href="{url}" target="_blank" rel="noopener noreferrer">{source}</a>. Check the words and chords, then save to add it to the library.', { url: escapeHtml(draft.source_url), source: escapeHtml(draft.source_name) })}</p>` : ""}
  <form class="editor" id="editor-form">
    <div id="chord-editor"></div>
    <p class="form-message" role="status"></p>
  </form>`;

  // Save is the ✓ in the editor's bar; Back leaves without saving.
  const form = ctx.main.querySelector<HTMLFormElement>("#editor-form")!;
  const editor = mountChordEditor(ctx.main.querySelector<HTMLElement>("#chord-editor")!, song?.chordpro ?? draft?.chordpro ?? NEW_SONG_TEMPLATE, {
    modes: ctx.main.querySelector<HTMLElement>(".ce-modes")!,
    save: () => form.requestSubmit(),
    // Always in the header: on iOS a bar fixed at the bottom jumps while the page scrolls.
    dock: ctx.main.querySelector<HTMLElement>(".app-bar-row") ?? undefined,
    dockWhen: "all",
  });
  const message = form.querySelector<HTMLElement>(".form-message")!;
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (form.classList.contains("busy")) return;
    const source = editor.source();
    setFormBusy(form, true);
    try {
      if (song) {
        await ctx.api.updateSong(song.id, song.revision_id, source);
        showToast(t("Saved a new revision."));
        ctx.navigate(`#/songs/${song.id}`, true);
      } else {
        const created = await ctx.api.createSong(source);
        showToast(t("Added the song."));
        ctx.navigate(`#/songs/${created.id}`, true);
      }
    } catch (error) {
      setFormBusy(form, false);
      if (error instanceof ApiError && error.status === 401) return ctx.signOut();
      if (error instanceof ApiError && error.status === 409) {
        message.innerHTML = t('Someone saved this song after you opened it. Your text is still here: copy what you need, then <a href="#/songs/{id}">open the latest version</a> and edit again.', { id: String(song?.id) });
        return;
      }
      // The server's objection is to the text: tie it to the field.
      showFormError(form, errorMessage(error));
    }
  });
  return () => editor.destroy();
}

/** The song's recordings through this session; none for a visitor without one. */
function songRecordings(ctx: LibraryContext): Recordings {
  return {
    canEdit: ctx.canEdit,
    list: async (songId) => (ctx.session ? ctx.api.songRecordings(songId) : []),
    add: (songId, audio, durationMs) => ctx.api.addRecording(songId, audio, durationMs),
    link: (songId, recordingId) => ctx.api.recordingLink(songId, recordingId),
    remove: (songId, recordingId) => ctx.api.deleteRecording(songId, recordingId),
  };
}

/** The song's revisions through this session; owners and leaders restore. */
function songHistory(ctx: LibraryContext): SongHistory {
  return {
    canRestore: ctx.canEdit,
    list: (songId) => ctx.api.listRevisions(songId),
    source: async (songId, revisionId) => (await ctx.api.getRevision(songId, revisionId)).chordpro,
    restore: async (songId, currentRevisionId, chordpro) => {
      await ctx.api.updateSong(songId, currentRevisionId, chordpro);
    },
  };
}
