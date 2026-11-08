import { announce, keepFocus, setTitle } from "../../../shared/songs/a11y.ts";
import { ApiError } from "../api.ts";
import { emptyState, pageHead, routeQuery, type AppContext, type Cleanup } from "../context.ts";
import { groupSets } from "../current-set.ts";
import { icon } from "../icons.ts";
import {
  keyLabel,
  prepareSong,
  readReaderOptions,
  type ReaderOptions,
  renderSongBody,
} from "../song-render.ts";
import type { RemoteDesktop, SetDetail, SetItem, SetItemInput, SetShare, SetSummary, SongDetail, SongSummary } from "../types.ts";
import {
  copyText,
  dateBadge,
  errorMessage,
  escapeHtml,
  readPreference,
  searchClear,
  serviceDate,
  showToast,
  startPolling,
  today,
  transposeLabel,
} from "../ui.ts";
import { closeSheet, openSheet } from "../../../shared/songs/sheet.ts";
import { bindItemSwipe } from "../transitions.ts";
import { holdScreen } from "../wake-lock.ts";
import { bindSwipeDelete, swipeRow } from "../swipe-delete.ts";
import { transposeChord } from "../../../shared/songs/chordpro.ts";
import { barActions, bindBarActions } from "../bar-menu.ts";
import { songPage } from "./songs.ts";
import { locale, t, tn } from "../../../shared/songs/i18n.ts";

function setRow(set: SetSummary, currentId?: string): string {
  return `<li><a class="list-row" href="#/sets/${set.id}">
    ${dateBadge(set.service_date)}
    <span class="row-main"><strong>${escapeHtml(set.name)}${set.id === currentId ? ` <span class="badge">${t("Current")}</span>` : ""}${set.shared ? ` <span class="badge">${t("Shared")}</span>` : ""}</strong><small>${serviceDate(set.service_date)} · ${tn(set.item_count, "{n} item", "{n} items")}</small></span>
    ${icon("next")}
  </a></li>`;
}

/** The sets as last shown, so Back to the list draws it at once while it is read again. */
let shownSets: { church: string; json: string; sets: SetSummary[] } | null = null;

export async function setList(ctx: AppContext): Promise<void> {
  const church = ctx.session.church_name;
  const draw = (sets: SetSummary[]) => {
    const { upcoming, undated, past } = groupSets(sets, today());
    const currentId = ctx.currentSet.value?.id;
    const rows = (group: SetSummary[], label: string) => `<ul class="list flat-list" aria-labelledby="${label}">${group.map((set) => setRow(set, currentId)).join("")}</ul>`;
    ctx.main.innerHTML = `${pageHead({
      title: t("Sets"),
      church: ctx.session.church_name,
      compact: true,
      menu: true,
      actions: ctx.canEdit ? `<a class="icon-button accent" href="#/sets/new" aria-label="${t("New set")}">${icon("plus")}</a>` : "",
    })}
    ${sets.length ? "" : emptyState(t("No sets yet"), ctx.canEdit ? t("Make a set for the next service; the desktop picks it up at its next synchronization.") : t("Leaders make sets for each service. They will appear here."))}
    ${upcoming.length ? `<h2 class="list-heading" id="sets-upcoming">${t("Upcoming")}</h2>${rows(upcoming, "sets-upcoming")}` : ""}
    ${undated.length ? `<h2 class="list-heading" id="sets-undated">${t("No date")}</h2>${rows(undated, "sets-undated")}` : ""}
    ${past.length ? `<h2 class="list-heading" id="sets-past">${t("Earlier")}</h2>${rows(past, "sets-past")}` : ""}`;
  };
  const read = async () => {
    const sets = await ctx.api.listSets();
    const json = JSON.stringify(sets);
    const changed = shownSets?.church !== church || shownSets.json !== json;
    shownSets = { church, json, sets };
    return { sets, changed };
  };
  if (shownSets?.church === church) {
    draw(shownSets.sets);
    // Redrawn only if a set changed meanwhile, and only while still on screen.
    const main = ctx.main;
    void read().then(({ sets, changed }) => {
      if (changed && main.isConnected) keepFocus(main, () => draw(sets));
    }).catch(() => undefined);
    return;
  }
  draw((await read()).sets);
}

/**
 * An item of a set as its service view starts, for the neighbour peeking in
 * beside it while swiping. `song` is null while not read yet.
 */
export function itemPeek(setName: string, items: SetItem[], index: number, song: SongDetail | null | undefined, options: ReaderOptions): string {
  const item = items[index];
  const display = song ? prepareSong(song.chordpro, item.transpose) : null;
  // As the song page shows it (songPage): number, authors and key.
  const meta = display && song ? [song.song_number ? t("No. {number}", { number: song.song_number }) : "", song.authors, keyLabel(display, item.transpose)].filter(Boolean).map(escapeHtml).join(" · ") : "";
  return `<div class="page-titles"><p class="eyebrow">${escapeHtml(`${setName} · ${t("{position} of {total}", { position: index + 1, total: items.length })}`)}</p><h1>${escapeHtml(itemTitle(item))}</h1></div>
    ${meta ? `<p class="page-meta">${meta}</p>` : ""}
    ${item.note ? `<p class="set-note">${escapeHtml(item.note)}</p>` : ""}
    ${display ? renderSongBody(display, options) : item.kind === "blank" ? `<div class="blank-slide">${t("Blank screen")}</div>` : ""}`;
}

/** The key an item is played in: its song's key moved by the item's transpose, or "". */
export function itemKey(songKey: string | null | undefined, transpose: number): string {
  return songKey?.trim() ? transposeChord(songKey.trim(), transpose) : "";
}

/** The key at the end of a set's song row. */
export function keyCell(songKey: string | null | undefined, transpose: number): string {
  const key = itemKey(songKey, transpose);
  return key ? `<span class="row-key" aria-label="${t("Key {key}", { key: escapeHtml(key) })}">${escapeHtml(key)}</span>` : "";
}

export function itemTitle(item: SetItem): string {
  if (item.kind === "blank") return t("Blank screen");
  return item.song?.title ?? t("Deleted song");
}

/**
 * A set's page. Leaders only ever edit a set (every change is saved as it
 * is made), so for them it is the editor; everyone else gets the list.
 */
export function setPage(ctx: AppContext, params: string[]): Promise<Cleanup | void> {
  return ctx.canEdit ? setEditor(ctx, params) : setDetail(ctx, params);
}

/** A set's songs, read-only, in rows like the song list's. */
async function setDetail(ctx: AppContext, [setId]: string[]): Promise<Cleanup> {
  const set = await ctx.api.getSet(setId);
  setTitle(set.name, t("Sets"));
  const over = Boolean(set.service_date && set.service_date < today());
  const current = currentSetToggle(ctx, set, over);
  const numbered = set.items.some((item) => item.song?.song_number);
  ctx.main.innerHTML = `${pageHead({
    title: set.name,
    subtitle: serviceDate(set.service_date, true),
    back: "#/sets",
    // One button group, as on a song (the projector joins it, live.ts).
    actions: `<div class="bar-actions">${current.html}</div>`,
  })}
  ${set.items.length
    ? `<ol class="list numbered flat-list set-songs${numbered ? " has-numbers" : ""}" aria-label="${t("Songs: tap one to go through the set from there")}">${set.items.map((item, index) => {
        const extra = [item.transpose ? t("Transpose {steps}", { steps: transposeLabel(item.transpose) }) : "", escapeHtml(item.note)].filter(Boolean).join(" · ");
        const shown = lastShown.get(set.id) === item.id;
        return `<li${shown ? ' class="last-shown" aria-current="true"' : ""}><a class="list-row" href="#/sets/${set.id}/play/${index}">
          <span class="row-lead">${escapeHtml(item.song?.song_number ?? "")}</span>
          <span class="row-main"><strong class="${item.kind === "song" && !item.song ? "missing" : ""}">${escapeHtml(itemTitle(item))}</strong>${extra ? `<small>${extra}</small>` : ""}</span>
          ${keyCell(item.song?.song_key, item.transpose)}${icon("next")}
        </a></li>`;
      }).join("")}</ol>`
    : emptyState(t("This set is empty"), t("A leader has not added songs yet."))}
  <p class="fine-print">${t("Updated {time} · version {version}", { time: new Date(set.updated_at).toLocaleString(locale()), version: set.version })}</p>`;

  return current.bind(ctx.main);
}

/**
 * The current set's card is hidden on a set's own screens, so a switch in
 * their bar says whether this is the current set (pressed) and turns it on
 * or off. A set whose service is over can stop being current but not
 * become it again. `bind` returns the cleanup.
 */
function currentSetToggle(ctx: AppContext, set: { id: string; name: string }, over: boolean): { html: string; bind: (root: HTMLElement) => Cleanup } {
  const isCurrent = () => ctx.currentSet.value?.id === set.id;
  const inner = () => {
    if (!isCurrent() && over) return "";
    const label = isCurrent() ? t("The current set: tap to stop using it") : t("Make this the current set");
    return `<button type="button" class="icon-button ghost${isCurrent() ? " on" : ""}" data-current aria-pressed="${isCurrent()}" aria-label="${label}" title="${label}">${icon("setlist")}</button>`;
  };
  return {
    html: `<span class="current-toggle">${inner()}</span>`,
    bind: (root) => {
      const toggle = root.querySelector<HTMLElement>(".current-toggle")!;
      toggle.addEventListener("click", (event) => {
        if (!(event.target as HTMLElement).closest("[data-current]")) return;
        void ctx.run(async () => {
          if (isCurrent()) {
            await ctx.currentSet.dismiss();
            announce(t("{set} is no longer the current set.", { set: set.name }));
          } else {
            await ctx.currentSet.choose(set.id);
            announce(t("{set} is the current set.", { set: set.name }));
          }
        });
      });
      return ctx.currentSet.subscribe(() => {
        keepFocus(toggle, () => { toggle.innerHTML = inner(); }, () => toggle.querySelector<HTMLElement>("button"));
      });
    },
  };
}

/** Where a shared set opens, for anyone with the link. */
export function sharedSetUrl(key: string): string {
  return `${location.origin}/shared/${key}`;
}

/**
 * Leaders: share the set on a link, choose whether people with the link may
 * add and remove songs, copy or send the link, or stop sharing. `onChange`
 * hears whether the set is shared afterwards.
 */
async function openShareSheet(ctx: AppContext, set: SetDetail, onChange: (shared: boolean) => void): Promise<void> {
  let share: SetShare | null = null;
  if (set.shared) {
    try {
      share = await ctx.api.getSetShare(set.id);
    } catch (error) {
      if (!(error instanceof ApiError && error.status === 404)) throw error;
    }
  }
  let editable = share?.editable ?? false;
  const sheet = openSheet(`<h2>${t("Share this set")}</h2><div class="stack" id="share-body"></div>`);
  const body = sheet.querySelector<HTMLElement>("#share-body")!;
  const render = () => keepFocus(body, () => {
    const url = share ? sharedSetUrl(share.key) : "";
    body.innerHTML = `<p class="muted">${t("Anyone with the link can open this set and go through its songs, with their words, chords and notes, without signing in. They cannot change the songs or control a desktop.")}</p>
      <div class="stack">
        <h3 class="list-heading" id="share-edit-label">${t("Who can add and remove songs")}</h3>
        <div class="segmented" role="radiogroup" aria-labelledby="share-edit-label">
          ${[false, true].map((value) => `<button type="button" role="radio" aria-checked="${editable === value}" class="${editable === value ? "on" : ""}" data-editable="${value}">${value ? t("Anyone with the link") : t("Only leaders")}</button>`).join("")}
        </div>
        <p class="hint">${editable
          ? t("People with the link can add songs from your library to this set and remove songs from it, so they can also search and read every song in the library. Nothing else about the set changes through the link.")
          : t("People with the link can read the set; only leaders change it.")}</p>
      </div>
      ${share
        ? `<label>${t("Link")}<input id="share-url" readonly value="${escapeHtml(url)}" /></label>
          <div class="inline-actions wrap">
            <button type="button" class="button primary" id="share-copy">${icon("copy")}${t("Copy the link")}</button>
            ${"share" in navigator ? `<button type="button" class="button secondary" id="share-send">${icon("share")}${t("Share")}</button>` : ""}
          </div>
          <button type="button" class="button secondary danger wide" id="share-stop">${icon("close")}${t("Stop sharing")}</button>
          <p class="hint">${t("Stopping turns the link off at once for everyone who has it. Sharing again makes a new link.")}</p>`
        : `<button type="button" class="button primary wide" id="share-create">${icon("link")}${t("Create the link")}</button>`}
      <p class="form-message" role="status"></p>`;
  }, () => body.querySelector<HTMLElement>("#share-copy, #share-create"));
  /** Errors stay in the sheet, where the person is looking. */
  const act = async (action: () => Promise<void>) => {
    const message = body.querySelector<HTMLElement>(".form-message");
    if (message) message.textContent = "";
    try {
      await action();
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        closeSheet(sheet);
        ctx.signOut();
        return;
      }
      const after = body.querySelector<HTMLElement>(".form-message");
      if (after) after.textContent = errorMessage(error);
    }
  };
  render();

  body.addEventListener("click", (event) => {
    const target = event.target as HTMLElement;
    const choice = target.closest<HTMLButtonElement>("[data-editable]");
    if (choice) {
      const value = choice.dataset.editable === "true";
      if (value === editable) return;
      if (!share) {
        editable = value;
        render();
        return;
      }
      void act(async () => {
        share = await ctx.api.shareSet(set.id, value);
        editable = share.editable;
        render();
        showToast(editable ? t("People with the link can now add and remove songs.") : t("The link now only shows the set."));
      });
    } else if (target.closest("#share-create")) {
      void act(async () => {
        share = await ctx.api.shareSet(set.id, editable);
        onChange(true);
        render();
        showToast(t("Link created. Copy it or share it."));
      });
    } else if (target.closest("#share-copy") && share) {
      const url = sharedSetUrl(share.key);
      void copyText(url).then((copied) => {
        if (copied) showToast(t("Link copied."));
        else prompt(t("Copy the link:"), url);
      });
    } else if (target.closest("#share-send") && share) {
      const title = set.service_date ? `${set.name} · ${serviceDate(set.service_date, true)}` : set.name;
      void navigator.share({ title, text: `${title} · ${ctx.session.church_name}`, url: sharedSetUrl(share.key) }).catch(() => undefined);
    } else if (target.closest("#share-stop")) {
      if (!confirm(t("Stop sharing this set? The link stops working for everyone who has it."))) return;
      void act(async () => {
        await ctx.api.stopSharingSet(set.id);
        share = null;
        onChange(false);
        render();
        showToast(t("The set is no longer shared."));
      });
    }
  });
  body.addEventListener("focusin", (event) => {
    if ((event.target as HTMLElement).id === "share-url") (event.target as HTMLInputElement).select();
  });
}

interface Draft {
  name: string;
  service_date: string | null;
  items: Array<SetItemInput & { id: string; title: string; subtitle: string; number?: string | null; songKey?: string | null }>;
}

/** A save still on its way when the editor closed; the next editor waits for it. */
let savingInBackground: Promise<unknown> = Promise.resolve();

/** `2026-11-08` → "08.11.26". */
function shortDate(date: string | null): string {
  if (!date) return "";
  const [year, month, day] = date.split("-");
  return `${day}.${month}.${year.slice(2)}`;
}

/** The name is only the date's day and month ("8.11", "08.11."), so the date need not show as well. */
function nameIsDate(name: string, date: string | null): boolean {
  if (!date) return true;
  const match = /^(\d{1,2})\.(\d{1,2})\.?$/.exec(name);
  const [, month, day] = date.split("-").map(Number);
  return Boolean(match) && Number(match![1]) === day && Number(match![2]) === month;
}

/** A set with no name is called by its date, as "25.10", like the sets people make by hand. */
function defaultSetName(date: string | null): string {
  if (!date) return t("New set");
  const [, month, day] = date.split("-");
  return `${Number(day)}.${month}`;
}

export async function setEditor(ctx: AppContext, [setId]: string[]): Promise<Cleanup | void> {
  if (!ctx.canEdit) {
    // A set's page is the read-only list for them (`setPage`).
    if (setId) return setDetail(ctx, [setId]);
    ctx.navigate("#/sets", true);
    return;
  }
  await savingInBackground.catch(() => undefined);
  const existing = setId ? await ctx.api.getSet(setId, { fresh: true }) : null;
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
          number: item.song?.song_number ?? null,
          songKey: item.song?.song_key ?? null,
          // A transpose made elsewhere (the desktop, "Add to a set") is kept,
          // and so is a note; neither is edited here.
          subtitle: item.transpose ? t("Transpose {steps}", { steps: transposeLabel(item.transpose) }) : "",
        })),
      }
    : { name: "", service_date: nextSunday(), items: [] };

  // "New set…" from a song page starts the set with that song.
  const query = routeQuery();
  const startSong = query.get("song");
  // Only a song id: the value comes from the link and goes into an API path.
  const startedFromSong = Boolean(!existing && startSong && /^[0-9a-f-]{36}$/i.test(startSong));
  if (startedFromSong) {
    const song = await ctx.api.getSong(startSong!);
    draft.items.push({
      id: crypto.randomUUID(),
      kind: "song",
      song_id: song.id,
      transpose: Number(query.get("transpose") ?? 0) || 0,
      note: "",
      title: song.title,
      number: song.song_number,
      songKey: song.song_key,
      subtitle: Number(query.get("transpose")) ? t("Transpose {steps}", { steps: transposeLabel(Number(query.get("transpose"))) }) : "",
    });
  }

  setTitle(existing ? existing.name : t("New set"), t("Sets"));
  // Every change is saved as it is made, so there is no Save: Back is Done.
  // The bar: the current set switch, Add songs, ⋮ with Delete, and whether
  // the last change is saved.
  ctx.main.innerHTML = `${pageHead({
    title: existing ? existing.name : t("New set"),
    back: "#/sets",
    // The name and date are on the page, written in place; the bar has no
    // room for the name, and the heading is for screen readers only.
    compact: true,
    quietTitle: true,
    noBarTitle: true,
    // One button group, as on a song: search, the current set, Add songs,
    // the projector (live.ts) and ⋮, which ends the bar; "Saved" before it.
    // Search is a magnifier until tapped; then its field takes the whole bar,
    // as the song list's does.
    actions: `<span class="save-status" id="save-status" role="status"></span>
      <div class="bar-actions" data-bar-screen="set-edit">
        <div class="search-field bar-search">${icon("search")}<input type="search" id="set-search" placeholder="${t("Search the set and all songs")}" aria-label="${t("Search the set and all songs")}" autocomplete="off" enterkeyhint="search" /></div>
        <button type="button" class="icon-button ghost search-close" id="set-search-close" aria-label="${t("Close search")}" title="${t("Close search")}">${icon("close")}</button>
        <span class="set-edit-actions"></span>
        <button type="button" class="icon-button ghost" id="add-songs" aria-label="${t("Add songs")}" title="${t("Add songs")}">${icon("plus")}</button>
        <span class="set-edit-menu"></span>
      </div>`,
  })}
  <form class="set-form" id="set-form">
    <div class="set-heading">
      <input class="set-name" name="name" maxlength="200" value="${escapeHtml(draft.name)}" placeholder="${escapeHtml(defaultSetName(draft.service_date))}" aria-label="${t("Name")}" autocomplete="off" enterkeyhint="done" />
      <label class="set-date">
        <span id="set-date-text" aria-hidden="true">${escapeHtml(shortDate(draft.service_date))}</span>
        <span class="set-date-icon" aria-hidden="true">${icon("calendar")}</span>
        <input name="date" type="date" value="${draft.service_date ?? ""}" aria-label="${t("Service date")}" />
      </label>
    </div>
    <div id="set-search-results" hidden></div>
    <ol class="list editable flat-list set-songs" id="draft-items" aria-label="${t("Songs")}" data-song-list></ol>
    <p class="form-message" role="status"></p>
  </form>`;

  const form = ctx.main.querySelector<HTMLFormElement>("#set-form")!;
  const list = form.querySelector<HTMLOListElement>("#draft-items")!;
  const message = form.querySelector<HTMLElement>(".form-message")!;
  const status = ctx.main.querySelector<HTMLElement>("#save-status")!;
  const nameInput = form.querySelector<HTMLInputElement>("input[name='name']")!;
  const dateInput = form.querySelector<HTMLInputElement>("input[name='date']")!;
  /** The date at the right of the name, unless the name is that date (then a calendar, to change it). */
  const showDate = () => {
    const date = dateInput.value || null;
    form.querySelector("#set-date-text")!.textContent = shortDate(date);
    form.querySelector(".set-date")!.classList.toggle("same", nameIsDate(nameInput.value.trim() || defaultSetName(date), date));
  };
  showDate();

  /** The set as saved: none yet for a new set until its first change. */
  let saved: { id: string; version: number } | null = existing ? { id: existing.id, version: existing.version } : null;

  // Rows carry their item's id (`data-key`), so the control in use keeps
  // focus when a move or removal redraws the list.
  const renderItems = () => keepFocus(list, () => {
    list.innerHTML = draft.items.length
      ? draft.items.map((item, index) => {
        const name = escapeHtml(`${index + 1}, ${item.title}`);
        // A title opens the set at that song, as the set's list did; before
        // the set is first saved, the song itself.
        const href = saved ? `#/sets/${saved.id}/play/${index}` : `#/songs/${item.song_id}`;
        const title = item.kind === "song" && item.song_id
          ? `<a class="edit-row-title" href="${href}" data-title="${escapeHtml(item.title)}">${escapeHtml(item.title)}</a>`
          : escapeHtml(item.title);
        // Phones swipe a row left to delete it; a mouse has the × button.
        // The song last shown from the set is marked: how far the leader has come.
        const shown = Boolean(saved && lastShown.get(saved.id) === item.id);
        return `<li class="edit-row${shown ? " last-shown" : ""}" data-index="${index}" data-key="${item.id}"${shown ? ' aria-current="true"' : ""} data-swipe-row>${swipeRow(`<div class="edit-row-main">
          <button type="button" class="grip" data-grip aria-label="${t("Move {item}: drag, or use the up and down arrow keys", { item: name })}" title="${t("Drag to reorder")}">${icon("grip")}</button>
          <span class="row-lead">${escapeHtml(item.number ?? "")}</span>
          <span class="row-main"><strong>${title}</strong>${item.subtitle ? `<small>${escapeHtml(item.subtitle)}</small>` : ""}</span>
          ${keyCell(item.songKey, item.transpose ?? 0)}
          <div class="row-tools">
            <button type="button" class="icon-button small danger swipe-alt" data-act="remove" aria-label="${t("Remove: {item}", { item: name })}">${icon("close")}</button>
          </div>
        </div>`, t("Delete"))}</li>`;
      }).join("")
      : `<li class="muted pad">${t("No songs yet. Add them with + at the top.")}</li>`;
    list.classList.toggle("has-numbers", draft.items.some((item) => item.number));
  }, () => {
    // The row went: the next row's Remove, else Add songs.
    const same = Array.from(list.querySelectorAll<HTMLElement>("[data-key]")).find((row) => row.dataset.key === focusKey);
    const rows = list.querySelectorAll<HTMLElement>("[data-index]");
    const near = same ?? rows[Math.min(focusIndex, rows.length - 1)];
    return near?.querySelector<HTMLElement>(same ? "[data-grip]" : "button[data-act]") ?? ctx.main.querySelector<HTMLElement>("#add-songs");
  });
  /** The row of the last control used, for `renderItems`' fallback. */
  let focusIndex = 0;
  let focusKey = "";
  renderItems();
  // Back from a song: the marked row in view.
  list.querySelector(".last-shown")?.scrollIntoView({ block: "center" });

  const moveItem = (from: number, to: number) => {
    const [item] = draft.items.splice(from, 1);
    draft.items.splice(to, 0, item);
    focusIndex = to;
    focusKey = item.id;
    renderItems();
    announce(t("{title} moved to {position} of {total}.", { title: item.title, position: to + 1, total: draft.items.length }));
    save();
  };
  list.addEventListener("click", (event) => {
    const target = event.target as HTMLElement;
    // A song's title opens it; anything still waiting is saved on the way.
    if (target.closest(".edit-row-title")) return;
    const button = target.closest<HTMLButtonElement>("button[data-act='remove']");
    const row = button?.closest<HTMLElement>("[data-index]");
    if (button && row) removeItem(row);
  });
  const removeItem = (row: HTMLElement) => {
    const index = Number(row.dataset.index);
    const item = draft.items[index];
    if (!item) return;
    focusIndex = index;
    focusKey = "";
    draft.items.splice(index, 1);
    announce(t("{title} removed.", { title: item.title }));
    renderItems();
    save();
  };
  const unbindSwipe = bindSwipeDelete(list, removeItem);
  // The grip moves its row with the arrow keys, too.
  list.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
    const row = (event.target as HTMLElement).closest("[data-grip]")?.closest<HTMLElement>("[data-index]");
    if (!row) return;
    event.preventDefault();
    const index = Number(row.dataset.index);
    const to = index + (event.key === "ArrowUp" ? -1 : 1);
    if (to >= 0 && to < draft.items.length) moveItem(index, to);
  });
  // Drag a row by its grip to reorder, with a mouse or a finger (`bindReorder`).
  bindReorder(list, moveItem);
  const inDraft = (songId: string) => draft.items.filter((item) => item.song_id === songId).length;
  const addSong = (song: { id: string; title: string; song_number: string | null; song_key: string | null }) => {
    draft.items.push({
      id: crypto.randomUUID(),
      kind: "song",
      song_id: song.id,
      transpose: 0,
      note: "",
      title: song.title,
      number: song.song_number,
      songKey: song.song_key,
      subtitle: "",
    });
    renderItems();
    save();
  };
  ctx.main.querySelector("#add-songs")?.addEventListener("click", () => openSongPicker((search) => ctx.api.listSongs(search), inDraft, addSong));

  // ── Saving as you go ──
  let timer = 0;
  let running: Promise<void> | null = null;
  let again = false;
  /** Someone else saved meanwhile: stop, rather than overwrite their change. */
  let stale = false;
  let statusTimer = 0;
  const showStatus = (text: string, fade = false) => {
    window.clearTimeout(statusTimer);
    status.textContent = text;
    status.classList.toggle("shown", Boolean(text));
    if (fade) statusTimer = window.setTimeout(() => status.classList.remove("shown"), 1600);
  };
  const input = () => {
    const date = dateInput.value || null;
    return {
      name: nameInput.value.trim() || defaultSetName(date),
      service_date: date,
      items: draft.items.map(({ id, kind, song_id, transpose, note }) => ({
        id, kind, song_id: kind === "song" ? song_id : null, transpose: transpose ?? 0, note: note?.trim() ?? "",
      })),
    };
  };
  /** Saves now; a change made while saving is saved right after. */
  const flush = (): Promise<void> => {
    window.clearTimeout(timer);
    timer = 0;
    if (stale) return Promise.resolve();
    if (running) {
      again = true;
      return running;
    }
    showStatus(t("Saving…"));
    running = (async () => {
      try {
        const body = input();
        const result = saved
          ? await ctx.api.updateSet(saved.id, saved.version, body)
          : await ctx.api.createSet(body);
        const created = !saved;
        saved = { id: result.id, version: result.version };
        message.textContent = "";
        showStatus(t("Saved"), true);
        if (created) {
          // The new set is the one being edited from now on.
          history.replaceState(history.state, "", `#/sets/${result.id}`);
          setupBar(result);
          // The titles can open the set now.
          renderItems();
          // A set started from a song becomes the current set, like adding a song to one.
          if (startedFromSong) void ctx.currentSet.choose(result.id).catch(() => undefined);
        }
        if (created || ctx.currentSet.value?.id === result.id) void ctx.currentSet.refresh().catch(() => undefined);
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) {
          ctx.signOut();
          return;
        }
        if (error instanceof ApiError && error.status === 409) {
          stale = true;
          showStatus(t("Not saved"));
          message.innerHTML = t('Someone else changed this set while you were editing. <a href="{href}">Open their version</a> and make your change again.', { href: `#/sets/${saved?.id}` });
          return;
        }
        showStatus(t("Not saved"));
        message.textContent = t("{error} Your change is kept here and saved with the next one.", { error: errorMessage(error) });
      } finally {
        running = null;
      }
      if (again) {
        again = false;
        await flush();
      }
    })();
    savingInBackground = running;
    return running;
  };
  /** Saves after `delay` ms of quiet (typing), at once otherwise. */
  const save = (delay = 0) => {
    window.clearTimeout(timer);
    if (delay) {
      showStatus("");
      timer = window.setTimeout(() => void flush(), delay);
    } else {
      void flush();
    }
  };
  nameInput.addEventListener("input", () => {
    // The page's title is the set's name.
    const name = nameInput.value.trim() || defaultSetName(dateInput.value || null);
    ctx.main.querySelector(".page-titles h1")!.textContent = name;
    setTitle(name, t("Sets"));
    showDate();
    save(800);
  });
  nameInput.addEventListener("change", () => save());
  dateInput.addEventListener("change", () => {
    nameInput.placeholder = defaultSetName(dateInput.value || null);
    showDate();
    save();
  });
  // The date reads as text; a click on it opens the date picker (a touch
  // lands on the input itself).
  dateInput.addEventListener("click", () => {
    try {
      dateInput.showPicker?.();
    } catch {
      // Not allowed here: the field takes the click as it is.
    }
  });
  // Enter in the name saves (no form to send).
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    save();
    nameInput.blur();
  });

  // ── Searching: the set's own songs, then every song in the song book ──
  const searchInput = ctx.main.querySelector<HTMLInputElement>("#set-search")!;
  const searchResults = form.querySelector<HTMLElement>("#set-search-results")!;
  const appBar = ctx.main.querySelector<HTMLElement>(".app-bar")!;
  let searchTimer = 0;
  let searchRequest = 0;
  /**
   * A found song in the set's own columns: in the grip's place `lead` (+ for
   * the song book, nothing for the set's own), then the number, the title,
   * the key, and room for the × a mouse gets.
   */
  const songRow = (song: { title: string; song_number: string | null; song_key: string | null }, href: string, lead = "") => `<li class="edit-row">
    <div class="edit-row-main">
      ${lead || `<span class="lead-slot" aria-hidden="true"></span>`}
      <span class="row-lead">${escapeHtml(song.song_number ?? "")}</span>
      <span class="row-main"><strong><a class="edit-row-title" href="${href}">${escapeHtml(song.title)}</a></strong></span>
      ${keyCell(song.song_key, 0)}
      <div class="row-tools"><span class="icon-button small swipe-alt tool-space" aria-hidden="true"></span></div>
    </div>
  </li>`;
  const songList = (rows: string, numbered: boolean, labelledBy: string) =>
    `<ol class="list editable flat-list set-songs${numbered ? " has-numbers" : ""}" ${labelledBy ? `aria-labelledby="${labelledBy}"` : `aria-label="${t("Songs")}"`}>${rows}</ol>`;
  const search = async () => {
    const query = searchInput.value.trim();
    if (saved) setSearches.set(saved.id, query);
    const mine = ++searchRequest;
    list.hidden = Boolean(query);
    searchResults.hidden = !query;
    if (!query) {
      searchResults.innerHTML = "";
      return;
    }
    const folded = query.toLocaleLowerCase();
    const inSet = draft.items
      .map((item, index) => ({ item, index }))
      .filter(({ item }) => item.kind === "song" && (item.title.toLocaleLowerCase().includes(folded) || (item.number ?? "").startsWith(query)));
    const setRows = inSet.map(({ item, index }) => songRow(
      { title: item.title, song_number: item.number ?? null, song_key: itemKey(item.songKey, item.transpose ?? 0) || null },
      saved ? `#/sets/${saved.id}/play/${index}` : `#/songs/${item.song_id}`,
    )).join("");
    const setNumbered = inSet.some(({ item }) => item.number);
    // Only what was found: the set's own songs under their heading when any
    // match, then the song book's.
    const draw = (all: string, numbered = setNumbered) => {
      searchResults.innerHTML = setRows
        ? `<h2 class="list-heading" id="search-in-set">${t("In this set")}</h2>${songList(setRows, numbered, "search-in-set")}
          ${all ? `<h2 class="list-heading" id="search-all">${t("All songs")}</h2>${all}` : ""}`
        : all || `<p class="muted pad">${t("No songs found.")}</p>`;
    };
    draw(`<p class="muted pad" aria-busy="true">…</p>`);
    try {
      const songs = (await ctx.api.listSongs(query)).slice(0, 50);
      if (mine !== searchRequest) return;
      // Tap a song to open it; + adds it to this set. Both lists number
      // alike, so their columns line up.
      const numbered = setNumbered || songs.some((song) => song.song_number);
      const add = (song: SongSummary) => `<button type="button" class="lead-slot" data-add-song="${song.id}" aria-label="${t("Add {title}", { title: escapeHtml(song.title) })}" title="${t("Add {title}", { title: escapeHtml(song.title) })}">${icon("plus")}</button>`;
      draw(songs.length
        ? songList(songs.map((song) => songRow(song, `#/songs/${song.id}`, add(song))).join(""), numbered, setRows ? "search-all" : "")
        : "", numbered);
      searchSongs = songs;
    } catch (error) {
      if (mine === searchRequest) draw(`<p class="form-message">${escapeHtml(errorMessage(error))}</p>`);
    }
  };
  let searchSongs: SongSummary[] = [];
  searchInput.addEventListener("input", () => {
    window.clearTimeout(searchTimer);
    searchTimer = window.setTimeout(() => void search(), 250);
  });
  // Open while the field has focus or a search; an empty field closes on blur.
  searchInput.addEventListener("focus", () => appBar.classList.add("searching"));
  searchInput.addEventListener("blur", () => appBar.classList.toggle("searching", Boolean(searchInput.value.trim())));
  // × or Escape empties the search and closes it; × acts on pointerdown,
  // before the field's blur could move it. Enter closes the keyboard.
  const closeSearch = () => {
    window.clearTimeout(searchTimer);
    searchInput.value = "";
    void search();
    appBar.classList.remove("searching");
    searchInput.blur();
  };
  const closeButton = ctx.main.querySelector<HTMLButtonElement>("#set-search-close")!;
  closeButton.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    closeSearch();
  });
  closeButton.addEventListener("click", closeSearch);
  searchInput.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      closeSearch();
    } else if (event.key === "Enter") {
      searchInput.blur();
    }
  });
  searchResults.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-add-song]");
    const song = searchSongs.find((candidate) => candidate.id === button?.dataset.addSong);
    if (!song) return;
    addSong(song);
    showToast(t("Added {title}.", { title: song.title }));
    void search();
  });
  // Back from a song opened from the search: the same search again.
  const lastSearch = saved ? setSearches.get(saved.id) : "";
  if (lastSearch) {
    searchInput.value = lastSearch;
    appBar.classList.add("searching");
    void search();
  }

  // The bar's current set switch, Share and ⋮ (Delete), once the set exists.
  let unbindCurrent: Cleanup | undefined;
  /** The share button looks switched on while the set is shared. */
  let shared = false;
  const shareLabel = () => shared ? t("Shared on a link: manage the link") : t("Share on a link");
  const setupBar = (set: SetDetail) => {
    const over = Boolean(set.service_date && set.service_date < today());
    const current = currentSetToggle(ctx, set, over);
    shared = set.shared;
    ctx.main.querySelector(".set-edit-actions")!.innerHTML = `${current.html}<button type="button" class="icon-button ghost${shared ? " on" : ""}" data-share aria-label="${shareLabel()}" title="${shareLabel()}">${icon("share")}</button>`;
    const shareButton = ctx.main.querySelector<HTMLButtonElement>("[data-share]")!;
    shareButton.addEventListener("click", () => void ctx.run(() => openShareSheet(ctx, { ...set, shared }, (on) => {
      shared = on;
      shareButton.classList.toggle("on", on);
      shareButton.setAttribute("aria-label", shareLabel());
      shareButton.title = shareLabel();
    })));
    // ⋮ and its menu, in the bar's own group rather than a group of their own.
    const menu = ctx.main.querySelector<HTMLElement>(".set-edit-menu")!;
    menu.innerHTML = barActions("set-edit", [{ id: "delete-set", label: t("Delete set"), icon: "trash" }], 0);
    menu.replaceChildren(...menu.querySelector(".bar-actions")!.childNodes);
    unbindCurrent?.();
    unbindCurrent = current.bind(ctx.main);
  };
  if (existing) setupBar(existing);
  const unbindBar = bindBarActions(ctx.main);
  ctx.main.addEventListener("click", (event) => {
    if (!(event.target as HTMLElement).closest("[data-action='delete-set']")) return;
    const name = nameInput.value.trim() || defaultSetName(dateInput.value || null);
    if (!saved || !confirm(t("Delete “{name}” for everyone?", { name }))) return;
    window.clearTimeout(timer);
    stale = true;
    void ctx.run(async () => {
      await running?.catch(() => undefined);
      try {
        await ctx.api.deleteSet(saved!.id, saved!.version);
      } catch (error) {
        stale = false;
        if (error instanceof ApiError && error.status === 409) throw new Error(t("Someone changed this set. Reload it before deleting."));
        throw error;
      }
      showToast(t("Set deleted."));
      void ctx.currentSet.refresh().catch(() => undefined);
      ctx.navigate("#/sets", true);
    });
  });

  // A new set started from a song has something to save at once.
  if (startedFromSong) save();

  return () => {
    // Leaving with a name still being typed: save it on the way out.
    if (timer) void flush();
    unbindBar();
    unbindCurrent?.();
    unbindSwipe();
  };
}

/** Moves under this far before a press on the grip becomes a drag. */
const DRAG_SLOP = 4;
/** Closer than this to the top or bottom of the window, the page scrolls. */
const SCROLL_EDGE = 90;

/**
 * Reordering a list by dragging its rows' grips (`[data-grip]` inside
 * `[data-index]` rows). The row picked up floats as a ghost under the pointer
 * and its place shrinks to a green line with half a row of room around it;
 * the rows it passes slide aside, so the line is always where it would land.
 * Letting go opens the room to a full row and settles the ghost into it, then
 * `onMove(from, to)` reorders and redraws (it is not called for a drop where
 * it started). Escape, or the browser taking the touch, puts it back.
 */
function bindReorder(list: HTMLElement, onMove: (from: number, to: number) => void): void {
  let active = false;
  list.addEventListener("pointerdown", (down) => {
    if (active || down.button !== 0) return;
    const grip = (down.target as HTMLElement).closest<HTMLElement>("[data-grip]");
    const row = grip?.closest<HTMLElement>("[data-index]");
    if (!grip || !row) return;
    down.preventDefault();
    active = true;
    const pointer = down.pointerId;
    grip.setPointerCapture?.(pointer);

    const rows = [...list.querySelectorAll<HTMLElement>("[data-index]")];
    const from = rows.indexOf(row);
    const startScroll = window.scrollY;
    // Where every row sits in the page before anything moves.
    const boxes = rows.map((other) => {
      const box = other.getBoundingClientRect();
      return { top: box.top + startScroll, height: box.height };
    });
    const height = boxes[from].height;
    /** The room around the line while dragging. */
    const room = Math.round(height / 2);
    // Where every row sits once the dragged one has shrunk to the line.
    const shrunk = boxes.map((box, index) => ({
      top: index > from ? box.top - (height - room) : box.top,
      height: index === from ? room : box.height,
    }));
    const start = row.getBoundingClientRect();
    let pointerY = down.clientY;
    let to = from;
    let ghost: HTMLElement | null = null;
    let frame = 0;

    const dy = () => pointerY - down.clientY;
    const scrolled = () => window.scrollY - startScroll;
    /** How far the row's place moves to reach `to`, in `places` (full or shrunk rows). */
    const placeOffset = (places: typeof boxes) => to > from
      ? places[to].top + places[to].height - (places[from].top + places[from].height)
      : places[to].top - places[from].top;
    /** Moves the rows between `from` and `to` aside by `by`, and the row's place to `to`. */
    const shiftRows = (by: number, places: typeof boxes) => {
      rows.forEach((other, index) => {
        let shift = 0;
        if (index === from) shift = placeOffset(places);
        else if (from < index && index <= to) shift = -by;
        else if (to <= index && index < from) shift = by;
        other.style.transform = shift ? `translate3d(0, ${shift}px, 0)` : "";
      });
    };

    const lift = () => {
      ghost = row.cloneNode(true) as HTMLElement;
      ghost.removeAttribute("data-index");
      ghost.removeAttribute("data-key");
      // Out of the list, it keeps the list's columns (the numbers).
      ghost.classList.add("drag-ghost", ...Array.from(list.classList).filter((name) => name === "set-songs" || name === "has-numbers"));
      ghost.setAttribute("aria-hidden", "true");
      ghost.querySelectorAll("button").forEach((button) => { button.tabIndex = -1; });
      Object.assign(ghost.style, { left: `${start.left}px`, top: `${start.top}px`, width: `${start.width}px`, height: `${start.height}px` });
      document.body.append(ghost);
      list.classList.add("reordering");
      // The row's place shrinks to the line, smoothly.
      row.style.height = `${height}px`;
      void row.offsetHeight;
      row.classList.add("drag-origin");
      row.style.height = `${room}px`;
      document.body.classList.add("reordering");
      if (down.pointerType === "touch") navigator.vibrate?.(8);
    };

    const layout = () => {
      if (!ghost) return;
      ghost.style.transform = `translate3d(0, ${dy()}px, 0) scale(1.02)`;
      const centre = boxes[from].top + height / 2 + dy() + scrolled();
      const middle = (index: number) => shrunk[index].top + shrunk[index].height / 2;
      let next = from;
      while (next > 0 && centre < middle(next - 1)) next--;
      while (next < rows.length - 1 && centre > middle(next + 1)) next++;
      if (next === to) return;
      to = next;
      shiftRows(room, shrunk);
    };

    // Near the top or bottom edge the page scrolls, faster the closer.
    const autoScroll = () => {
      frame = requestAnimationFrame(autoScroll);
      const bottom = window.innerHeight - SCROLL_EDGE - 60;
      const step = pointerY < SCROLL_EDGE ? -(SCROLL_EDGE - pointerY) : pointerY > bottom ? pointerY - bottom : 0;
      if (!step) return;
      window.scrollBy(0, Math.max(-16, Math.min(16, step / 4)));
      layout();
    };

    const move = (event: PointerEvent) => {
      if (event.pointerId !== pointer) return;
      pointerY = event.clientY;
      if (!ghost) {
        if (Math.abs(dy()) < DRAG_SLOP) return;
        lift();
        autoScroll();
      }
      event.preventDefault();
      layout();
    };

    const finish = (drop: boolean) => {
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", up);
      document.removeEventListener("pointercancel", cancel);
      document.removeEventListener("keydown", escape, true);
      cancelAnimationFrame(frame);
      if (!ghost) {
        active = false;
        return;
      }
      if (!drop) to = from;
      // Open the place to a full row where it lands, settle the ghost into
      // it, then draw the list in its new order.
      list.classList.add("landing");
      row.style.height = `${height}px`;
      shiftRows(height, boxes);
      const settled = ghost;
      const target = placeOffset(boxes) - scrolled();
      settled.classList.add("settling");
      settled.style.transform = `translate3d(0, ${target}px, 0)`;
      const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
      let done = false;
      const land = () => {
        if (done) return;
        done = true;
        list.classList.remove("reordering", "landing");
        document.body.classList.remove("reordering");
        if (to !== from) onMove(from, to);
        else {
          row.classList.remove("drag-origin");
          row.style.height = "";
          rows.forEach((other) => { other.style.transform = ""; });
        }
        settled.remove();
        active = false;
      };
      if (reduced) land();
      else {
        settled.addEventListener("transitionend", land, { once: true });
        window.setTimeout(land, 300);
      }
    };
    const up = (event: PointerEvent) => {
      if (event.pointerId === pointer) finish(true);
    };
    const cancel = (event: PointerEvent) => {
      if (event.pointerId === pointer) finish(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      finish(false);
    };
    document.addEventListener("pointermove", move, { passive: false });
    document.addEventListener("pointerup", up);
    document.addEventListener("pointercancel", cancel);
    document.addEventListener("keydown", escape, true);
  });
}

/**
 * Search sheet that adds songs one tap at a time and stays open. `search`
 * reads the library: the church's, or the one a shared link opens.
 */
export function openSongPicker(
  search: (query: string) => Promise<SongSummary[]>,
  inDraft: (songId: string) => number,
  onPick: (song: { id: string; title: string; song_number: string | null; song_key: string | null }) => void,
): void {
  const sheet = openSheet(`<h2>${t("Add songs")}</h2>
    <div class="search-field">${icon("search")}<input type="search" id="picker-search" placeholder="${t("Title, number or a line")}" aria-label="${t("Search songs")}" autocomplete="off" enterkeyhint="search" />${searchClear}</div>
    <div class="list flat-list" id="picker-results"></div>
    <button class="button primary wide" id="picker-done">${t("Done")}</button>`);
  const input = sheet.querySelector<HTMLInputElement>("#picker-search")!;
  const results = sheet.querySelector<HTMLElement>("#picker-results")!;
  let timer = 0;
  let request = 0;
  const load = async () => {
    const mine = ++request;
    try {
      const songs = await search(input.value.trim());
      if (mine !== request) return;
      results.innerHTML = songs.slice(0, 50).map((song) => {
        const added = inDraft(song.id) > 0;
        return `<button class="list-row${added ? " added" : ""}" data-song="${song.id}" data-title="${escapeHtml(song.title)}" data-number="${escapeHtml(song.song_number ?? "")}" data-song-key="${escapeHtml(song.song_key ?? "")}">
        <span class="row-lead">${escapeHtml(song.song_number ?? "")}</span>
        <span class="row-main"><strong>${escapeHtml(song.title)}</strong><small>${added ? t("Already in this set · tap to add again") : escapeHtml(song.authors || "")}</small></span>${icon(added ? "check" : "plus")}
      </button>`;
      }).join("") || `<p class="muted pad">${t("No songs found.")}</p>`;
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
    const again = row.classList.contains("added");
    onPick({ id: String(row.dataset.song), title: String(row.dataset.title), song_number: row.dataset.number || null, song_key: row.dataset.songKey || null });
    row.classList.add("added");
    const small = row.querySelector("small");
    if (small) small.textContent = t("Already in this set · tap to add again");
    row.querySelector(".icon")?.replaceWith(document.createRange().createContextualFragment(icon("check")));
    showToast(again ? t("Added {title} again.", { title: String(row.dataset.title) }) : t("Added {title}.", { title: String(row.dataset.title) }));
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
  const options = readReaderOptions();
  const go = (next: number) => ctx.navigate(`#/sets/${set.id}/play/${next}`, true);

  if (!item) {
    ctx.main.innerHTML = `${pageHead({ title: set.name, back: `#/sets/${set.id}` })}${emptyState(t("This set is empty"), t("Add songs to the set first."))}`;
    return () => undefined;
  }
  // Back in the set's list, this row is marked: how far the leader has come.
  lastShown.set(set.id, item.id);

  const song = item.kind === "song" && item.song_id ? await loadSong(ctx, songCache, item.song_id) : null;
  setTitle(t("{title} ({position} of {total})", { title: itemTitle(item), position: index + 1, total: set.items.length }), set.name, t("Sets"));
  // Next and Previous keep focus on themselves; say where they went.
  announce(t("{title}, {position} of {total}", { title: itemTitle(item), position: index + 1, total: set.items.length }));
  let desktops: RemoteDesktop[] = [];
  let renderedTarget = "";
  const prev = set.items[index - 1];
  const next = set.items[index + 1];
  const eyebrow = `${set.name} · ${t("{position} of {total}", { position: index + 1, total: set.items.length })}`;

  /** Projecting sits in the bar beside Live (live.ts), not as a button under the title. */
  const projectButton = () => {
    const target = pickDesktop(desktops);
    renderedTarget = target && ctx.canEdit ? `${target.device_id}:${target.room_name}` : "";
    if (!target || !ctx.canEdit || ctx.live.controlled) return "";
    const label = t("Project this on {desktop}", { desktop: escapeHtml(target.room_name) });
    return `<button class="icon-button ghost" id="project-here" aria-label="${label}" title="${label}">${icon("project")}</button>`;
  };
  const peek = (step: 1 | -1) => {
    const neighbour = set.items[index + step];
    return itemPeek(set.name, set.items, index + step, neighbour?.song_id ? songCache.get(neighbour.song_id) : null, options);
  };

  // A song shows as in the song book, with the set around it; a blank or a
  // deleted song has a page of its own.
  const page = song
    ? songPage(ctx, song, {
      back: `#/sets/${set.id}`,
      eyebrow,
      note: item.note,
      transpose: item.transpose,
      previous: prev && { title: itemTitle(prev) },
      next: next && { title: itemTitle(next) },
      bottomNav: true,
      className: "play",
      go: (step) => go(index + step),
      peek: (step) => peek(step),
      barStart: projectButton,
    })
    : itemPage();

  function itemPage(): { cleanup: Cleanup; redrawBarStart: () => void } {
    ctx.main.innerHTML = `<div class="play swipe-view">
      ${pageHead({ title: itemTitle(item), subtitle: eyebrow, back: `#/sets/${set.id}`, autohide: true, actions: `<span id="song-bar-start">${projectButton()}</span>` })}
      ${item.note ? `<p class="set-note">${escapeHtml(item.note)}</p>` : ""}
      ${item.kind === "blank" ? `<div class="blank-slide">${t("Blank screen")}</div>` : emptyState(t("This song was deleted"), t("It is no longer in the library."))}
      ${playNav(prev && itemTitle(prev), next && itemTitle(next))}
    </div>`;
    ctx.main.querySelector("#play-prev")?.addEventListener("click", () => prev && go(index - 1));
    ctx.main.querySelector("#play-next")?.addEventListener("click", () => next && go(index + 1));
    const unbindSwipe = bindItemSwipe(ctx.main, { previous: index > 0, next: index + 1 < set.items.length }, (step) => go(index + step), peek);
    const keys = (event: KeyboardEvent) => {
      if ((event.target as HTMLElement).closest("input,textarea")) return;
      if (event.key === "ArrowRight" && next) go(index + 1);
      if (event.key === "ArrowLeft" && prev) go(index - 1);
    };
    document.addEventListener("keydown", keys);
    // Keep the phone awake while reading from it.
    const releaseScreen = holdScreen();
    return {
      cleanup: () => {
        unbindSwipe();
        document.removeEventListener("keydown", keys);
        releaseScreen();
      },
      redrawBarStart: () => {
        const holder = ctx.main.querySelector<HTMLElement>("#song-bar-start");
        if (holder) keepFocus(holder, () => { holder.innerHTML = projectButton(); });
      },
    };
  }

  const onProject = (event: Event) => {
    if (!(event.target as HTMLElement).closest("#project-here")) return;
    void ctx.run(async () => {
      const desktop = pickDesktop(desktops);
      if (!desktop) throw new Error(t("No desktop accepts remote control right now."));
      await ctx.api.sendRemoteCommand(desktop.device_id, { action: "project_set_item", set_id: set.id, item_index: index });
      showToast(t("Sent to {desktop}.", { desktop: desktop.room_name }));
    });
  };
  ctx.main.addEventListener("click", onProject);

  const poll = async () => {
    try {
      desktops = await ctx.api.listDesktops();
    } catch {
      desktops = [];
    }
    // Redraw only when the "Project this" button changes, so a poll never
    // interrupts a tap.
    const target = pickDesktop(desktops);
    if ((target && ctx.canEdit ? `${target.device_id}:${target.room_name}` : "") !== renderedTarget) page.redrawBarStart();
  };

  // The neighbours' songs, read now so a swipe to them opens at once.
  for (const neighbour of [next, prev]) {
    if (neighbour?.song_id) void loadSong(ctx, songCache, neighbour.song_id).catch(() => undefined);
  }

  ctx.live.showItem(set, index);
  // Controlling turned on or off in the Live sheet: "Project this" goes or comes back.
  const unsubscribeLive = ctx.live.subscribe(() => page.redrawBarStart());
  const poller = startPolling(poll, () => 15000);

  return () => {
    poller.stop();
    unsubscribeLive();
    ctx.live.leaveSet(set);
    ctx.main.removeEventListener("click", onProject);
    page.cleanup();
  };
}

/** The item last shown from each set (by set id), marked in the set's list. */
const lastShown = new Map<string, string>();
/** The search last made in each set's page (by set id), kept for coming back to it. */
const setSearches = new Map<string, string>();


/**
 * The step bar at the bottom of a service view: Previous and Next with the
 * title they lead to. At either end of the set its button is left out, and a
 * set of one item has no bar.
 */
export function playNav(previous: string | undefined, next: string | undefined): string {
  if (!previous && !next) return "";
  const step = (id: string, label: string, ariaLabel: string, title: string) => `<button class="play-step${id === "play-next" ? " next" : ""}" id="${id}" aria-label="${ariaLabel}">
      ${id === "play-prev" ? icon("back") : ""}<span><small>${label}</small><strong>${escapeHtml(title)}</strong></span>${id === "play-next" ? icon("next") : ""}
    </button>`;
  return `<nav class="play-nav" aria-label="${t("Set navigation")}">
    ${previous ? step("play-prev", t("Previous"), t("Previous: {title}", { title: escapeHtml(previous) }), previous) : "<span></span>"}
    ${next ? step("play-next", t("Next"), t("Next: {title}", { title: escapeHtml(next) }), next) : "<span></span>"}
  </nav>`;
}

/** Songs already opened in a service view, so moving back and forth is instant. */
const songCache = new Map<string, SongDetail>();

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
