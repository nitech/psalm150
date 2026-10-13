import { announce, keepFocus, setTitle } from "../a11y.ts";
import { ApiError } from "../api.ts";
import { emptyState, pageHead, routeQuery, type AppContext, type Cleanup } from "../context.ts";
import { groupSets } from "../current-set.ts";
import { icon } from "../icons.ts";
import {
  keyLabel,
  prepareSong,
  readReaderOptions,
  renderSongBody,
} from "../song-render.ts";
import type { RemoteDesktop, SetDetail, SetItem, SetItemInput, SetLive, SetShare, SetSummary, SongDetail, SongSummary } from "../types.ts";
import {
  copyText,
  dateBadge,
  errorMessage,
  escapeHtml,
  readPreference,
  serviceDate,
  setFormBusy,
  showToast,
  startPolling,
  today,
  transposeLabel,
} from "../ui.ts";
import { closeSheet, openSheet } from "./songs.ts";
import { bindItemSwipe } from "../transitions.ts";

function setRow(set: SetSummary, currentId?: string): string {
  return `<li><a class="list-row" href="#/sets/${set.id}">
    ${dateBadge(set.service_date)}
    <span class="row-main"><strong>${escapeHtml(set.name)}${set.id === currentId ? ` <span class="badge">Current</span>` : ""}${set.shared ? ` <span class="badge">Shared</span>` : ""}</strong><small>${serviceDate(set.service_date)} · ${set.item_count} ${set.item_count === 1 ? "item" : "items"}</small></span>
    ${icon("next")}
  </a></li>`;
}

export async function setList(ctx: AppContext): Promise<void> {
  const sets = await ctx.api.listSets();
  const { upcoming, undated, past } = groupSets(sets, today());
  const currentId = ctx.currentSet.value?.id;
  const rows = (group: SetSummary[], label: string) => `<ul class="list" aria-labelledby="${label}">${group.map((set) => setRow(set, currentId)).join("")}</ul>`;
  ctx.main.innerHTML = `${pageHead({
    title: "Sets",
    church: ctx.session.church_name,
    compact: true,
    menu: true,
    actions: ctx.canEdit ? `<a class="icon-button accent" href="#/sets/new" aria-label="New set">${icon("plus")}</a>` : "",
  })}
  ${sets.length ? "" : emptyState("No sets yet", ctx.canEdit ? "Make a set for the next service; the desktop picks it up at its next synchronization." : "Leaders make sets for each service. They will appear here.")}
  ${upcoming.length ? `<h2 class="list-heading" id="sets-upcoming">Upcoming</h2>${rows(upcoming, "sets-upcoming")}` : ""}
  ${undated.length ? `<h2 class="list-heading" id="sets-undated">No date</h2>${rows(undated, "sets-undated")}` : ""}
  ${past.length ? `<h2 class="list-heading" id="sets-past">Earlier</h2>${rows(past, "sets-past")}` : ""}`;
}

export function itemTitle(item: SetItem): string {
  if (item.kind === "blank") return "Blank screen";
  return item.song?.title ?? "Deleted song";
}

export async function setDetail(ctx: AppContext, [setId]: string[]): Promise<Cleanup> {
  const set = await ctx.api.getSet(setId);
  setTitle(set.name, "Sets");
  const over = Boolean(set.service_date && set.service_date < today());
  // The current set shows in the bar at the bottom; another set can become it.
  const currentStatus = () => ctx.currentSet.value?.id === set.id || over
    ? ""
    : `<button type="button" class="button secondary small" data-current="choose">${icon("check")}Make this the current set</button>`;
  /** The share button looks switched on while the set is shared. */
  const shareLabel = () => set.shared ? "Shared on a link: manage the link" : "Share on a link";
  ctx.main.innerHTML = `${pageHead({
    title: set.name,
    subtitle: serviceDate(set.service_date, true),
    back: "#/sets",
    actions: ctx.canEdit
      ? `<button type="button" class="icon-button ghost${set.shared ? " on" : ""}" data-share aria-label="${shareLabel()}" title="${shareLabel()}">${icon("share")}</button>
         <a class="icon-button ghost" href="#/sets/${set.id}/edit" aria-label="Edit set">${icon("edit")}</a>`
      : "",
  })}
  <div id="current-status">${currentStatus()}</div>
  ${set.items.length
    ? `<ol class="list numbered" aria-label="Songs: tap one to go through the set from there">${set.items.map((item, index) => `<li>
        <a class="list-row" href="#/sets/${set.id}/play/${index}">
          <span class="row-main"><strong class="${item.kind === "song" && !item.song ? "missing" : ""}">${escapeHtml(itemTitle(item))}</strong>
            <small>${[item.song?.song_number ? `No. ${escapeHtml(item.song.song_number)}` : "", item.transpose ? `Transpose ${transposeLabel(item.transpose)}` : "", escapeHtml(item.note)].filter(Boolean).join(" · ") || "&nbsp;"}</small></span>
          ${icon("next")}
        </a></li>`).join("")}</ol>`
    : emptyState("This set is empty", ctx.canEdit ? "Edit the set to add songs." : "A leader has not added songs yet.")}
  <p class="fine-print">Updated ${new Date(set.updated_at).toLocaleString()} · version ${set.version}</p>`;

  const shareButton = ctx.main.querySelector<HTMLButtonElement>("[data-share]");
  shareButton?.addEventListener("click", () => void ctx.run(() => openShareSheet(ctx, set, (shared) => {
    set.shared = shared;
    shareButton.classList.toggle("on", shared);
    shareButton.setAttribute("aria-label", shareLabel());
    shareButton.title = shareLabel();
  })));
  const status = ctx.main.querySelector<HTMLElement>("#current-status")!;
  status.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-current]");
    if (!button) return;
    void ctx.run(async () => {
      await ctx.currentSet.choose(button.dataset.current === "choose" ? set.id : null);
      const now = ctx.currentSet.value;
      showToast(now ? `${now.name} is the current set.` : "No upcoming set.");
    });
  });
  return ctx.currentSet.subscribe(() => {
    keepFocus(status, () => { status.innerHTML = currentStatus(); }, () => status.querySelector<HTMLElement>("button"));
  });
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
  const sheet = openSheet(`<h2>Share this set</h2><div class="stack" id="share-body"></div>`);
  const body = sheet.querySelector<HTMLElement>("#share-body")!;
  const render = () => keepFocus(body, () => {
    const url = share ? sharedSetUrl(share.key) : "";
    body.innerHTML = `<p class="muted">Anyone with the link can open this set and go through its songs, with their words, chords and notes, without signing in. They cannot change the songs or control a desktop.</p>
      <div class="stack">
        <h3 class="list-heading" id="share-edit-label">Who can add and remove songs</h3>
        <div class="segmented" role="radiogroup" aria-labelledby="share-edit-label">
          ${[false, true].map((value) => `<button type="button" role="radio" aria-checked="${editable === value}" class="${editable === value ? "on" : ""}" data-editable="${value}">${value ? "Anyone with the link" : "Only leaders"}</button>`).join("")}
        </div>
        <p class="hint">${editable
          ? "People with the link can add songs from your library to this set and remove songs from it, so they can also search and read every song in the library. Nothing else about the set changes through the link."
          : "People with the link can read the set; only leaders change it."}</p>
      </div>
      ${share
        ? `<label>Link<input id="share-url" readonly value="${escapeHtml(url)}" /></label>
          <div class="inline-actions wrap">
            <button type="button" class="button primary" id="share-copy">${icon("copy")}Copy the link</button>
            ${"share" in navigator ? `<button type="button" class="button secondary" id="share-send">${icon("share")}Share</button>` : ""}
          </div>
          <button type="button" class="button secondary danger wide" id="share-stop">${icon("close")}Stop sharing</button>
          <p class="hint">Stopping turns the link off at once for everyone who has it. Sharing again makes a new link.</p>`
        : `<button type="button" class="button primary wide" id="share-create">${icon("link")}Create the link</button>`}
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
        showToast(editable ? "People with the link can now add and remove songs." : "The link now only shows the set.");
      });
    } else if (target.closest("#share-create")) {
      void act(async () => {
        share = await ctx.api.shareSet(set.id, editable);
        onChange(true);
        render();
        showToast("Link created. Copy it or share it.");
      });
    } else if (target.closest("#share-copy") && share) {
      const url = sharedSetUrl(share.key);
      void copyText(url).then((copied) => {
        if (copied) showToast("Link copied.");
        else prompt("Copy the link:", url);
      });
    } else if (target.closest("#share-send") && share) {
      const title = set.service_date ? `${set.name} · ${serviceDate(set.service_date, true)}` : set.name;
      void navigator.share({ title, text: `${title} · ${ctx.session.church_name}`, url: sharedSetUrl(share.key) }).catch(() => undefined);
    } else if (target.closest("#share-stop")) {
      if (!confirm("Stop sharing this set? The link stops working for everyone who has it.")) return;
      void act(async () => {
        await ctx.api.stopSharingSet(set.id);
        share = null;
        onChange(false);
        render();
        showToast("The set is no longer shared.");
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
  items: Array<SetItemInput & { id: string; title: string; subtitle: string }>;
}

export async function setEditor(ctx: AppContext, [setId]: string[]): Promise<void> {
  if (!ctx.canEdit) {
    ctx.navigate(setId ? `#/sets/${setId}` : "#/sets", true);
    return;
  }
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
          // A transpose made elsewhere (the desktop, "Add to a set") is kept,
          // and so is a note; neither is edited here.
          subtitle: item.transpose ? `Transpose ${transposeLabel(item.transpose)}` : "",
        })),
      }
    : { name: "", service_date: nextSunday(), items: [] };

  // "New set…" from a song page starts the set with that song.
  const query = routeQuery();
  const startSong = query.get("song");
  // Only a song id: the value comes from the link and goes into an API path.
  if (!existing && startSong && /^[0-9a-f-]{36}$/i.test(startSong)) {
    const song = await ctx.api.getSong(startSong);
    draft.items.push({
      id: crypto.randomUUID(),
      kind: "song",
      song_id: song.id,
      transpose: Number(query.get("transpose") ?? 0) || 0,
      note: "",
      title: song.title,
      subtitle: Number(query.get("transpose")) ? `Transpose ${transposeLabel(Number(query.get("transpose")))}` : "",
    });
  }

  const back = existing ? `#/sets/${existing.id}` : "#/sets";
  setTitle(existing ? `Edit ${existing.name}` : "New set", "Sets");
  // Back is Cancel; Delete and Save sit in the bar, always in reach.
  ctx.main.innerHTML = `${pageHead({
    title: existing ? "Edit set" : "New set",
    back,
    // On phones the title sits in the bar beside Back.
    compact: true,
    actions: `${existing ? `<button type="button" class="icon-button ghost danger" id="delete-set" aria-label="Delete set" title="Delete set">${icon("trash")}</button>` : ""}
      <button class="button primary small" type="submit" form="set-form" id="save-set">${icon("check")}Save</button>`,
  })}
  <form class="set-form" id="set-form">
    <div class="set-form-row">
      <label>Name<input name="name" required maxlength="200" value="${escapeHtml(draft.name)}" placeholder="Sunday morning" /></label>
      <label>Service date<input name="date" type="date" value="${draft.service_date ?? ""}" /></label>
    </div>
    <div class="list-heading-row"><h2 class="list-heading" id="items-heading">Items</h2>
      <div class="inline-actions">
        <button type="button" class="button secondary small" id="add-blank" aria-label="Add a blank screen">${icon("blank")}Blank</button>
        <button type="button" class="button secondary small" id="add-songs" aria-label="Add songs">${icon("plus")}Songs</button>
      </div>
    </div>
    <ol class="list editable" id="draft-items" aria-labelledby="items-heading"></ol>
    <p class="form-message" role="status"></p>
  </form>`;

  const form = ctx.main.querySelector<HTMLFormElement>("#set-form")!;
  const list = form.querySelector<HTMLOListElement>("#draft-items")!;
  const message = form.querySelector<HTMLElement>(".form-message")!;
  const saveButton = ctx.main.querySelector<HTMLButtonElement>("#save-set")!;

  // Rows carry their item's id (`data-key`), so the button pressed keeps
  // focus when a move or removal redraws the list.
  const renderItems = () => keepFocus(list, () => {
    list.innerHTML = draft.items.length
      ? draft.items.map((item, index) => {
        const name = escapeHtml(`${index + 1}, ${item.title}`);
        return `<li class="edit-row" data-index="${index}" data-key="${item.id}">
        <div class="edit-row-main">
          <span class="grip" data-grip aria-hidden="true" title="Drag to reorder">${icon("grip")}</span>
          <span class="row-main"><strong>${escapeHtml(item.title)}</strong>${item.subtitle ? `<small>${escapeHtml(item.subtitle)}</small>` : ""}</span>
          <div class="row-tools">
            <button type="button" class="icon-button small" data-act="up" aria-label="Move up: ${name}" ${index === 0 ? "disabled" : ""}>${icon("up")}</button>
            <button type="button" class="icon-button small" data-act="down" aria-label="Move down: ${name}" ${index === draft.items.length - 1 ? "disabled" : ""}>${icon("down")}</button>
            <button type="button" class="icon-button small danger" data-act="remove" aria-label="Remove: ${name}">${icon("close")}</button>
          </div>
        </div>
      </li>`;
      }).join("")
      : `<li class="muted pad">No items yet. Add songs, or a blank screen for prayer or a reading.</li>`;
  }, () => {
    // The button is now disabled (the row reached an end): another of the
    // row's buttons. The row went: the next row's, else Add songs.
    const same = Array.from(list.querySelectorAll<HTMLElement>("[data-key]")).find((row) => row.dataset.key === focusKey);
    const rows = list.querySelectorAll<HTMLElement>("[data-index]");
    const near = same ?? rows[Math.min(focusIndex, rows.length - 1)];
    return near?.querySelector<HTMLElement>("button[data-act]:not(:disabled)") ?? form.querySelector<HTMLElement>("#add-songs");
  });
  /** The row of the last button pressed, for `renderItems`' fallback. */
  let focusIndex = 0;
  let focusKey = "";
  renderItems();

  list.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("button[data-act]");
    const row = button?.closest<HTMLElement>("[data-index]");
    if (!button || !row) return;
    const index = Number(row.dataset.index);
    const item = draft.items[index];
    focusIndex = index;
    focusKey = item.id;
    switch (button.dataset.act) {
      case "up":
        draft.items.splice(index - 1, 0, ...draft.items.splice(index, 1));
        announce(`${item.title} moved to ${index} of ${draft.items.length}.`);
        break;
      case "down":
        draft.items.splice(index + 1, 0, ...draft.items.splice(index, 1));
        announce(`${item.title} moved to ${index + 2} of ${draft.items.length}.`);
        break;
      case "remove":
        draft.items.splice(index, 1);
        announce(`${item.title} removed.`);
        break;
    }
    renderItems();
  });
  // With a mouse, drag a row by its grip to reorder. On touch screens the
  // grip is hidden and the arrow buttons reorder, as they do for keyboards.
  list.addEventListener("pointerdown", (event) => {
    if (event.pointerType === "touch") return;
    const grip = (event.target as HTMLElement).closest<HTMLElement>("[data-grip]");
    const row = grip?.closest<HTMLElement>("[data-index]");
    if (!grip || !row) return;
    event.preventDefault();
    const pointer = event.pointerId;
    row.classList.add("dragging");
    const rows = () => [...list.querySelectorAll<HTMLElement>("[data-index]")];
    const move = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== pointer) return;
      const before = rows().find((other) => {
        if (other === row) return false;
        const box = other.getBoundingClientRect();
        return moveEvent.clientY < box.top + box.height / 2;
      });
      if (before) {
        if (row.nextElementSibling !== before) list.insertBefore(row, before);
      } else if (list.lastElementChild !== row) {
        list.append(row);
      }
      if (moveEvent.clientY < 96) window.scrollBy(0, -12);
      else if (moveEvent.clientY > window.innerHeight - 180) window.scrollBy(0, 12);
    };
    const end = (endEvent: PointerEvent) => {
      if (endEvent.pointerId !== pointer) return;
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", end);
      document.removeEventListener("pointercancel", end);
      const order = rows().map((other) => Number(other.dataset.index));
      draft.items = order.map((position) => draft.items[position]);
      renderItems();
    };
    document.addEventListener("pointermove", move);
    document.addEventListener("pointerup", end);
    document.addEventListener("pointercancel", end);
  });
  form.querySelector("#add-blank")?.addEventListener("click", () => {
    draft.items.push({ id: crypto.randomUUID(), kind: "blank", note: "", transpose: 0, title: "Blank screen", subtitle: "" });
    renderItems();
    announce(`Blank screen added as item ${draft.items.length}.`);
  });
  const inDraft = (songId: string) => draft.items.filter((item) => item.song_id === songId).length;
  form.querySelector("#add-songs")?.addEventListener("click", () => openSongPicker((search) => ctx.api.listSongs(search), inDraft, (song) => {
    draft.items.push({
      id: crypto.randomUUID(),
      kind: "song",
      song_id: song.id,
      transpose: 0,
      note: "",
      title: song.title,
      subtitle: "",
    });
    renderItems();
  }));

  ctx.main.querySelector("#delete-set")?.addEventListener("click", () => {
    if (!existing || !confirm(`Delete “${existing.name}” for everyone?`)) return;
    void ctx.run(async () => {
      try {
        await ctx.api.deleteSet(existing.id, existing.version);
      } catch (error) {
        if (error instanceof ApiError && error.status === 409) throw new Error("Someone changed this set. Reload it before deleting.");
        throw error;
      }
      showToast("Set deleted.");
      void ctx.currentSet.refresh().catch(() => undefined);
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
    saveButton.disabled = true;
    try {
      const saved = existing
        ? await ctx.api.updateSet(existing.id, existing.version, input)
        : await ctx.api.createSet(input);
      showToast(existing ? "Set saved." : "Set created.");
      void ctx.currentSet.refresh().catch(() => undefined);
      ctx.navigate(`#/sets/${saved.id}`, true);
    } catch (error) {
      setFormBusy(form, false);
      saveButton.disabled = false;
      if (error instanceof ApiError && error.status === 401) return ctx.signOut();
      if (error instanceof ApiError && error.status === 409) {
        message.innerHTML = `Someone else saved this set while you were editing. <a href="#/sets/${existing?.id}">Open their version</a> and make your change again.`;
        return;
      }
      message.textContent = errorMessage(error);
    }
  });
}

/**
 * Search sheet that adds songs one tap at a time and stays open. `search`
 * reads the library: the church's, or the one a shared link opens.
 */
export function openSongPicker(
  search: (query: string) => Promise<SongSummary[]>,
  inDraft: (songId: string) => number,
  onPick: (song: { id: string; title: string; song_number: string | null }) => void,
): void {
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
      const songs = await search(input.value.trim());
      if (mine !== request) return;
      results.innerHTML = songs.slice(0, 50).map((song) => {
        const added = inDraft(song.id) > 0;
        return `<button class="list-row${added ? " added" : ""}" data-song="${song.id}" data-title="${escapeHtml(song.title)}" data-number="${escapeHtml(song.song_number ?? "")}">
        <span class="row-lead">${escapeHtml(song.song_number ?? "")}</span>
        <span class="row-main"><strong>${escapeHtml(song.title)}</strong><small>${added ? "Already in this set · tap to add again" : escapeHtml(song.authors || "")}</small></span>${icon(added ? "check" : "plus")}
      </button>`;
      }).join("") || `<p class="muted pad">No songs found.</p>`;
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
    onPick({ id: String(row.dataset.song), title: String(row.dataset.title), song_number: row.dataset.number || null });
    row.classList.add("added");
    const small = row.querySelector("small");
    if (small) small.textContent = "Already in this set · tap to add again";
    row.querySelector(".icon")?.replaceWith(document.createRange().createContextualFragment(icon("check")));
    showToast(`Added ${row.dataset.title}${again ? " again" : ""}.`);
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
  // Chords and text size as last set on a song page; no panel here.
  const options = readReaderOptions();
  let wakeLock: { release(): Promise<void> } | null = null;
  const go = (next: number) => ctx.navigate(`#/sets/${set.id}/play/${next}`, true);

  if (!item) {
    ctx.main.innerHTML = `${pageHead({ title: set.name, back: `#/sets/${set.id}` })}${emptyState("This set is empty", "Add songs to the set first.")}`;
    return () => undefined;
  }

  const song = item.kind === "song" && item.song_id ? await loadSong(ctx, songCache, item.song_id) : null;
  setTitle(`${itemTitle(item)} (${index + 1} of ${set.items.length})`, set.name, "Sets");
  // Next and Previous keep focus on themselves; say where they went.
  announce(`${itemTitle(item)}, ${index + 1} of ${set.items.length}`);
  let desktops: RemoteDesktop[] = [];
  let renderedTarget = "";
  /** Who leads this set and how many shared-link pages have it open. */
  let live: SetLive | null = null;
  const leading = () => leadingSet === set.id;

  const render = () => {
    const prev = set.items[index - 1];
    const next = set.items[index + 1];
    const transpose = item.transpose;
    const display = song ? prepareSong(song.chordpro, transpose) : null;
    const target = pickDesktop(desktops);
    renderedTarget = target && ctx.canEdit ? `${target.device_id}:${target.room_name}` : "";
    const key = display ? keyLabel(display, transpose) : "";
    const active = document.activeElement;
    ctx.main.innerHTML = `<div class="play">
      ${pageHead({
        title: itemTitle(item),
        subtitle: `${set.name} · ${index + 1} of ${set.items.length}`,
        back: `#/sets/${set.id}`,
        autohide: true,
        actions: ctx.canEdit ? `<button class="icon-button ghost lead-button" id="lead">${leadButton()}</button>` : "",
      })}
      ${key ? `<p class="page-meta">${escapeHtml(key)}</p>` : ""}
      ${item.note ? `<p class="set-note">${escapeHtml(item.note)}</p>` : ""}
      ${target && ctx.canEdit ? `<button class="button secondary wide" id="project-here">${icon("remote")}Project this on ${escapeHtml(target.room_name)}</button>` : ""}
      ${display ? renderSongBody(display, options) : item.kind === "blank" ? `<div class="blank-slide">Blank screen</div>` : emptyState("This song was deleted", "It is no longer in the library.")}
      ${playNav(prev && itemTitle(prev), next && itemTitle(next))}
    </div>`;

    drawLead();
    // A redraw (a desktop appearing, a reader setting) keeps focus where it was.
    if (active instanceof HTMLElement && active.id && !active.isConnected) ctx.main.querySelector<HTMLElement>(`#${active.id}`)?.focus({ preventScroll: true });
    ctx.main.querySelector("#play-prev")?.addEventListener("click", () => prev && go(index - 1));
    ctx.main.querySelector("#play-next")?.addEventListener("click", () => next && go(index + 1));
    ctx.main.querySelector("#lead")?.addEventListener("click", () => void ctx.run(async () => {
      if (leading()) {
        leadingSet = null;
        drawLead();
        await ctx.api.stopLeadingSet(set.id);
        showToast("You no longer lead this set.");
        return;
      }
      // Pressed at once; let go again if the server refuses.
      leadingSet = set.id;
      drawLead();
      try {
        live = await ctx.api.leadSet(set.id, item.id);
      } catch (error) {
        leadingSet = null;
        drawLead();
        throw error;
      }
      drawLead();
      showToast(!set.shared
        ? "Leading. Share the set on a link so others can follow you."
        : `People with the shared link now follow you${live.viewers ? ` (${live.viewers} watching)` : ""}.`);
    }));
    ctx.main.querySelector("#project-here")?.addEventListener("click", () => void ctx.run(async () => {
      const desktop = pickDesktop(desktops);
      if (!desktop) throw new Error("No desktop accepts remote control right now.");
      await ctx.api.sendRemoteCommand(desktop.device_id, { action: "project_set_item", set_id: set.id, item_index: index });
      showToast(`Sent to ${desktop.room_name}.`);
    }));
  };

  /** The lead button's inside: the icon and, when anyone watches, how many. */
  function leadButton(): string {
    const viewers = live?.viewers ?? 0;
    return `${icon("follow")}${viewers ? `<span class="count-pill" aria-hidden="true">${viewers}</span>` : ""}`;
  }
  /** Redraws the lead button in place, so a count update never moves focus. */
  const drawLead = () => {
    const button = ctx.main.querySelector<HTMLButtonElement>("#lead");
    if (!button) return;
    const viewers = live?.viewers ?? 0;
    const watching = viewers ? `, ${viewers} watching` : "";
    const other = !leading() && live?.leading && live.leader_name ? ` ${live.leader_name} leads it now.` : "";
    button.innerHTML = leadButton();
    button.classList.toggle("on", leading());
    button.setAttribute("aria-pressed", String(leading()));
    button.setAttribute("aria-label", `Lead the shared link${watching}`);
    button.title = `${leading() ? "Leading: people with the shared link follow you" : "Lead: move everyone with the shared link to the song you show"}${watching}.${other}`;
  };

  // Leading: tell the server where this phone is now, and keep telling it
  // (it lets go a minute after the last word). Not leading: read the count.
  const liveTick = async () => {
    try {
      live = leading() ? await ctx.api.leadSet(set.id, item.id) : await ctx.api.getSetLive(set.id);
    } catch {
      return;
    }
    drawLead();
  };

  const poll = async () => {
    try {
      desktops = await ctx.api.listDesktops();
    } catch {
      desktops = [];
    }
    // Re-render only when the "Project this" button changes, so a poll never
    // interrupts a tap or resets the page.
    const target = pickDesktop(desktops);
    if ((target && ctx.canEdit ? `${target.device_id}:${target.room_name}` : "") !== renderedTarget) render();
  };

  // Swipe sideways through the set; the item follows the finger.
  const unbindSwipe = bindItemSwipe(ctx.main, { previous: index > 0, next: index + 1 < set.items.length }, (step) => go(index + step));
  // The neighbours' songs, read now so a swipe to them opens at once.
  for (const neighbour of [set.items[index + 1], set.items[index - 1]]) {
    if (neighbour?.song_id) void loadSong(ctx, songCache, neighbour.song_id).catch(() => undefined);
  }
  const keys = (event: KeyboardEvent) => {
    if ((event.target as HTMLElement).closest("input,textarea")) return;
    if (event.key === "ArrowRight" && index + 1 < set.items.length) go(index + 1);
    if (event.key === "ArrowLeft" && index > 0) go(index - 1);
  };
  document.addEventListener("keydown", keys);

  // Keep the phone awake while reading from it.
  const nav = navigator as Navigator & { wakeLock?: { request(type: "screen"): Promise<{ release(): Promise<void> }> } };
  const lockScreen = () => {
    nav.wakeLock?.request("screen").then((lock) => { wakeLock = lock; }).catch(() => undefined);
  };
  // The browser drops the lock when the page is hidden; take it again.
  const visibility = () => {
    if (document.visibilityState === "visible") lockScreen();
  };
  document.addEventListener("visibilitychange", visibility);
  lockScreen();

  render();
  const poller = startPolling(poll, () => 15000);
  const livePoller = ctx.canEdit ? startPolling(liveTick, () => 5000) : null;

  return () => {
    poller.stop();
    livePoller?.stop();
    unbindSwipe();
    document.removeEventListener("keydown", keys);
    document.removeEventListener("visibilitychange", visibility);
    void wakeLock?.release().catch(() => undefined);
  };
}

/**
 * The set this phone leads, if any. It lasts while the app is open, so going
 * from item to item (each its own screen) keeps leading.
 */
let leadingSet: string | null = null;

/**
 * The step bar at the bottom of a service view: Previous and Next with the
 * title they lead to. At either end of the set its button is left out, and a
 * set of one item has no bar.
 */
export function playNav(previous: string | undefined, next: string | undefined): string {
  if (!previous && !next) return "";
  const step = (id: string, label: string, title: string) => `<button class="play-step${id === "play-next" ? " next" : ""}" id="${id}" aria-label="${label}: ${escapeHtml(title)}">
      ${id === "play-prev" ? icon("back") : ""}<span><small>${label}</small><strong>${escapeHtml(title)}</strong></span>${id === "play-next" ? icon("next") : ""}
    </button>`;
  return `<nav class="play-nav" aria-label="Set navigation">
    ${previous ? step("play-prev", "Previous", previous) : "<span></span>"}
    ${next ? step("play-next", "Next", next) : "<span></span>"}
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
