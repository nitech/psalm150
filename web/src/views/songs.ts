import { ApiError } from "../api.ts";
import { emptyState, menuButton, pageHead, type AppContext, type Cleanup, type LibraryContext } from "../context.ts";
import { groupSets, itemInputs } from "../current-set.ts";
import { icon } from "../icons.ts";
import {
  bindReaderControls,
  keyLabel,
  prepareSong,
  readReaderOptions,
  readerPanel,
  readerToggle,
  renderSongBody,
  songText,
  stepTranspose,
} from "../song-render.ts";
import type { SongSort, SongSummary, SortDirection } from "../types.ts";
import { copyText, errorMessage, escapeHtml, readPreference, serviceDate, setFormBusy, showToast, today, writePreference } from "../ui.ts";

/** Kept while the tab is open so Back returns to the same search. */
let lastSearch = "";

/** Songs per request; the list asks for the next page as you reach the end. */
const PAGE_SIZE = 100;

const NEW_SONG_TEMPLATE = "{title: }\n{author: }\n{key: }\n\n{start_of_verse}\n\n{end_of_verse}\n";

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
    <div class="search-field">${icon("search")}<input type="search" id="song-search" value="${escapeHtml(lastSearch)}" placeholder="Title, number, author or a line" aria-label="Search songs" enterkeyhint="search" autocomplete="off" /></div>
    ${ctx.canEdit ? `<a class="icon-button accent" href="#/songs/new" aria-label="New song" title="New song">${icon("plus")}</a>` : ""}
  </div>
  <div class="list-sort" id="song-sort" role="group" aria-label="Sort songs" hidden></div>
  <div class="list" id="song-results"><p class="muted pad">Loading…</p></div>
  <div class="load-more" id="load-more" hidden><button class="button secondary" id="more-songs">Show more songs</button></div>`;

  const input = ctx.main.querySelector<HTMLInputElement>("#song-search")!;
  const results = ctx.main.querySelector<HTMLElement>("#song-results")!;
  const more = ctx.main.querySelector<HTMLElement>("#load-more")!;
  const sortBar = ctx.main.querySelector<HTMLElement>("#song-sort")!;
  let timer = 0;
  let request = 0;
  let loaded = 0;
  let loading = false;
  let sort = readSongSort();
  /** Some song in the list has a number, so the number column is shown. */
  let numbered = false;

  const renderSort = () => {
    const button = (column: SongSort, label: string) => {
      const on = sort.column === column;
      const arrow = on ? `<span aria-hidden="true">${sort.direction === "asc" ? "↑" : "↓"}</span>` : "";
      const state = on ? `, ${sort.direction === "asc" ? "ascending" : "descending"}` : "";
      return `<button type="button" class="sort-${column}${on ? " on" : ""}" data-sort="${column}" aria-pressed="${on}" aria-label="Sort by ${column === "number" ? "number" : "title"}${state}">${label}${arrow}</button>`;
    };
    sortBar.classList.toggle("has-numbers", numbered);
    sortBar.innerHTML = `${numbered ? button("number", "No") : ""}${button("title", "Song")}`;
  };

  const row = (song: SongSummary) => {
    const main = `<span class="row-lead">${escapeHtml(song.song_number ?? "")}</span>
      <span class="row-main"><strong>${escapeHtml(song.title)}</strong></span>`;
    if (!ctx.canEdit) return `<a class="list-row" href="#/songs/${song.id}">${main}${icon("next")}</a>`;
    return `<div class="list-row song-row">
      <a class="row-link" href="#/songs/${song.id}">${main}</a>
      ${addToggle(ctx, { id: song.id, title: song.title })}
    </div>`;
  };

  const load = async (append: boolean) => {
    const mine = ++request;
    const offset = append ? loaded : 0;
    loading = true;
    try {
      const songs = await ctx.api.listSongs(lastSearch, { limit: PAGE_SIZE, offset, sort: sort.column, direction: sort.direction });
      if (mine !== request) return;
      // Sorted by number, numbered songs come first: the first page tells.
      numbered = (append && numbered) || songs.some((song) => song.song_number) || sort.column === "number";
      results.classList.toggle("has-numbers", numbered);
      sortBar.hidden = !append && !songs.length;
      renderSort();
      const html = songs.map(row).join("");
      if (append) results.insertAdjacentHTML("beforeend", html);
      else {
        results.innerHTML = songs.length
          ? html
          : emptyState(
              lastSearch ? "No songs found" : "No songs yet",
              lastSearch
                ? "Try another title or a line from the lyrics."
                : ctx.canEdit ? "Import ChordPro files under More, or add a song." : "Songs will appear here once they are added.",
            );
      }
      loaded = offset + songs.length;
      more.hidden = songs.length < PAGE_SIZE;
    } catch (error) {
      if (mine !== request) return;
      if (error instanceof ApiError && error.status === 401) return ctx.signOut();
      if (append) showToast(errorMessage(error), true);
      else results.innerHTML = `<p class="form-message pad">${escapeHtml(errorMessage(error))}</p>`;
    } finally {
      if (mine === request) loading = false;
    }
  };

  input.addEventListener("input", () => {
    lastSearch = input.value.trim();
    window.clearTimeout(timer);
    timer = window.setTimeout(() => void load(false), 250);
  });
  results.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-add]");
    if (button) toggleInCurrentSet(ctx, { id: button.dataset.add!, title: button.dataset.title! });
  });
  ctx.main.querySelector("#more-songs")?.addEventListener("click", () => void load(true));
  // Like the desktop: the sorted column again flips the direction; another
  // column starts ascending.
  sortBar.addEventListener("click", (event) => {
    const column = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-sort]")?.dataset.sort as SongSort | undefined;
    if (!column) return;
    sort = column === sort.column
      ? { column, direction: sort.direction === "asc" ? "desc" : "asc" }
      : { column, direction: "asc" };
    writePreference("song-sort", JSON.stringify(sort));
    renderSort();
    void load(false);
  });

  // Load the next page before the reader reaches the end of the list.
  const observer = new IntersectionObserver((entries) => {
    if (entries.some((entry) => entry.isIntersecting) && !loading && !more.hidden) void load(true);
  }, { rootMargin: "600px 0px" });
  observer.observe(more);

  const unsubscribe = ctx.currentSet.subscribe(() => refreshToggles(ctx, results));
  await load(false);
  return () => {
    window.clearTimeout(timer);
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
    if ((stored?.column === "title" || stored?.column === "number") && (stored.direction === "asc" || stored.direction === "desc")) {
      return { column: stored.column, direction: stored.direction };
    }
  } catch {
    // A damaged preference falls back to the default.
  }
  return { column: "title", direction: "asc" };
}

/** The ＋ / ✓ button that puts a song in the current set or takes it out. */
function addToggle(ctx: LibraryContext, song: SongRef): string {
  const inSet = ctx.currentSet.count(song.id) > 0;
  return `<button type="button" class="icon-button small add-toggle${inSet ? " on" : ""}" aria-pressed="${inSet}" data-add="${song.id}" data-title="${escapeHtml(song.title)}">${toggleInner(ctx, song)}</button>`;
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
    button.setAttribute("aria-pressed", String(inSet));
    button.innerHTML = toggleInner(ctx, song);
  });
}

/**
 * One tap: add the song to the current set, or take it out if it is there.
 * Both show a toast with Undo. Without a current set, offers the sets.
 */
function toggleInCurrentSet(ctx: LibraryContext, song: SongRef, transpose = 0): void {
  const store = ctx.currentSet;
  const set = store.value;
  if (!set) {
    void ctx.run(() => openAddToSet(ctx, song, transpose));
    return;
  }
  void ctx.run(async () => {
    if (store.count(song.id)) {
      const removed = await store.removeSong(song.id);
      showToast(`Removed from ${set.name}.`, {
        action: removed
          ? { label: "Undo", run: () => void ctx.run(() => store.restoreItem(removed.item, removed.index), { exclusive: false }) }
          : undefined,
      });
    } else {
      const itemId = await store.addSong(song.id, transpose);
      showToast(`Added to ${set.name}.`, {
        action: { label: "Undo", run: () => void ctx.run(() => store.removeItem(itemId), { exclusive: false }) },
      });
    }
  }, { exclusive: false });
}

export async function songDetail(ctx: LibraryContext, [songId]: string[]): Promise<Cleanup> {
  const song = await ctx.api.getSong(songId);
  const options = readReaderOptions();
  let transpose = 0;

  const setActions = () => {
    const set = ctx.currentSet.value;
    if (!set) return `<button type="button" class="button secondary" data-set-act="other">${icon("sets")}Add to a set</button>`;
    const inSet = ctx.currentSet.count(song.id) > 0;
    return `<button type="button" class="button ${inSet ? "secondary in-set" : "primary"} grow" data-set-act="toggle" aria-pressed="${inSet}"
        aria-label="${escapeHtml(inSet ? `In ${set.name}. Tap to remove it.` : `Add to ${set.name}`)}">
        ${icon(inSet ? "check" : "plus")}<span class="ellipsis">${escapeHtml(inSet ? `In ${set.name}` : `Add to ${set.name}`)}</span></button>
      <button type="button" class="icon-button" data-set-act="other" aria-label="Add to another set" title="Add to another set">${icon("sets")}</button>`;
  };

  const render = () => {
    const display = prepareSong(song.chordpro, transpose);
    const meta = [song.song_number ? `No. ${song.song_number}` : "", song.authors, keyLabel(display, transpose)]
      .filter(Boolean).map(escapeHtml).join(" · ");
    ctx.main.innerHTML = `${pageHead({
      title: song.title,
      back: "#/songs",
      autohide: true,
      actions: `<button type="button" class="icon-button ghost" id="copy-lyrics" aria-label="Copy the words" title="Copy the words">${icon("copy")}</button><button type="button" class="icon-button ghost" id="share-song" aria-label="Share song" title="Copy a link to this song">${icon("share")}</button>${readerToggle(options)}${ctx.canEdit ? `<a class="icon-button ghost" href="#/songs/${song.id}/edit" aria-label="Edit song">${icon("edit")}</a>` : ""}`,
      panel: readerPanel(display, options, transpose),
    })}
    ${meta ? `<p class="page-meta">${meta}</p>` : ""}
    ${ctx.canEdit ? `<div class="set-actions" id="set-actions">${setActions()}</div>` : ""}
    ${renderSongBody(display, options)}
    <p class="fine-print">Revision ${song.revision_id.slice(0, 8)} · Transposing here only changes what you see${ctx.canEdit ? " and what you add to a set" : ""}.</p>`;
    bindReaderControls(ctx.main, options, (step) => {
      transpose = stepTranspose(transpose, step);
      render();
    });
  };

  ctx.main.addEventListener("click", onSetAction);
  function onSetAction(event: Event): void {
    if ((event.target as HTMLElement).closest("#share-song")) {
      void shareSong(ctx, song);
      return;
    }
    if ((event.target as HTMLElement).closest("#copy-lyrics")) {
      void copyLyrics(song.title, songText(prepareSong(song.chordpro, 0)));
      return;
    }
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-set-act]");
    if (!button) return;
    if (button.dataset.setAct === "toggle") toggleInCurrentSet(ctx, song, transpose);
    else void ctx.run(() => openAddToSet(ctx, song, transpose));
  }

  // Only the buttons change when the current set does, so the reader keeps its place.
  const unsubscribe = ctx.currentSet.subscribe(() => {
    const actions = ctx.main.querySelector("#set-actions");
    if (actions) actions.innerHTML = setActions();
  });
  document.title = `${song.title} · PSA150`;
  render();
  return () => {
    ctx.main.removeEventListener("click", onSetAction);
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
 * Copies the song's permalink, `/songs/{id}`. The server serves the app
 * there (with the title for link previews when the library is public), and
 * the app moves on to `#/songs/{id}`.
 */
async function shareSong(ctx: LibraryContext, song: SongRef): Promise<void> {
  const url = `${location.origin}/songs/${song.id}`;
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
      const setId = String(button.dataset.set);
      if (setId === currentId) {
        await ctx.currentSet.addSong(song.id, transpose);
        closeSheet(sheet);
        showToast(`Added to ${ctx.currentSet.value?.name ?? "the set"}.`);
        return;
      }
      const set = await ctx.api.getSet(setId, { fresh: true });
      const items = itemInputs(set.items);
      items.push({ id: crypto.randomUUID(), kind: "song", song_id: song.id, transpose, note: "" });
      try {
        await ctx.api.updateSet(set.id, set.version, { name: set.name, service_date: set.service_date, items });
      } catch (error) {
        if (error instanceof ApiError && error.status === 409) {
          throw new Error("Someone changed that set just now. Try again.");
        }
        throw error;
      }
      closeSheet(sheet);
      showToast(`Added to ${set.name}.`);
    }));
  });
  sheet.querySelector("a")?.addEventListener("click", () => closeSheet(sheet));
}

export async function songEditor(ctx: AppContext, [songId]: string[]): Promise<void> {
  const song = songId ? await ctx.api.getSong(songId) : null;
  if (!ctx.canEdit) {
    ctx.navigate(song ? `#/songs/${song.id}` : "#/songs", true);
    return;
  }
  const back = song ? `#/songs/${song.id}` : "#/songs";
  ctx.main.innerHTML = `${pageHead({ title: song ? "Edit song" : "New song", subtitle: song?.title, back })}
  <form class="editor" id="editor-form">
    <label for="chordpro" class="sr-only">ChordPro source</label>
    <textarea id="chordpro" name="chordpro" spellcheck="true" autocapitalize="sentences">${escapeHtml(song?.chordpro ?? NEW_SONG_TEMPLATE)}</textarea>
    <p class="hint">ChordPro: put chords in brackets before the syllable, like <code>[G]Amazing [D]grace</code>. Sections use <code>{start_of_chorus}</code> … <code>{end_of_chorus}</code>.</p>
    <p class="form-message" role="status"></p>
    <div class="form-actions sticky">
      <a class="button secondary" href="${back}">Cancel</a>
      <button class="button primary" type="submit">${icon("check")}Save</button>
    </div>
  </form>`;

  const form = ctx.main.querySelector<HTMLFormElement>("#editor-form")!;
  const message = form.querySelector<HTMLElement>(".form-message")!;
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const source = String(new FormData(form).get("chordpro") ?? "");
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
      message.textContent = errorMessage(error);
    }
  });
}

/** A bottom sheet on phones, a centred dialog on wide screens. */
export function openSheet(content: string): HTMLDialogElement {
  const dialog = document.createElement("dialog");
  dialog.className = "sheet";
  dialog.innerHTML = `<div class="sheet-body"><button class="icon-button sheet-close" aria-label="Close">${icon("close")}</button>${content}</div>`;
  document.body.append(dialog);
  dialog.querySelector(".sheet-close")?.addEventListener("click", () => closeSheet(dialog));
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) closeSheet(dialog);
  });
  dialog.addEventListener("close", () => dialog.remove());
  dialog.showModal();
  return dialog;
}

export function closeSheet(dialog: HTMLDialogElement): void {
  if (dialog.open) dialog.close();
  dialog.remove();
}
