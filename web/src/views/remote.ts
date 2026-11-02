import { announce, keepFocus, setTitle } from "../../../shared/songs/a11y.ts";
import { ApiError } from "../api.ts";
import { emptyState, pageHead, type AppContext, type Cleanup } from "../context.ts";
import { icon } from "../icons.ts";
import type { RemoteCommandRequest, RemoteDesktop, SetDetail } from "../types.ts";
import { groupSets } from "../current-set.ts";
import { errorMessage, escapeHtml, relativeDate, searchClear, setFormBusy, showFormError, showToast, today, writePreference } from "../ui.ts";
import { closeSheet, openSheet } from "../../../shared/songs/sheet.ts";
import { t, tn } from "../../../shared/songs/i18n.ts";

/**
 * Loads the church's desktops, then keeps `render` up to date as the server
 * pushes changes. Returns the cleanup that stops listening.
 */
async function followDesktops(ctx: AppContext, render: (desktops: RemoteDesktop[]) => void): Promise<Cleanup> {
  const controller = new AbortController();
  render(await ctx.api.listDesktops());
  ctx.api.watchDesktops(render, (error) => {
    if (error.status === 401) ctx.signOut();
    else showToast(errorMessage(error), true);
  }, controller.signal);
  return () => controller.abort();
}

/** Where people follow a desktop's room. */
function joinUrl(roomName: string): string {
  return `${location.origin}/join/${encodeURIComponent(roomName)}`;
}

export async function remoteList(ctx: AppContext): Promise<Cleanup> {
  // Redrawn on every change the server pushes; focus stays on the row it was on.
  return followDesktops(ctx, (desktops) => keepFocus(ctx.main, () => {
    ctx.main.innerHTML = `${pageHead({ title: t("Remote"), church: ctx.session.church_name, compact: true, menu: true })}
    <p class="muted">${t("Steer a projection computer from this phone. Each desktop goes by its room name, which Psalm150 shows at the top of its window.")}</p>
    ${desktops.length
      ? `<ul class="list" aria-label="${t("Desktops")}">${desktops.map((desktop) => `<li><a class="list-row" href="#/remote/${desktop.device_id}">
          <span class="status-dot ${desktop.online ? "online" : ""}" aria-hidden="true"></span>
          <span class="row-main"><strong>${escapeHtml(desktop.room_name)}</strong><small>${desktopSummary(desktop)}</small></span>${icon("next")}
        </a></li>`).join("")}</ul>`
      : emptyState(t("No desktops online"), t("Open Psalm150 on the projection computer and connect it to this song server."))}
    <p class="muted">${t("Anyone can follow the words a desktop projects on their own phone at <strong>{address}</strong>, with the desktop's room name.", { address: `${escapeHtml(location.host)}/join` })}</p>`;
  }));
}

function desktopSummary(desktop: RemoteDesktop): string {
  const computer = escapeHtml(desktop.name);
  if (!desktop.online) return `${computer} · ${t("offline, last seen {when}", { when: relativeDate(desktop.last_seen).toLowerCase() })}`;
  const state = desktop.state;
  const showing = state.song_title ? t("Showing {title}", { title: escapeHtml(state.song_title) }) : t("Showing a song");
  const parts = [computer, t("online"), state.projecting ? (state.blanked ? t("Blank screen") : showing) : t("Not projecting")];
  if (!state.accepts_commands) parts.push(t("remote control off"));
  return parts.join(" · ");
}

export async function remoteDesktop(ctx: AppContext, [deviceId]: string[]): Promise<Cleanup> {
  writePreference("desktop", deviceId);
  let desktop: RemoteDesktop | undefined;
  let sending = false;

  const send = async (command: RemoteCommandRequest, label?: string) => {
    if (sending || !desktop) return;
    sending = true;
    try {
      await ctx.api.sendRemoteCommand(desktop.device_id, command);
      if (label) showToast(label);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) return ctx.signOut();
      showToast(errorMessage(error), true);
    } finally {
      sending = false;
    }
  };

  /** What was on screen at the last drawing, so a change can be told to a screen reader. */
  let shown = "";
  const render = () => {
    if (!desktop) {
      setTitle(t("Desktop not found"), t("Remote"));
      ctx.main.innerHTML = `${pageHead({ title: t("Remote"), back: "#/remote" })}${emptyState(t("Desktop not found"), t("It may have been disconnected from the song server."))}`;
      return;
    }
    setTitle(desktop.room_name, t("Remote"));
    const state = desktop.state;
    const steer = ctx.canEdit && desktop.online && state.accepts_commands;
    const current = state.slide_index ?? -1;
    const words = state.projecting && current >= 0 ? state.slides?.[current]?.lines ?? [] : [];
    const notice = !desktop.online
      ? `<p class="notice">${t("This desktop is offline. Commands can be sent when it is back.")}</p>`
      : !state.accepts_commands
        ? `<p class="notice">${t("Remote control is off on this desktop. Turn on <strong>Allow remote control through the song server</strong> in its Settings, under Church server.")}</p>`
        : !ctx.canEdit
          ? `<p class="notice">${t("You can follow along. Only leaders can steer the projection.")}</p>`
          : "";
    ctx.main.innerHTML = `${pageHead({
      title: desktop.room_name,
      subtitle: `${desktop.name} · ${desktop.online ? t("Online") : t("Offline")}`,
      back: "#/remote",
      actions: ctx.canEdit ? `<button class="icon-button ghost" id="rename-room" aria-label="${t("Rename the room")}" title="${t("Rename the room")}">${icon("edit")}</button>` : "",
    })}
    ${notice}
    <section class="live-card${state.blanked ? " blanked" : ""}" aria-labelledby="live-title">
      <p class="eyebrow">${state.projecting ? (state.blanked ? t("Blank screen") : t("On screen now")) : t("Not projecting")}</p>
      <h2 id="live-title">${escapeHtml(state.song_title ?? t("Nothing projected"))}</h2>
      ${current >= 0 && state.slide_labels[current] ? `<p>${escapeHtml(state.slide_labels[current])} · ${t("{position} of {total}", { position: current + 1, total: state.slide_labels.length })}</p>` : ""}
      ${words.length ? `<div class="live-words">${words.map((line) => `<p>${escapeHtml(line)}</p>`).join("")}</div>` : ""}
    </section>
    <div class="remote-pad">
      <button class="pad-button" data-cmd="previous" ${steer ? "" : "disabled"} aria-label="${t("Previous slide")}">${icon("back")}<span>${t("Previous")}</span></button>
      <button class="pad-button${state.blanked ? " on" : ""}" data-cmd="blank" ${steer ? "" : "disabled"} aria-pressed="${state.blanked}">${icon("blank")}<span>${t("Blank")}</span></button>
      <button class="pad-button primary" data-cmd="next" ${steer ? "" : "disabled"} aria-label="${t("Next slide")}">${icon("next")}<span>${t("Next")}</span></button>
    </div>
    ${state.slide_labels.length ? `<h2 class="list-heading">${t("Slides")}</h2>
      <div class="slide-grid">${state.slide_labels.map((label, index) => `<button class="slide-chip${index === current ? " on" : ""}" data-slide="${index}"${index === current ? ' aria-current="true"' : ""} ${steer ? "" : "disabled"}>${escapeHtml(label || t("Slide {number}", { number: index + 1 }))}</button>`).join("")}</div>` : ""}
    ${steer ? `<h2 class="list-heading">${t("Project")}</h2>
      <div class="inline-actions wrap">
        <button class="button secondary" id="project-set">${icon("sets")}${t("From a set")}</button>
        <button class="button secondary" id="project-song">${icon("search")}${t("A song")}</button>
      </div>` : ""}
    <h2 class="list-heading">${t("Room")}</h2>
    <p class="muted">${state.shares_room
      ? t("Anyone can follow the words on their own phone, as large as they need, at <strong>{address}</strong>.", { address: escapeHtml(joinUrl(desktop.room_name).replace(/^https?:\/\//, "")) })
      : t("This desktop does not share its words in its room. The operator can turn it on in Psalm150's Settings, under Church server.")}</p>
    ${state.shares_room ? `<div class="inline-actions wrap">
      <button class="button secondary" id="copy-room">${icon("copy")}${t("Copy the link")}</button>
      ${"share" in navigator ? `<button class="button secondary" id="share-room">${icon("share")}${t("Share")}</button>` : ""}
    </div>` : ""}`;

    ctx.main.querySelectorAll<HTMLButtonElement>("[data-cmd]").forEach((button) => {
      button.addEventListener("click", () => void send({ action: button.dataset.cmd as RemoteCommandRequest["action"] }));
    });
    ctx.main.querySelectorAll<HTMLButtonElement>("[data-slide]").forEach((button) => {
      button.addEventListener("click", () => void send({ action: "show_slide", slide_index: Number(button.dataset.slide) }));
    });
    ctx.main.querySelector("#project-set")?.addEventListener("click", () => void ctx.run(() => pickFromSet(ctx, send)));
    ctx.main.querySelector("#project-song")?.addEventListener("click", () => pickSong(ctx, send));
    ctx.main.querySelector("#rename-room")?.addEventListener("click", () => {
      if (desktop) renameRoom(ctx, desktop);
    });
    ctx.main.querySelector("#copy-room")?.addEventListener("click", () => void ctx.run(async () => {
      if (!desktop) return;
      await navigator.clipboard.writeText(joinUrl(desktop.room_name));
      showToast(t("Link copied."));
    }));
    ctx.main.querySelector("#share-room")?.addEventListener("click", () => {
      if (!desktop) return;
      void navigator.share({ title: t("Follow the words in {room}", { room: desktop.room_name }), url: joinUrl(desktop.room_name) }).catch(() => undefined);
    });
  };

  /**
   * Redraws with focus kept on the control in use, and tells a screen reader
   * what the desktop shows now when that changed (the card is redrawn, so it
   * cannot be a live region itself).
   */
  const update = () => {
    keepFocus(ctx.main, render);
    const state = desktop?.state;
    const now = !desktop ? "" : !desktop.online ? t("Offline")
      : !state?.projecting ? t("Not projecting")
        : state.blanked ? t("Blank screen")
          : [state.song_title, state.slide_index !== null ? state.slide_labels[state.slide_index] : ""].filter(Boolean).join(", ");
    if (shown && now !== shown) announce(now);
    shown = now;
  };

  let deferred = false;
  return followDesktops(ctx, (desktops) => {
    desktop = desktops.find((entry) => entry.device_id === deviceId);
    // Keep an open sheet (a song search, say) where it is; catch up after.
    const sheet = document.querySelector<HTMLDialogElement>("dialog[open]");
    if (!sheet) return update();
    if (deferred) return;
    deferred = true;
    sheet.addEventListener("close", () => {
      deferred = false;
      if (ctx.main.isConnected) update();
    }, { once: true });
  });
}

function renameRoom(ctx: AppContext, desktop: RemoteDesktop): void {
  const sheet = openSheet(`<h2>${t("Rename the room")}</h2>
    <p class="muted">${t("Leaders pick <strong>{computer}</strong> by this name, and people type it to follow the words. It keeps the name until someone changes it.", { computer: escapeHtml(desktop.name) })}</p>
    <form id="room-form" class="stack">
      <label>${t("Room name")}<input name="room" value="${escapeHtml(desktop.room_name)}" required minlength="2" maxlength="30" autocomplete="off" autocapitalize="words" aria-describedby="room-name-hint" /></label>
      <p class="hint field-hint" id="room-name-hint">${t("2 to 30 characters.")}</p>
      <p class="form-message" role="status"></p>
      <button class="button primary wide" type="submit">${t("Save")}</button>
      <button class="button secondary wide" type="button" id="random-room">${t("Pick another flower")}</button>
    </form>`);
  const form = sheet.querySelector<HTMLFormElement>("#room-form")!;
  const save = async (name: string | null) => {
    setFormBusy(form, true);
    try {
      const room = await ctx.api.renameDesktopRoom(desktop.device_id, name);
      closeSheet(sheet);
      showToast(t("The room is now called {name}.", { name: room.room_name }));
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) return ctx.signOut();
      setFormBusy(form, false);
      showFormError(form, errorMessage(error), name === null ? null : form.querySelector<HTMLInputElement>("input[name=room]"));
    }
  };
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    void save(String(new FormData(form).get("room")).trim());
  });
  sheet.querySelector("#random-room")?.addEventListener("click", () => void save(null));
}

type Send = (command: RemoteCommandRequest, label?: string) => Promise<void>;

async function pickFromSet(ctx: AppContext, send: Send): Promise<void> {
  const { upcoming, undated } = groupSets(await ctx.api.listSets(), today());
  const sets = [...upcoming, ...undated];
  const sheet = openSheet(`<h2>${t("Project from a set")}</h2><div class="list" id="set-choices">
    ${sets.map((set) => `<button class="list-row" data-set="${set.id}"><span class="row-main"><strong>${escapeHtml(set.name)}</strong><small>${tn(set.item_count, "{n} item", "{n} items")}</small></span>${icon("next")}</button>`).join("") || `<p class="muted pad">${t("No upcoming sets.")}</p>`}
  </div>`);
  sheet.querySelector("#set-choices")?.addEventListener("click", (event) => {
    const row = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-set]");
    if (!row) return;
    void ctx.run(async () => {
      const set: SetDetail = await ctx.api.getSet(String(row.dataset.set));
      const list = sheet.querySelector<HTMLElement>("#set-choices")!;
      sheet.querySelector("h2")!.textContent = set.name;
      list.innerHTML = set.items.map((item, index) => `<button class="list-row" data-item="${index}">
        <span class="row-lead">${index + 1}</span>
        <span class="row-main"><strong>${escapeHtml(item.kind === "blank" ? t("Blank screen") : item.song?.title ?? t("Deleted song"))}</strong></span>${icon("play")}
      </button>`).join("") || `<p class="muted pad">${t("This set is empty.")}</p>`;
      list.querySelectorAll<HTMLButtonElement>("[data-item]").forEach((button) => {
        button.addEventListener("click", () => {
          closeSheet(sheet);
          void send({ action: "project_set_item", set_id: set.id, item_index: Number(button.dataset.item) }, t("Sent to the desktop."));
        });
      });
      // The set chosen was replaced by its items: start at the first.
      list.querySelector<HTMLElement>("button")?.focus();
    });
  });
}

function pickSong(ctx: AppContext, send: Send): void {
  const sheet = openSheet(`<h2>${t("Project a song")}</h2>
    <div class="search-field">${icon("search")}<input type="search" id="remote-search" placeholder="${t("Title, number or a line")}" aria-label="${t("Search songs")}" autocomplete="off" enterkeyhint="search" />${searchClear}</div>
    <div class="list" id="remote-results"></div>`);
  const input = sheet.querySelector<HTMLInputElement>("#remote-search")!;
  const results = sheet.querySelector<HTMLElement>("#remote-results")!;
  let timer = 0;
  const load = async () => {
    try {
      const songs = await ctx.api.listSongs(input.value.trim());
      results.innerHTML = songs.slice(0, 50).map((song) => `<button class="list-row" data-song="${song.id}">
        <span class="row-lead">${escapeHtml(song.song_number ?? "")}</span>
        <span class="row-main"><strong>${escapeHtml(song.title)}</strong></span>${icon("play")}
      </button>`).join("") || `<p class="muted pad">${t("No songs found.")}</p>`;
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
    closeSheet(sheet);
    void send({ action: "project_song", song_id: String(row.dataset.song) }, t("Sent to the desktop."));
  });
  void load();
  input.focus();
}
