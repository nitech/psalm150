import { ApiError } from "../api.ts";
import { emptyState, pageHead, routeQuery, type AppContext, type Cleanup } from "../context.ts";
import { icon } from "../icons.ts";
import {
  bindReaderControls,
  prepareSong,
  readReaderOptions,
  readerControls,
  renderSongBody,
  stepTranspose,
} from "../song-render.ts";
import type { RemoteDesktop, SetDetail, SetItem, SetItemInput, SetSummary, SongDetail } from "../types.ts";
import {
  errorMessage,
  escapeHtml,
  readPreference,
  serviceDate,
  setFormBusy,
  showToast,
  today,
  transposeLabel,
  writePreference,
} from "../ui.ts";
import { closeSheet, openSheet } from "./songs.ts";

function setRow(set: SetSummary): string {
  const [, month, day] = (set.service_date ?? "").split("-");
  const monthName = set.service_date
    ? new Date(Number(set.service_date.slice(0, 4)), Number(month) - 1, 1).toLocaleDateString(undefined, { month: "short" })
    : "";
  return `<a class="list-row" href="#/sets/${set.id}">
    <span class="date-badge">${set.service_date ? `<strong>${Number(day)}</strong><small>${escapeHtml(monthName)}</small>` : "<small>No date</small>"}</span>
    <span class="row-main"><strong>${escapeHtml(set.name)}</strong><small>${serviceDate(set.service_date)} · ${set.item_count} ${set.item_count === 1 ? "item" : "items"}</small></span>
    ${icon("next")}
  </a>`;
}

export async function setList(ctx: AppContext): Promise<void> {
  const sets = await ctx.api.listSets();
  const now = today();
  const upcoming = sets.filter((set) => !set.service_date || set.service_date >= now).reverse();
  const past = sets.filter((set) => set.service_date && set.service_date < now);
  ctx.main.innerHTML = `${pageHead({
    title: "Sets",
    subtitle: ctx.session.church_name,
    actions: ctx.canEdit ? `<a class="icon-button accent" href="#/sets/new" aria-label="New set">${icon("plus")}</a>` : "",
  })}
  ${sets.length ? "" : emptyState("No sets yet", ctx.canEdit ? "Make a set for the next service; the desktop picks it up at its next synchronization." : "Leaders make sets for each service. They will appear here.")}
  ${upcoming.length ? `<h2 class="list-heading">Upcoming</h2><div class="list">${upcoming.map(setRow).join("")}</div>` : ""}
  ${past.length ? `<h2 class="list-heading">Earlier</h2><div class="list">${past.map(setRow).join("")}</div>` : ""}`;
}

function itemTitle(item: SetItem): string {
  if (item.kind === "blank") return "Blank screen";
  return item.song?.title ?? "Deleted song";
}

export async function setDetail(ctx: AppContext, [setId]: string[]): Promise<void> {
  const set = await ctx.api.getSet(setId);
  ctx.main.innerHTML = `${pageHead({
    title: set.name,
    subtitle: serviceDate(set.service_date, true),
    back: "#/sets",
    actions: ctx.canEdit ? `<a class="icon-button" href="#/sets/${set.id}/edit" aria-label="Edit set">${icon("edit")}</a>` : "",
  })}
  ${set.items.length
    ? `<a class="button primary wide" href="#/sets/${set.id}/play/0">${icon("play")}Open for the service</a>
       <ol class="list numbered">${set.items.map((item, index) => `<li>
        <a class="list-row" href="#/sets/${set.id}/play/${index}">
          <span class="row-lead">${index + 1}</span>
          <span class="row-main"><strong class="${item.kind === "song" && !item.song ? "missing" : ""}">${escapeHtml(itemTitle(item))}</strong>
            <small>${[item.song?.song_number ? `No. ${escapeHtml(item.song.song_number)}` : "", item.transpose ? `Transpose ${transposeLabel(item.transpose)}` : "", escapeHtml(item.note)].filter(Boolean).join(" · ") || "&nbsp;"}</small></span>
          ${icon("next")}
        </a></li>`).join("")}</ol>`
    : emptyState("This set is empty", ctx.canEdit ? "Edit the set to add songs." : "A leader has not added songs yet.")}
  <p class="fine-print">Updated ${new Date(set.updated_at).toLocaleString()} · version ${set.version}</p>`;
}

interface Draft {
  name: string;
  service_date: string | null;
  items: Array<SetItemInput & { id: string; title: string; subtitle: string }>;
}

export async function setEditor(ctx: AppContext, [setId]: string[]): Promise<void> {
  if (!ctx.canEdit) {
    ctx.navigate(setId ? `#/sets/${setId}` : "#/sets", true);
    return;
  }
  const existing = setId ? await ctx.api.getSet(setId) : null;
  const draft: Draft = existing
    ? {
        name: existing.name,
        service_date: existing.service_date,
        items: existing.items.map((item) => ({
          id: item.id,
          kind: item.kind,
          song_id: item.song_id,
          transpose: item.transpose,
          note: item.note,
          title: itemTitle(item),
          subtitle: item.song?.song_number ? `No. ${item.song.song_number}` : "",
        })),
      }
    : { name: "", service_date: nextSunday(), items: [] };

  // "New set…" from a song page starts the set with that song.
  const query = routeQuery();
  const startSong = query.get("song");
  if (!existing && startSong) {
    const song = await ctx.api.getSong(startSong);
    draft.items.push({
      id: crypto.randomUUID(),
      kind: "song",
      song_id: song.id,
      transpose: Number(query.get("transpose") ?? 0) || 0,
      note: "",
      title: song.title,
      subtitle: song.song_number ? `No. ${song.song_number}` : "",
    });
  }

  const back = existing ? `#/sets/${existing.id}` : "#/sets";
  ctx.main.innerHTML = `${pageHead({ title: existing ? "Edit set" : "New set", back })}
  <form class="set-form" id="set-form">
    <label>Name<input name="name" required maxlength="200" value="${escapeHtml(draft.name)}" placeholder="Sunday morning" /></label>
    <label>Service date<input name="date" type="date" value="${draft.service_date ?? ""}" /></label>
    <div class="list-heading-row"><h2 class="list-heading">Items</h2>
      <div class="inline-actions">
        <button type="button" class="button secondary small" id="add-blank">${icon("blank")}Blank</button>
        <button type="button" class="button secondary small" id="add-songs">${icon("plus")}Songs</button>
      </div>
    </div>
    <ol class="list editable" id="draft-items"></ol>
    <p class="form-message" role="status"></p>
    <div class="form-actions sticky">
      ${existing ? `<button type="button" class="icon-button danger" id="delete-set" aria-label="Delete set">${icon("trash")}</button>` : ""}
      <a class="button secondary" href="${back}">Cancel</a>
      <button class="button primary" type="submit">${icon("check")}Save</button>
    </div>
  </form>`;

  const form = ctx.main.querySelector<HTMLFormElement>("#set-form")!;
  const list = form.querySelector<HTMLOListElement>("#draft-items")!;
  const message = form.querySelector<HTMLElement>(".form-message")!;

  const renderItems = () => {
    list.innerHTML = draft.items.length
      ? draft.items.map((item, index) => `<li class="edit-row" data-index="${index}">
        <div class="edit-row-main">
          <span class="row-lead">${index + 1}</span>
          <span class="row-main"><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(item.subtitle) || "&nbsp;"}</small></span>
          <div class="row-tools">
            <button type="button" class="icon-button small" data-act="up" aria-label="Move up" ${index === 0 ? "disabled" : ""}>${icon("up")}</button>
            <button type="button" class="icon-button small" data-act="down" aria-label="Move down" ${index === draft.items.length - 1 ? "disabled" : ""}>${icon("down")}</button>
            <button type="button" class="icon-button small danger" data-act="remove" aria-label="Remove">${icon("close")}</button>
          </div>
        </div>
        <div class="edit-row-extra">
          ${item.kind === "song" ? `<div class="stepper" role="group" aria-label="Transpose">
            <button type="button" class="icon-button small" data-act="tdown" aria-label="Transpose down">${icon("minus")}</button>
            <span>Transpose ${transposeLabel(item.transpose ?? 0)}</span>
            <button type="button" class="icon-button small" data-act="tup" aria-label="Transpose up">${icon("plus")}</button>
          </div>` : ""}
          <input class="note-input" data-act="note" maxlength="500" placeholder="Note for the team" value="${escapeHtml(item.note ?? "")}" aria-label="Note" />
        </div>
      </li>`).join("")
      : `<li class="muted pad">No items yet. Add songs, or a blank screen for prayer or a reading.</li>`;
  };
  renderItems();

  list.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("button[data-act]");
    const row = button?.closest<HTMLElement>("[data-index]");
    if (!button || !row) return;
    const index = Number(row.dataset.index);
    const item = draft.items[index];
    switch (button.dataset.act) {
      case "up":
        draft.items.splice(index - 1, 0, ...draft.items.splice(index, 1));
        break;
      case "down":
        draft.items.splice(index + 1, 0, ...draft.items.splice(index, 1));
        break;
      case "remove":
        draft.items.splice(index, 1);
        break;
      case "tup":
        item.transpose = stepTranspose(item.transpose ?? 0, 1);
        break;
      case "tdown":
        item.transpose = stepTranspose(item.transpose ?? 0, -1);
        break;
    }
    renderItems();
  });
  list.addEventListener("input", (event) => {
    const input = event.target as HTMLInputElement;
    const row = input.closest<HTMLElement>("[data-index]");
    if (input.dataset.act === "note" && row) draft.items[Number(row.dataset.index)].note = input.value;
  });

  form.querySelector("#add-blank")?.addEventListener("click", () => {
    draft.items.push({ id: crypto.randomUUID(), kind: "blank", note: "", transpose: 0, title: "Blank screen", subtitle: "" });
    renderItems();
  });
  form.querySelector("#add-songs")?.addEventListener("click", () => openSongPicker(ctx, (song) => {
    draft.items.push({
      id: crypto.randomUUID(),
      kind: "song",
      song_id: song.id,
      transpose: 0,
      note: "",
      title: song.title,
      subtitle: song.song_number ? `No. ${song.song_number}` : "",
    });
    renderItems();
  }));

  form.querySelector("#delete-set")?.addEventListener("click", () => {
    if (!existing || !confirm(`Delete “${existing.name}” for everyone?`)) return;
    void ctx.run(async () => {
      try {
        await ctx.api.deleteSet(existing.id, existing.version);
      } catch (error) {
        if (error instanceof ApiError && error.status === 409) throw new Error("Someone changed this set. Reload it before deleting.");
        throw error;
      }
      showToast("Set deleted.");
      ctx.navigate("#/sets", true);
    });
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = new FormData(form);
    const input = {
      name: String(data.get("name") ?? "").trim(),
      service_date: String(data.get("date") ?? "") || null,
      items: draft.items.map(({ id, kind, song_id, transpose, note }) => ({
        id, kind, song_id: kind === "song" ? song_id : null, transpose: transpose ?? 0, note: note?.trim() ?? "",
      })),
    };
    setFormBusy(form, true);
    try {
      const saved = existing
        ? await ctx.api.updateSet(existing.id, existing.version, input)
        : await ctx.api.createSet(input);
      showToast(existing ? "Set saved." : "Set created.");
      ctx.navigate(`#/sets/${saved.id}`, true);
    } catch (error) {
      setFormBusy(form, false);
      if (error instanceof ApiError && error.status === 401) return ctx.signOut();
      if (error instanceof ApiError && error.status === 409) {
        message.innerHTML = `Someone else saved this set while you were editing. <a href="#/sets/${existing?.id}">Open their version</a> and make your change again.`;
        return;
      }
      message.textContent = errorMessage(error);
    }
  });
}

/** Search sheet that adds songs one tap at a time and stays open. */
function openSongPicker(ctx: AppContext, onPick: (song: { id: string; title: string; song_number: string | null }) => void): void {
  const sheet = openSheet(`<h2>Add songs</h2>
    <div class="search-field">${icon("search")}<input type="search" id="picker-search" placeholder="Title, number or a line" aria-label="Search songs" autocomplete="off" enterkeyhint="search" /></div>
    <div class="list" id="picker-results"></div>
    <button class="button primary wide" id="picker-done">Done</button>`);
  const input = sheet.querySelector<HTMLInputElement>("#picker-search")!;
  const results = sheet.querySelector<HTMLElement>("#picker-results")!;
  let timer = 0;
  let request = 0;
  const load = async () => {
    const mine = ++request;
    try {
      const songs = await ctx.api.listSongs(input.value.trim());
      if (mine !== request) return;
      results.innerHTML = songs.slice(0, 50).map((song) => `<button class="list-row" data-song="${song.id}" data-title="${escapeHtml(song.title)}" data-number="${escapeHtml(song.song_number ?? "")}">
        <span class="row-lead">${escapeHtml(song.song_number ?? "")}</span>
        <span class="row-main"><strong>${escapeHtml(song.title)}</strong><small>${escapeHtml(song.authors || "")}</small></span>${icon("plus")}
      </button>`).join("") || `<p class="muted pad">No songs found.</p>`;
    } catch (error) {
      results.innerHTML = `<p class="form-message pad">${escapeHtml(errorMessage(error))}</p>`;
    }
  };
  input.addEventListener("input", () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(load, 250);
  });
  results.addEventListener("click", (event) => {
    const row = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-song]");
    if (!row) return;
    onPick({ id: String(row.dataset.song), title: String(row.dataset.title), song_number: row.dataset.number || null });
    row.classList.add("added");
    row.querySelector(".icon")?.replaceWith(document.createRange().createContextualFragment(icon("check")));
    showToast(`Added ${row.dataset.title}.`);
  });
  sheet.querySelector("#picker-done")?.addEventListener("click", () => closeSheet(sheet));
  void load();
  input.focus();
}

function nextSunday(): string {
  const date = new Date();
  date.setDate(date.getDate() + ((7 - date.getDay()) % 7));
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * Service view: one item of a set at a time, with chords, big enough to play
 * from. Swipe or use the bottom bar to move; "Follow" moves along with the
 * desktop that projects this set.
 */
export async function setPlay(ctx: AppContext, [setId, indexParam]: string[]): Promise<Cleanup> {
  const set: SetDetail = await ctx.api.getSet(setId);
  const index = Math.max(0, Math.min(set.items.length - 1, Number(indexParam) || 0));
  const item = set.items[index];
  const songCache = new Map<string, SongDetail>();
  const options = readReaderOptions();
  let extraTranspose = 0;
  let following = readPreference("follow") === "on";
  let pollTimer = 0;
  let wakeLock: { release(): Promise<void> } | null = null;
  const go = (next: number) => ctx.navigate(`#/sets/${set.id}/play/${next}`, true);

  if (!item) {
    ctx.main.innerHTML = `${pageHead({ title: set.name, back: `#/sets/${set.id}` })}${emptyState("This set is empty", "Add songs to the set first.")}`;
    return () => undefined;
  }

  const song = item.kind === "song" && item.song_id ? await loadSong(ctx, songCache, item.song_id) : null;
  let desktops: RemoteDesktop[] = [];

  const render = () => {
    const prev = set.items[index - 1];
    const next = set.items[index + 1];
    const transpose = stepTranspose(item.transpose, extraTranspose);
    const display = song ? prepareSong(song.chordpro, transpose) : null;
    const target = pickDesktop(desktops);
    ctx.main.innerHTML = `<div class="play">
      ${pageHead({
        title: itemTitle(item),
        subtitle: `${set.name} · ${index + 1} of ${set.items.length}`,
        back: `#/sets/${set.id}`,
        actions: `<button class="icon-button${following ? " on" : ""}" id="follow" aria-pressed="${following}" aria-label="Follow the desktop" title="Follow the desktop">${icon("follow")}</button>`,
      })}
      ${item.note ? `<p class="set-note">${escapeHtml(item.note)}</p>` : ""}
      ${display ? readerControls(display, options, transpose) : ""}
      ${target && ctx.canEdit ? `<button class="button secondary wide" id="project-here">${icon("remote")}Project this on ${escapeHtml(target.name)}</button>` : ""}
      ${display ? renderSongBody(display, options) : item.kind === "blank" ? `<div class="blank-slide">Blank screen</div>` : emptyState("This song was deleted", "It is no longer in the library.")}
      <nav class="play-nav" aria-label="Set navigation">
        <button class="play-step" id="play-prev" ${prev ? "" : "disabled"}>${icon("back")}<span><small>Previous</small>${prev ? escapeHtml(itemTitle(prev)) : ""}</span></button>
        <button class="play-step next" id="play-next" ${next ? "" : "disabled"}><span><small>Next</small>${next ? escapeHtml(itemTitle(next)) : ""}</span>${icon("next")}</button>
      </nav>
    </div>`;

    if (display) {
      bindReaderControls(ctx.main, options, (step) => {
        extraTranspose = stepTranspose(extraTranspose, step);
        render();
      });
    }
    ctx.main.querySelector("#play-prev")?.addEventListener("click", () => prev && go(index - 1));
    ctx.main.querySelector("#play-next")?.addEventListener("click", () => next && go(index + 1));
    ctx.main.querySelector("#follow")?.addEventListener("click", () => {
      following = !following;
      writePreference("follow", following ? "on" : null);
      render();
      if (following) void poll();
    });
    ctx.main.querySelector("#project-here")?.addEventListener("click", () => void ctx.run(async () => {
      const desktop = pickDesktop(desktops);
      if (!desktop) throw new Error("No desktop accepts remote control right now.");
      await ctx.api.sendRemoteCommand(desktop.device_id, { action: "project_set_item", set_id: set.id, item_index: index });
      showToast(`Sent to ${desktop.name}.`);
    }));
  };

  const poll = async () => {
    window.clearTimeout(pollTimer);
    try {
      desktops = await ctx.api.listDesktops();
    } catch {
      desktops = [];
    }
    const leader = desktops.find((desktop) => desktop.online && desktop.state.set_id === set.id && desktop.state.set_item_index !== null);
    if (following && leader && leader.state.set_item_index !== index && leader.state.set_item_index! < set.items.length) {
      go(leader.state.set_item_index!);
      return;
    }
    render();
    pollTimer = window.setTimeout(poll, following ? 2500 : 15000);
  };

  // Swipe left/right to move through the set.
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
    if (dx < 0 && index + 1 < set.items.length) go(index + 1);
    if (dx > 0 && index > 0) go(index - 1);
  };
  const keys = (event: KeyboardEvent) => {
    if ((event.target as HTMLElement).closest("input,textarea")) return;
    if (event.key === "ArrowRight" && index + 1 < set.items.length) go(index + 1);
    if (event.key === "ArrowLeft" && index > 0) go(index - 1);
  };
  ctx.main.addEventListener("touchstart", touchStart, { passive: true });
  ctx.main.addEventListener("touchend", touchEnd);
  document.addEventListener("keydown", keys);

  // Keep the phone awake while reading from it.
  const nav = navigator as Navigator & { wakeLock?: { request(type: "screen"): Promise<{ release(): Promise<void> }> } };
  nav.wakeLock?.request("screen").then((lock) => { wakeLock = lock; }).catch(() => undefined);

  render();
  void poll();

  return () => {
    window.clearTimeout(pollTimer);
    ctx.main.removeEventListener("touchstart", touchStart);
    ctx.main.removeEventListener("touchend", touchEnd);
    document.removeEventListener("keydown", keys);
    void wakeLock?.release().catch(() => undefined);
  };
}

async function loadSong(ctx: AppContext, cache: Map<string, SongDetail>, id: string): Promise<SongDetail | null> {
  if (cache.has(id)) return cache.get(id)!;
  try {
    const song = await ctx.api.getSong(id);
    cache.set(id, song);
    return song;
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null;
    throw error;
  }
}

/** The desktop the phone steers: the one chosen under Remote, else the only one. */
export function pickDesktop(desktops: RemoteDesktop[]): RemoteDesktop | null {
  const ready = desktops.filter((desktop) => desktop.online && desktop.state.accepts_commands);
  const preferred = readPreference("desktop");
  return ready.find((desktop) => desktop.device_id === preferred) ?? (ready.length === 1 ? ready[0] : null);
}
