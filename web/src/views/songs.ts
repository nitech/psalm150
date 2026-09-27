import { ApiError } from "../api.ts";
import { emptyState, pageHead, type AppContext, type Cleanup } from "../context.ts";
import { icon } from "../icons.ts";
import {
  bindReaderControls,
  prepareSong,
  readReaderOptions,
  readerControls,
  renderSongBody,
  stepTranspose,
} from "../song-render.ts";
import type { SongDetail, SongSummary } from "../types.ts";
import { errorMessage, escapeHtml, serviceDate, setFormBusy, showToast, today } from "../ui.ts";

/** Kept while the tab is open so Back returns to the same search. */
let lastSearch = "";

const NEW_SONG_TEMPLATE = "{title: }\n{author: }\n{key: }\n\n{start_of_verse}\n\n{end_of_verse}\n";

export function songRow(song: SongSummary, href: string, trailing = ""): string {
  return `<a class="list-row" href="${href}">
    <span class="row-lead">${escapeHtml(song.song_number ?? "")}</span>
    <span class="row-main"><strong>${escapeHtml(song.title)}</strong><small>${escapeHtml(song.authors || "Author not recorded")}</small></span>
    ${trailing || icon("next")}
  </a>`;
}

export async function songList(ctx: AppContext): Promise<Cleanup> {
  ctx.main.innerHTML = `${pageHead({
    title: "Songs",
    subtitle: ctx.session.church_name,
    actions: ctx.canEdit ? `<a class="icon-button accent" href="#/songs/new" aria-label="New song">${icon("plus")}</a>` : "",
  })}
  <div class="search-field">${icon("search")}<input type="search" id="song-search" value="${escapeHtml(lastSearch)}" placeholder="Title, number, author or a line" aria-label="Search songs" enterkeyhint="search" autocomplete="off" /></div>
  <div class="list" id="song-results" aria-live="polite"><p class="muted pad">Loading…</p></div>`;

  const input = ctx.main.querySelector<HTMLInputElement>("#song-search")!;
  const results = ctx.main.querySelector<HTMLElement>("#song-results")!;
  let timer = 0;
  let request = 0;

  const load = async () => {
    const mine = ++request;
    try {
      const songs = await ctx.api.listSongs(lastSearch);
      if (mine !== request) return;
      results.innerHTML = songs.length
        ? songs.map((song) => songRow(song, `#/songs/${song.id}`)).join("")
        : emptyState(
            lastSearch ? "No songs found" : "No songs yet",
            lastSearch ? "Try another title or a line from the lyrics." : "Import ChordPro files under More, or add a song.",
          );
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) return ctx.signOut();
      results.innerHTML = `<p class="form-message pad">${escapeHtml(errorMessage(error))}</p>`;
    }
  };

  input.addEventListener("input", () => {
    lastSearch = input.value.trim();
    window.clearTimeout(timer);
    timer = window.setTimeout(load, 250);
  });
  await load();
  return () => window.clearTimeout(timer);
}

export async function songDetail(ctx: AppContext, [songId]: string[]): Promise<void> {
  const song = await ctx.api.getSong(songId);
  const options = readReaderOptions();
  let transpose = 0;

  const render = () => {
    const display = prepareSong(song.chordpro, transpose);
    const meta = [song.song_number ? `No. ${song.song_number}` : "", song.authors, song.language?.toUpperCase() ?? ""]
      .filter(Boolean).map(escapeHtml).join(" · ");
    ctx.main.innerHTML = `${pageHead({
      title: song.title,
      back: "#/songs",
      actions: ctx.canEdit
        ? `<button class="icon-button" id="add-to-set" aria-label="Add to a set">${icon("sets")}</button>
           <a class="icon-button" href="#/songs/${song.id}/edit" aria-label="Edit song">${icon("edit")}</a>`
        : "",
    })}
    ${meta ? `<p class="page-meta">${meta}</p>` : ""}
    ${readerControls(display, options, transpose)}
    ${renderSongBody(display, options)}
    <p class="fine-print">Revision ${song.revision_id.slice(0, 8)} · Transposing here only changes what you see.</p>`;
    bindReaderControls(ctx.main, options, (step) => {
      transpose = stepTranspose(transpose, step);
      render();
    });
    ctx.main.querySelector("#add-to-set")?.addEventListener("click", () => void ctx.run(() => openAddToSet(ctx, song, transpose)));
  };
  render();
}

/** Bottom sheet: append this song to an upcoming set, or start a new one. */
async function openAddToSet(ctx: AppContext, song: SongDetail, transpose: number): Promise<void> {
  const sets = (await ctx.api.listSets()).filter((set) => !set.service_date || set.service_date >= today());
  const sheet = openSheet(`<h2>Add to a set</h2>
    <p class="muted">${escapeHtml(song.title)}${transpose ? ` · transposed ${transpose > 0 ? "+" : ""}${transpose}` : ""}</p>
    <div class="list">
      ${sets.map((set) => `<button class="list-row" data-set="${set.id}">
        <span class="row-main"><strong>${escapeHtml(set.name)}</strong><small>${serviceDate(set.service_date)} · ${set.item_count} ${set.item_count === 1 ? "item" : "items"}</small></span>${icon("plus")}
      </button>`).join("")}
      <a class="list-row" href="#/sets/new?song=${song.id}&transpose=${transpose}"><span class="row-main"><strong>New set…</strong><small>Start a set with this song</small></span>${icon("next")}</a>
    </div>`);

  sheet.querySelectorAll<HTMLButtonElement>("[data-set]").forEach((button) => {
    button.addEventListener("click", () => void ctx.run(async () => {
      const set = await ctx.api.getSet(String(button.dataset.set));
      const items = set.items.map((item) => ({
        id: item.id, kind: item.kind, song_id: item.song_id, transpose: item.transpose, note: item.note,
      }));
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
