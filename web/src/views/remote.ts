import { ApiError } from "../api.ts";
import { emptyState, pageHead, type AppContext, type Cleanup } from "../context.ts";
import { icon } from "../icons.ts";
import type { RemoteCommandRequest, RemoteDesktop, SetDetail } from "../types.ts";
import { groupSets } from "../current-set.ts";
import { errorMessage, escapeHtml, relativeDate, showToast, startPolling, today, writePreference } from "../ui.ts";
import { closeSheet, openSheet } from "./songs.ts";

const POLL_MS = 2000;

export async function remoteList(ctx: AppContext): Promise<Cleanup> {
  const render = (desktops: RemoteDesktop[]) => {
    ctx.main.innerHTML = `${pageHead({ title: "Remote", subtitle: ctx.session.church_name })}
    <p class="muted">Steer a projection computer from this phone. The desktop must be connected to this song server and allow remote control in its Settings.</p>
    ${desktops.length
      ? `<div class="list">${desktops.map((desktop) => `<a class="list-row" href="#/remote/${desktop.device_id}">
          <span class="status-dot ${desktop.online ? "online" : ""}" aria-hidden="true"></span>
          <span class="row-main"><strong>${escapeHtml(desktop.name)}</strong><small>${desktopSummary(desktop)}</small></span>${icon("next")}
        </a>`).join("")}</div>`
      : emptyState("No desktops online", "Open Psalm150 on the projection computer, connect it to this song server, and turn on remote control.")}`;
  };
  const poll = async () => {
    try {
      render(await ctx.api.listDesktops());
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) return ctx.signOut();
      ctx.main.innerHTML = `${pageHead({ title: "Remote" })}<p class="form-message">${escapeHtml(errorMessage(error))}</p>`;
    }
  };
  const poller = startPolling(poll, () => POLL_MS * 2);
  await poller.first;
  return () => poller.stop();
}

function desktopSummary(desktop: RemoteDesktop): string {
  if (!desktop.online) return `Offline · last seen ${relativeDate(desktop.last_seen).toLowerCase()}`;
  const state = desktop.state;
  const parts = [state.projecting ? (state.blanked ? "Blank screen" : `Showing ${escapeHtml(state.song_title ?? "a song")}`) : "Not projecting"];
  if (!state.accepts_commands) parts.push("remote control off");
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
      // Look again soon so the new slide shows.
      poller.soon(600);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) return ctx.signOut();
      showToast(errorMessage(error), true);
    } finally {
      sending = false;
    }
  };

  const render = () => {
    if (!desktop) {
      ctx.main.innerHTML = `${pageHead({ title: "Remote", back: "#/remote" })}${emptyState("Desktop not found", "It may have been disconnected from the song server.")}`;
      return;
    }
    const state = desktop.state;
    const steer = ctx.canEdit && desktop.online && state.accepts_commands;
    const current = state.slide_index ?? -1;
    const notice = !desktop.online
      ? `<p class="notice">This desktop is offline. Commands can be sent when it is back.</p>`
      : !state.accepts_commands
        ? `<p class="notice">Remote control is off on this desktop. Turn on <strong>Allow remote control through the song server</strong> in its Settings, under Church server.</p>`
        : !ctx.canEdit
          ? `<p class="notice">You can follow along. Only leaders can steer the projection.</p>`
          : "";
    ctx.main.innerHTML = `${pageHead({ title: desktop.name, subtitle: desktop.online ? "Online" : "Offline", back: "#/remote" })}
    ${notice}
    <section class="live-card${state.blanked ? " blanked" : ""}" aria-live="polite">
      <p class="eyebrow">${state.projecting ? (state.blanked ? "Blank screen" : "On screen now") : "Not projecting"}</p>
      <h2>${escapeHtml(state.song_title ?? "Nothing projected")}</h2>
      ${current >= 0 && state.slide_labels[current] ? `<p>${escapeHtml(state.slide_labels[current])} · ${current + 1} of ${state.slide_labels.length}</p>` : ""}
    </section>
    <div class="remote-pad">
      <button class="pad-button" data-cmd="previous" ${steer ? "" : "disabled"} aria-label="Previous slide">${icon("back")}<span>Previous</span></button>
      <button class="pad-button${state.blanked ? " on" : ""}" data-cmd="blank" ${steer ? "" : "disabled"} aria-pressed="${state.blanked}">${icon("blank")}<span>Blank</span></button>
      <button class="pad-button primary" data-cmd="next" ${steer ? "" : "disabled"} aria-label="Next slide">${icon("next")}<span>Next</span></button>
    </div>
    ${state.slide_labels.length ? `<h2 class="list-heading">Slides</h2>
      <div class="slide-grid">${state.slide_labels.map((label, index) => `<button class="slide-chip${index === current ? " on" : ""}" data-slide="${index}" ${steer ? "" : "disabled"}>${escapeHtml(label || `Slide ${index + 1}`)}</button>`).join("")}</div>` : ""}
    ${steer ? `<h2 class="list-heading">Project</h2>
      <div class="inline-actions wrap">
        <button class="button secondary" id="project-set">${icon("sets")}From a set</button>
        <button class="button secondary" id="project-song">${icon("search")}A song</button>
      </div>` : ""}`;

    ctx.main.querySelectorAll<HTMLButtonElement>("[data-cmd]").forEach((button) => {
      button.addEventListener("click", () => void send({ action: button.dataset.cmd as RemoteCommandRequest["action"] }));
    });
    ctx.main.querySelectorAll<HTMLButtonElement>("[data-slide]").forEach((button) => {
      button.addEventListener("click", () => void send({ action: "show_slide", slide_index: Number(button.dataset.slide) }));
    });
    ctx.main.querySelector("#project-set")?.addEventListener("click", () => void ctx.run(() => pickFromSet(ctx, send)));
    ctx.main.querySelector("#project-song")?.addEventListener("click", () => pickSong(ctx, send));
  };

  const poll = async () => {
    try {
      const desktops = await ctx.api.listDesktops();
      desktop = desktops.find((entry) => entry.device_id === deviceId);
      render();
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) return ctx.signOut();
    }
  };
  const poller = startPolling(poll, () => POLL_MS);
  await poller.first;
  return () => poller.stop();
}

type Send = (command: RemoteCommandRequest, label?: string) => Promise<void>;

async function pickFromSet(ctx: AppContext, send: Send): Promise<void> {
  const { upcoming, undated } = groupSets(await ctx.api.listSets(), today());
  const sets = [...upcoming, ...undated];
  const sheet = openSheet(`<h2>Project from a set</h2><div class="list" id="set-choices">
    ${sets.map((set) => `<button class="list-row" data-set="${set.id}"><span class="row-main"><strong>${escapeHtml(set.name)}</strong><small>${set.item_count} items</small></span>${icon("next")}</button>`).join("") || `<p class="muted pad">No upcoming sets.</p>`}
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
        <span class="row-main"><strong>${escapeHtml(item.kind === "blank" ? "Blank screen" : item.song?.title ?? "Deleted song")}</strong></span>${icon("play")}
      </button>`).join("") || `<p class="muted pad">This set is empty.</p>`;
      list.querySelectorAll<HTMLButtonElement>("[data-item]").forEach((button) => {
        button.addEventListener("click", () => {
          closeSheet(sheet);
          void send({ action: "project_set_item", set_id: set.id, item_index: Number(button.dataset.item) }, "Sent to the desktop.");
        });
      });
    });
  });
}

function pickSong(ctx: AppContext, send: Send): void {
  const sheet = openSheet(`<h2>Project a song</h2>
    <div class="search-field">${icon("search")}<input type="search" id="remote-search" placeholder="Title, number or a line" aria-label="Search songs" autocomplete="off" enterkeyhint="search" /></div>
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
    closeSheet(sheet);
    void send({ action: "project_song", song_id: String(row.dataset.song) }, "Sent to the desktop.");
  });
  void load();
  input.focus();
}
