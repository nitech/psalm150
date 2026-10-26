import { announce, keepFocus, setTitle } from "../a11y.ts";
import { ApiError } from "../api.ts";
import { emptyState, menuButton, pageHead, type AppContext, type Cleanup, type LibraryContext } from "../context.ts";
import { groupSets } from "../current-set.ts";
import { barActions, bindBarActions, setSwitch, type BarAction } from "../bar-menu.ts";
import { canKeepScreenOn, holdScreen, keepScreenOn, setKeepScreenOn } from "../wake-lock.ts";
import { endSequence, songNeighbours, stepSequence } from "../song-sequence.ts";
import { appGoesBack, bindItemSwipe } from "../transitions.ts";
import { mountChordEditor } from "../chord-editor.ts";
import { hasChords, type DisplaySong } from "../chordpro.ts";
import { icon } from "../icons.ts";
import {
  keyLabel,
  onReaderAction,
  prepareSong,
  readReaderOptions,
  readerBarActions,
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

const NEW_SONG_TEMPLATE = "{title: }\n{author: }\n{key: }\n\n{start_of_verse}\n\n{end_of_verse}\n";

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
  // On phones the search field is the top of the screen, between ☰ and New.
  ctx.main.innerHTML = `${pageHead({ title: "Songs", church: ctx.libraryName, wideOnly: true })}
  <div class="search-bar">
    ${menuButton()}
    <div class="search-field">${icon("search")}<input type="search" id="song-search" value="${escapeHtml(lastSearch)}" placeholder="Title, number or a line" aria-label="Search songs" enterkeyhint="search" autocomplete="off" />${searchClear}</div>
    ${ctx.canEdit ? `<a class="icon-button accent" href="#/songs/new" aria-label="New song" title="New song">${icon("plus")}</a>` : ""}
  </div>
  <div class="list-sort" id="song-sort" hidden>
    <div class="sort-columns" id="sort-columns" role="group" aria-label="Sort songs"></div>
    <button type="button" class="filter-toggle" id="key-filter" aria-haspopup="dialog"></button>
  </div>
  <div class="filter-summary" id="filter-summary" hidden></div>
  <ul class="list" id="song-results" aria-label="Songs" data-song-list><li><p class="muted pad">Loading…</p></li></ul>
  <div class="load-more" id="load-more" hidden><button class="button secondary" id="more-songs">Show more songs</button></div>`;

  const input = ctx.main.querySelector<HTMLInputElement>("#song-search")!;
  const results = ctx.main.querySelector<HTMLElement>("#song-results")!;
  const more = ctx.main.querySelector<HTMLElement>("#load-more")!;
  const sortBar = ctx.main.querySelector<HTMLElement>("#song-sort")!;
  const sortColumns = ctx.main.querySelector<HTMLElement>("#sort-columns")!;
  const filterButton = ctx.main.querySelector<HTMLButtonElement>("#key-filter")!;
  const filterSummary = ctx.main.querySelector<HTMLElement>("#filter-summary")!;
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
    const button = (column: SongSort, label: string) => {
      const on = sort.column === column;
      const arrow = on ? `<span aria-hidden="true">${sort.direction === "asc" ? "↑" : "↓"}</span>` : "";
      const state = on ? `, ${sort.direction === "asc" ? "ascending" : "descending"}` : "";
      return `<button type="button" class="sort-${column}${on ? " on" : ""}" data-sort="${column}" aria-pressed="${on}" aria-label="Sort by ${column}${state}">${label}${arrow}</button>`;
    };
    sortBar.classList.toggle("has-numbers", numbered);
    sortColumns.innerHTML = `${numbered ? button("number", "No") : ""}${button("title", "Song")}${button("key", "Key")}`;
    const active = filterActive(filter);
    filterButton.classList.toggle("on", active);
    filterButton.innerHTML = `${icon("filter")}Filter`;
    filterButton.setAttribute("aria-label", active ? `Filter by key: ${filterText(filter)}` : "Filter by key");
    filterSummary.hidden = !active;
    filterSummary.innerHTML = active
      ? `<button type="button" class="chip on" id="clear-filter" aria-label="Clear the key filter: ${escapeHtml(filterText(filter))}">${escapeHtml(filterText(filter))}${icon("close")}</button>`
      : "";
  };

  const row = (song: SongSummary) => {
    const main = `<span class="row-lead">${escapeHtml(song.song_number ?? "")}</span>
      <span class="row-main"><strong>${escapeHtml(song.title)}</strong></span>
      ${song.song_key ? `<span class="row-key" aria-label="Key ${escapeHtml(song.song_key)}">${escapeHtml(song.song_key)}</span>` : ""}`;
    if (!ctx.canEdit) return `<li><a class="list-row" href="#/songs/${song.id}">${main}${icon("next")}</a></li>`;
    return `<li class="list-row song-row">
      <a class="row-link" href="#/songs/${song.id}">${main}</a>
      ${addToggle(ctx, { id: song.id, title: song.title })}
    </li>`;
  };

  const listKey = () => JSON.stringify([ctx.isPublic, ctx.canEdit, lastSearch, sort, filter]);
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
      });
      if (mine !== request) return;
      if (quiet && shownList?.key === listKey() && shownList.firstPage === signature(songs)) return;
      // Sorted by number, numbered songs come first: the first page tells.
      numbered = (append && numbered) || songs.some((song) => song.song_number) || sort.column === "number";
      results.classList.toggle("has-numbers", numbered);
      // A filter that finds nothing keeps its button, to change or clear it.
      sortBar.hidden = !append && !songs.length && !filterActive(filter);
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
          : `<li>${emptyState(
              lastSearch || filtered ? "No songs found" : "No songs yet",
              lastSearch
                ? `Try another title or a line from the lyrics${filtered ? ", or clear the key filter" : ""}.`
                : filtered
                  ? "No songs are in these keys. Try another key, or clear the filter."
                  : ctx.canEdit ? "Import ChordPro files under More, or add a song." : "Songs will appear here once they are added.",
            )}</li>`;
      }
      if (typed) {
        announce(songs.length
          ? `${songs.length}${songs.length === PAGE_SIZE ? " or more" : ""} ${songs.length === 1 ? "song" : "songs"}`
          : online ? "No songs found. Press Enter to search online." : "No songs found");
      }
      loaded = offset + songs.length;
      more.hidden = songs.length < PAGE_SIZE;
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
  const offersOnline = () => ctx.canEdit && lastSearch.length >= ONLINE_MIN_CHARS && !filterActive(filter);

  const stopOnline = () => {
    online?.abort?.abort();
    online = null;
  };

  /** The offer, the running search or what it found, in place of "No songs found". */
  const renderOnline = () => {
    if (!online) return;
    const query = `“${escapeHtml(online.query)}”`;
    if (online.abort) {
      results.innerHTML = `<li><div class="empty-state online-state" aria-busy="true">
        <span class="spinner" aria-hidden="true"></span>
        <h2>Searching online for ${query}…</h2>
        <p>Looking through chord and lyric sites. This takes a few seconds.</p>
        <button type="button" class="button secondary" data-online="cancel">Cancel</button>
      </div></li>`;
      return;
    }
    if (online.songs?.length) {
      results.innerHTML = `<li class="list-heading">Found online</li>${online.songs
        .map((song, index) => `<li><button type="button" class="list-row" data-online-song="${index}">
          <span class="row-main"><strong>${escapeHtml(song.title)}</strong><small>${escapeHtml([song.artist, song.source_name].filter(Boolean).join(" · "))}</small></span>${icon("next")}
        </button></li>`)
        .join("")}`;
      return;
    }
    if (online.songs) {
      results.innerHTML = `<li>${emptyState(`Nothing found online for “${online.query}”`, "Try the full title, or a line from the lyrics.")}</li>`;
      return;
    }
    results.innerHTML = `<li><div class="empty-state online-state">
      <h2>No songs match ${query}</h2>
      <p>It is not in the library. Search online for chords and lyrics? You can check the song before you add it.</p>
      <button type="button" class="button primary" data-online="search">${icon("search")}Search online</button>
    </div></li>`;
  };

  const searchOnline = async () => {
    if (!online || online.abort) return;
    const mine = online;
    const abort = new AbortController();
    mine.abort = abort;
    mine.songs = null;
    renderOnline();
    announce(`Searching online for ${mine.query}`);
    try {
      const songs = await ctx.api.searchOnline(mine.query, abort.signal);
      if (online !== mine || abort.signal.aborted) return;
      mine.songs = songs;
      announce(songs.length ? `Found ${songs.length} online` : "Nothing found online");
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
    void load(false, false, true);
  } else {
    await load(false);
  }
  return () => {
    window.clearTimeout(timer);
    online?.abort?.abort();
    observer.disconnect();
    unsubscribe();
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
  if (!keys) return filter.mode === "all" ? "" : `${filter.mode === "major" ? "Major" : "Minor"} keys`;
  return filter.mode === "all" ? keys : `${keys} · ${filter.mode}`;
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
  const modes: [KeyFilter["mode"], string][] = [["all", "All"], ["major", "Major"], ["minor", "Minor"]];

  const sheet = openSheet(`<h2>Filter by key</h2>
    <div class="segmented key-modes" role="group" aria-label="Major or minor">
      ${modes.map(([mode, label]) => `<button type="button" data-mode="${mode}">${label}</button>`).join("")}
    </div>
    <div class="key-grid" role="group" aria-label="Keys">
      ${KEY_NAMES.map((name, root) => `<button type="button" class="key-choice" data-root="${root}"><strong>${name}</strong><small></small></button>`).join("")}
    </div>
    <p class="hint">Pick one or more keys. C# also finds Db, and a song in “D / E” counts as D.</p>
    <div class="form-actions">
      <button type="button" class="button secondary" data-act="clear">Clear</button>
      <button type="button" class="button primary" data-act="done">Done</button>
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
      button.setAttribute("aria-label", `${KEY_NAMES[root]}${known ? `, ${songs} ${songs === 1 ? "song" : "songs"}` : ""}`);
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
    ? `Add ${song.title} to a set`
    : inSet ? `Remove ${song.title} from ${set.name}` : `Add ${song.title} to ${set.name}`;
  return `${icon(inSet ? "check" : "plus")}<span class="sr-only">${escapeHtml(label)}</span>`;
}

function refreshToggles(ctx: LibraryContext, root: HTMLElement): void {
  root.querySelectorAll<HTMLButtonElement>("[data-add]").forEach((button) => {
    const song = { id: button.dataset.add!, title: button.dataset.title! };
    const inSet = ctx.currentSet.count(song.id) > 0;
    button.classList.toggle("on", inSet);
    button.innerHTML = toggleInner(ctx, song);
  });
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
  return `<p class="fine-print">Revision ${song.revision_id.slice(0, 8)} · Transposing here only changes what you see${canEdit ? " and what you add to a set" : ""}.</p>`;
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
  const meta = [song.song_number ? `No. ${song.song_number}` : "", song.authors, keyLabel(display, 0)].filter(Boolean).map(escapeHtml).join(" · ");
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

  /** Fixed in the bar: + (or ✓) for the current set, when there is one. */
  const setToggle = () => {
    const set = ctx.currentSet.value;
    if (!ctx.canEdit || !set) return "";
    const inSet = ctx.currentSet.count(song.id) > 0;
    const label = inSet ? `In ${set.name}. Tap to remove it.` : `Add to ${set.name}`;
    return `<button type="button" class="icon-button ghost${inSet ? " in-set" : ""}" data-set-act="toggle" aria-pressed="${inSet}" aria-label="${escapeHtml(label)}" title="${escapeHtml(label)}">${icon(inSet ? "check" : "plus")}</button>`;
  };

  /**
   * The bar: fixed, the current set's +/✓ and "Chords and key" (the reader's
   * own controls); everything else in ⋮, where often used ones also come
   * into the bar ([bar-menu.ts](../bar-menu.ts)).
   */
  const actions = (display: DisplaySong) => {
    const bar: BarAction[] = readerBarActions(display, options, transpose);
    if (ctx.canEdit) bar.push({ id: "add-to-set", label: ctx.currentSet.value ? "Add to another set" : "Add to a set", icon: "sets" });
    // A song without chords can borrow them from a version found online.
    if (ctx.canEdit && !hasChords(display)) bar.push({ id: "find-chords", label: "Chords from the web", icon: "chords", href: `#/songs/${song.id}/chords` });
    bar.push({ id: "copy", label: "Copy the words", icon: "copy" });
    if (canKeepScreenOn()) bar.push({ id: "keep-awake", label: "Keep screen on", icon: "sun", checked: keepScreenOn(), switch: true, className: keepScreenOn() ? "on" : "" });
    bar.push({ id: "share", label: "Share song", icon: "share", fixed: true });
    if (ctx.canEdit) bar.push({ id: "edit", label: "Edit song", icon: "edit", href: `#/songs/${song.id}/edit`, fixed: true });
    // Phones have room for one used-often icon beside a leader's five fixed ones.
    return `<span class="bar-set-actions" id="set-actions">${setToggle()}</span>${barActions("song", bar, ctx.canEdit ? 1 : 2)}`;
  };

  const render = () => {
    const display = prepareSong(song.chordpro, transpose);
    const meta = [song.song_number ? `No. ${song.song_number}` : "", song.authors, keyLabel(display, transpose)]
      .filter(Boolean).map(escapeHtml).join(" · ");
    ctx.main.innerHTML = `<div class="swipe-view">${pageHead({
      title: song.title,
      back: around?.back ?? "#/songs",
      autohide: true,
      actions: actions(display),
    })}
    ${meta ? `<p class="page-meta">${meta}</p>` : ""}
    ${renderSongBody(display, options)}
    ${songNav()}
    ${revisionNote(song, ctx.canEdit)}</div>`;
  };

  /** Previous and Next under the song, for a mouse; phones swipe instead. */
  const songNav = () => {
    if (!around) return "";
    const step = (way: "prev" | "next", label: string, title: string) => `<button type="button" class="play-step${way === "next" ? " next" : ""}" data-song-step="${way}" aria-label="${escapeHtml(`${label}: ${title}`)}">
      ${way === "prev" ? icon("back") : ""}<span><small>${label}</small><strong>${escapeHtml(title)}</strong></span>${way === "next" ? icon("next") : ""}
    </button>`;
    return `<nav class="song-nav" aria-label="Songs in the list">
      ${around.previous ? step("prev", "Previous", around.previous.title) : step("prev", "Back", "To the list")}
      ${around.next ? step("next", "Next", around.next.title) : "<span></span>"}
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
    if (target.closest("[data-set-act='toggle']")) {
      toggleInCurrentSet(ctx, song, transpose);
      return;
    }
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
        announce(on ? "The screen stays on" : "The screen may turn off");
        break;
      }
      case "share":
        void shareSong(ctx, song);
        break;
    }
  }

  // Only the buttons change when the current set does, so the reader keeps its place.
  const unsubscribe = ctx.currentSet.subscribe(() => {
    const holder = ctx.main.querySelector<HTMLElement>("#set-actions");
    if (holder) keepFocus(holder, () => { holder.innerHTML = setToggle(); });
  });
  setTitle(song.title, "Songs");
  render();
  const releaseScreen = holdScreen();
  return () => {
    releaseScreen();
    unbindSwipe();
    document.removeEventListener("keydown", onKeys);
    ctx.main.removeEventListener("click", onSetAction);
    unbindBar();
    unsubscribe();
  };
}

async function copyLyrics(title: string, text: string): Promise<void> {
  if (!text) {
    showToast("This song has no words to copy.");
    return;
  }
  if (await copyText(text)) showToast("Words copied.");
  else window.prompt(`Copy the words of ${title}:`, text);
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
    window.prompt(`Copy this link to ${song.title}:`, url);
    return;
  }
  showToast(ctx.isPublic ? "Link copied." : "Link copied. Only people who can sign in here can open it.");
}

/** Bottom sheet: append this song to any upcoming set, or start a new one. */
export async function openAddToSet(ctx: LibraryContext, song: SongRef, transpose: number): Promise<void> {
  const { upcoming, undated } = groupSets(await ctx.api.listSets(), today());
  const sets = [...upcoming, ...undated];
  const currentId = ctx.currentSet.value?.id;
  const sheet = openSheet(`<h2>Add to a set</h2>
    <p class="muted">${escapeHtml(song.title)}${transpose ? ` · transposed ${transpose > 0 ? "+" : ""}${transpose}` : ""}</p>
    <div class="list">
      ${sets.map((set) => `<button class="list-row" data-set="${set.id}">
        <span class="row-main"><strong>${escapeHtml(set.name)}${set.id === currentId ? ` <span class="badge">Current</span>` : ""}</strong><small>${serviceDate(set.service_date)} · ${set.item_count} ${set.item_count === 1 ? "item" : "items"}</small></span>${icon("plus")}
      </button>`).join("")}
      <a class="list-row" href="#/sets/new?song=${song.id}&transpose=${transpose}"><span class="row-main"><strong>New set…</strong><small>Start a set with this song</small></span>${icon("next")}</a>
    </div>`);

  sheet.querySelectorAll<HTMLButtonElement>("[data-set]").forEach((button) => {
    button.addEventListener("click", () => void ctx.run(async () => {
      // The set a song goes into becomes the current one, so the next ＋ adds there too.
      const setId = String(button.dataset.set);
      if (setId !== currentId) await ctx.currentSet.choose(setId);
      await ctx.currentSet.addSong(song.id, transpose);
      closeSheet(sheet);
      showToast(`Added to ${ctx.currentSet.value?.name ?? "the set"}.`);
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
  setTitle(song ? `Edit ${song.title}` : draft ? `Add ${draft.title}` : "New song", "Songs");
  ctx.main.innerHTML = `${pageHead({ title: song ? "Edit song" : draft ? "Add song" : "New song", quietTitle: true, back, actions: `<div class="segmented ce-modes" role="group" aria-label="Edit as"></div>` })}
  ${draft ? `<p class="online-source">Found on <a href="${escapeHtml(draft.source_url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(draft.source_name)}</a>. Check the words and chords, then save to add it to the library.</p>` : ""}
  <form class="editor" id="editor-form">
    <div id="chord-editor"></div>
    <p class="form-message" role="status"></p>
  </form>`;

  // Save is the ✓ in the editor's bar; Back leaves without saving.
  const form = ctx.main.querySelector<HTMLFormElement>("#editor-form")!;
  const editor = mountChordEditor(ctx.main.querySelector<HTMLElement>("#chord-editor")!, song?.chordpro ?? draft?.chordpro ?? NEW_SONG_TEMPLATE, {
    modes: ctx.main.querySelector<HTMLElement>(".ce-modes")!,
    save: () => form.requestSubmit(),
    dock: ctx.main.querySelector<HTMLElement>(".app-bar-row") ?? undefined,
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
        showToast("Saved a new revision.");
        ctx.navigate(`#/songs/${song.id}`, true);
      } else {
        const created = await ctx.api.createSong(source);
        showToast("Added the song.");
        ctx.navigate(`#/songs/${created.id}`, true);
      }
    } catch (error) {
      setFormBusy(form, false);
      if (error instanceof ApiError && error.status === 401) return ctx.signOut();
      if (error instanceof ApiError && error.status === 409) {
        message.innerHTML = `Someone saved this song after you opened it. Your text is still here: copy what you need, then <a href="#/songs/${song?.id}">open the latest version</a> and edit again.`;
        return;
      }
      // The server's objection is to the text: tie it to the field.
      showFormError(form, errorMessage(error));
    }
  });
  return () => editor.destroy();
}

let sheetCount = 0;

/**
 * A bottom sheet on phones, a centred dialog on wide screens: a modal
 * `<dialog>` named by its first heading. It slides up as it opens (fades in
 * on wide screens), and Escape, a tap outside it or (on phones) a swipe down
 * slides it away again (`closeSheet`). Focus goes back to the control that
 * opened it (or the screen's heading, when a redraw replaced that control).
 * With `closeButton: false` the × is there only for screen readers.
 */
export function openSheet(content: string, { closeButton = true } = {}): HTMLDialogElement {
  const opener = document.activeElement instanceof HTMLElement && document.activeElement !== document.body
    ? document.activeElement
    : null;
  const dialog = document.createElement("dialog");
  dialog.className = "sheet";
  dialog.innerHTML = `<div class="sheet-body"><span class="sheet-grip" aria-hidden="true"></span><button type="button" class="icon-button sheet-close${closeButton ? "" : " sr-only"}" aria-label="Close">${icon("close")}</button>${content}</div>`;
  if (!closeButton) dialog.classList.add("no-close");
  const heading = dialog.querySelector("h2");
  if (heading) {
    heading.id ||= `sheet-title-${++sheetCount}`;
    dialog.setAttribute("aria-labelledby", heading.id);
  }
  document.body.append(dialog);
  dialog.querySelector(".sheet-close")?.addEventListener("click", () => closeSheet(dialog));
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) closeSheet(dialog);
  });
  // Escape slides it away too, instead of the browser closing it at once.
  dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    closeSheet(dialog);
  });
  dialog.addEventListener("close", () => {
    dialog.remove();
    // Wait for whatever the closing action redraws.
    window.setTimeout(() => {
      const focus = document.activeElement;
      if (focus && focus !== document.body && focus.isConnected) return;
      if (opener?.isConnected) opener.focus();
      else (document.querySelector<HTMLElement>("#page h1") ?? document.querySelector<HTMLElement>("#page"))?.focus({ preventScroll: true });
    }, 0);
  });
  bindSwipeDown(dialog);
  dialog.showModal();
  return dialog;
}

/**
 * On phones the sheet follows a finger dragging it down and closes when let
 * go far or fast enough, else springs back. A drag starts only while what is
 * under the finger is scrolled to its top, and never in a row that scrolls
 * sideways (such as the chord shapes) or a field.
 */
function bindSwipeDown(dialog: HTMLDialogElement): void {
  let startX = 0;
  let startY = 0;
  let startTime = 0;
  let offset = 0;
  let mode: "off" | "maybe" | "drag" = "off";
  const atTop = (target: Element | null) => {
    for (let node = target; node && node !== dialog.parentElement; node = node.parentElement) {
      if (node.scrollTop > 0) return false;
    }
    return true;
  };
  dialog.addEventListener("touchstart", (event) => {
    mode = "off";
    const target = event.target as Element;
    if (event.touches.length !== 1 || !matchMedia("(max-width: 639px)").matches) return;
    if (target.closest("input, textarea, select, [contenteditable], .chord-shapes") || !atTop(target)) return;
    startX = event.touches[0].clientX;
    startY = event.touches[0].clientY;
    startTime = event.timeStamp;
    offset = 0;
    mode = "maybe";
  }, { passive: true });
  dialog.addEventListener("touchmove", (event) => {
    if (mode === "off") return;
    const dx = event.touches[0].clientX - startX;
    const dy = event.touches[0].clientY - startY;
    if (mode === "maybe") {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
      if (dy <= 0 || Math.abs(dx) > dy) {
        mode = "off";
        return;
      }
      mode = "drag";
      dialog.classList.add("dragging");
    }
    event.preventDefault();
    offset = Math.max(0, dy);
    dialog.style.transform = `translateY(${offset}px)`;
  }, { passive: false });
  const end = (event: TouchEvent) => {
    if (mode !== "drag") {
      mode = "off";
      return;
    }
    mode = "off";
    dialog.classList.remove("dragging");
    const fast = offset / Math.max(1, event.timeStamp - startTime) > 0.5;
    // Closing slides on down from where the finger let go.
    if (offset > Math.min(140, dialog.offsetHeight * 0.3) || (fast && offset > 30)) closeSheet(dialog);
    else {
      dialog.style.transform = "";
    }
  };
  dialog.addEventListener("touchend", end);
  dialog.addEventListener("touchcancel", end);
}

/**
 * Slides the sheet down (on wide screens, fades it) and then closes it, so
 * every sheet leaves the way it came. Without motion it closes at once.
 */
export function closeSheet(dialog: HTMLDialogElement): void {
  if (!dialog.open) {
    dialog.remove();
    return;
  }
  if (dialog.classList.contains("leaving")) return;
  const close = () => {
    if (dialog.open) dialog.close();
  };
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return close();
  dialog.classList.add("leaving");
  // From where a swipe left it, if it did.
  dialog.style.transform = "";
  dialog.addEventListener("transitionend", (event) => {
    if (event.target === dialog) close();
  });
  window.setTimeout(close, 400);
}
