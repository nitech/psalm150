import { announce } from "../../shared/songs/a11y.ts";
import { closeSheet, openSheet } from "../../shared/songs/sheet.ts";
import type { SongServerApi } from "./api.ts";
import type { CurrentSet } from "./current-set.ts";
import type { Follow } from "./follow.ts";
import { icon } from "./icons.ts";
import type { RemoteDesktop, SetDetail, SetLive } from "./types.ts";
import { errorMessage, escapeHtml, readPreference, showToast, writePreference } from "./ui.ts";

/**
 * What this phone does with the projector and the people around it, in one
 * place: the Live card in the dock shows it, and tapping it opens a sheet to
 * change it.
 *
 * - **Follow** the projector: its words fill this screen (follow.ts).
 * - **Lead** a set: everyone with its shared link moves to the item this
 *   phone shows in the set's service view.
 * - **Control** the projector: a desktop projects the item this phone shows
 *   in a set's service view.
 *
 * Following stands alone; leading and controlling go together or apart.
 * Turning one on says what it turns off. Leading and controlling last while
 * the app is open, from screen to screen.
 */
export interface Live {
  /** Redraws the card (the desktops or the current set changed). */
  draw(): void;
  /** The set service view shows this item: leaders and the projector follow. */
  showItem(set: SetDetail, index: number): void;
  /** The service view is closed. */
  leaveSet(set: SetDetail): void;
  leading(setId: string): boolean;
  /** Who leads the set and how many follow, as the server last said. */
  liveInfo(setId: string): SetLive | null;
  /** The desktop under control, if any. */
  readonly controlled: RemoteDesktop | null;
  /** Opens the sheet. */
  open(): void;
  /** Hears every change (the service view redraws its buttons). */
  subscribe(listener: () => void): () => void;
  /** Everything off (signed out). */
  stop(): void;
}

interface Lead {
  set: SetDetail;
  itemId: string | null;
  info: SetLive | null;
}

export function installLive(options: {
  api: SongServerApi;
  follow: Follow;
  currentSet: CurrentSet;
  /** Owners and leaders lead and control; everyone signed in follows. */
  canLead: () => boolean;
  /** The card was shown, hidden or changed (the dock fits around it). */
  cardChanged: () => void;
}): Live {
  const { api, follow, currentSet, canLead, cardChanged } = options;
  let lead: Lead | null = null;
  let controlId: string | null = null;
  /** The set's service view open now, and its item. */
  let shown: { set: SetDetail; index: number } | null = null;
  /** The item last sent to the projector, so a redraw does not send it again. */
  let projected = "";
  let sheet: HTMLDialogElement | null = null;
  let timer = 0;
  const listeners = new Set<() => void>();

  const online = () => follow.desktops.filter((desktop) => desktop.online);
  const steerable = () => online().filter((desktop) => desktop.state.accepts_commands);
  const controlled = (): RemoteDesktop | null => follow.desktops.find((desktop) => desktop.device_id === controlId) ?? null;
  /** The set to lead: the one open in the service view, else the current set. */
  const leadable = (): SetDetail | null => shown?.set ?? currentSet.value;

  const changed = () => {
    draw();
    drawSheet();
    for (const listener of listeners) listener();
  };

  /* ── Leading ─────────────────────────────────────────────────────────── */

  const report = async () => {
    if (!lead) return;
    const current = lead;
    const itemId = current.itemId ?? current.set.items[0]?.id;
    if (!itemId) return;
    try {
      current.info = await api.leadSet(current.set.id, itemId);
    } catch {
      return;
    }
    if (lead === current) changed();
  };

  const startLead = async (set: SetDetail) => {
    follow.off();
    const index = shown?.set.id === set.id ? shown.index : 0;
    const itemId = set.items[index]?.id ?? null;
    if (!itemId) throw new Error("This set is empty.");
    lead = { set, itemId, info: null };
    changed();
    try {
      lead.info = await api.leadSet(set.id, itemId);
      changed();
    } catch (error) {
      lead = null;
      changed();
      throw error;
    }
    window.clearInterval(timer);
    // The server lets go a minute after the last word.
    timer = window.setInterval(() => void report(), 5000);
    announce(set.shared ? `Leading ${set.name}` : `Leading ${set.name}. Share the set on a link so others can follow you.`);
  };

  const stopLead = async () => {
    if (!lead) return;
    const was = lead;
    lead = null;
    window.clearInterval(timer);
    changed();
    await api.stopLeadingSet(was.set.id).catch(() => undefined);
    announce(`No longer leading ${was.set.name}`);
  };

  /* ── Controlling ─────────────────────────────────────────────────────── */

  const project = async (force = false) => {
    const desktop = controlled();
    if (!desktop || !shown) return;
    const key = `${desktop.device_id}:${shown.set.id}:${shown.index}`;
    if (!force && key === projected) return;
    projected = key;
    try {
      await api.sendRemoteCommand(desktop.device_id, { action: "project_set_item", set_id: shown.set.id, item_index: shown.index });
    } catch (error) {
      projected = "";
      showToast(`${desktop.room_name}: ${errorMessage(error)}`, true);
    }
  };

  const startControl = (deviceId: string) => {
    follow.off();
    controlId = deviceId;
    writePreference("desktop", deviceId);
    projected = "";
    changed();
    void project(true);
    announce(`Controlling ${controlled()?.room_name ?? "the projector"}`);
  };

  const stopControl = () => {
    if (!controlId) return;
    const name = controlled()?.room_name ?? "the projector";
    controlId = null;
    projected = "";
    changed();
    announce(`No longer controlling ${name}`);
  };

  /* ── Following ───────────────────────────────────────────────────────── */

  const startFollow = async (deviceId?: string) => {
    const dropping = [lead && `leading ${lead.set.name}`, controlId && `controlling ${controlled()?.room_name ?? "the projector"}`].filter(Boolean);
    if (dropping.length) {
      await stopLead();
      stopControl();
      showToast(`Stopped ${dropping.join(" and ")} to follow the projector.`);
    }
    if (sheet) closeSheet(sheet);
    follow.setOn(true, deviceId);
  };

  /* ── The card ────────────────────────────────────────────────────────── */

  const draw = () => {
    const button = document.querySelector<HTMLButtonElement>("#live-button");
    if (!button) return;
    const desktop = controlled() ?? follow.target;
    const leadSet = lead?.set;
    const active = follow.on || Boolean(lead) || Boolean(controlId);
    const show = active || online().length > 0 || (canLead() && Boolean(leadable()));
    button.hidden = !show;
    cardChanged();
    if (!show) return;
    const state = desktop?.state;
    let label: string;
    let name: string;
    if (follow.on) {
      label = "Following";
      name = follow.target?.room_name ?? "Projector";
    } else if (lead || controlId) {
      label = [lead && "Leading", controlId && (lead ? "controlling" : "Controlling")].filter(Boolean).join(" · ");
      name = [leadSet?.name, controlId && controlled()?.room_name].filter(Boolean).join(" · ");
    } else {
      label = "Live";
      name = !desktop ? "Not projecting" : !state?.projecting ? `${desktop.room_name} · not projecting` : state.blanked ? `${desktop.room_name} · blank` : `${desktop.room_name} · ${state.song_title ?? "projecting"}`;
    }
    const viewers = lead?.info?.viewers ?? 0;
    const onAir = Boolean(lead) || (follow.on && Boolean(state?.projecting && !state.blanked)) || (!active && Boolean(state?.projecting && !state.blanked));
    button.dataset.mode = follow.on ? "follow" : lead ? "lead" : controlId ? "control" : "idle";
    button.setAttribute("aria-label", `${label}: ${name}${viewers ? `, ${viewers} following you` : ""}. Change what this phone does with the projector`);
    button.innerHTML = `<span class="follow-live${onAir ? " live" : ""}" aria-hidden="true"></span>
      <span class="follow-text"><small>${escapeHtml(label)}</small><strong>${escapeHtml(name)}</strong></span>
      ${viewers ? `<span class="count-pill" aria-hidden="true">${viewers}</span>` : ""}
      ${icon("up")}`;
  };

  /* ── The sheet ───────────────────────────────────────────────────────── */

  /** A desktop to pick, by room name; only those online. */
  const desktopChoices = (name: string, list: RemoteDesktop[], chosen: string | null, disabled: boolean) => list.length > 1
    ? `<div class="live-desktops" role="radiogroup" aria-label="Which projector">${list.map((desktop) => `<button type="button" role="radio" class="chip${desktop.device_id === chosen ? " on" : ""}" aria-checked="${desktop.device_id === chosen}" data-${name}="${desktop.device_id}"${disabled ? " disabled" : ""}>${escapeHtml(desktop.room_name)}</button>`).join("")}</div>`
    : "";

  const sheetHtml = (): string => {
    const followTarget = follow.target;
    const followList = online();
    const steer = steerable();
    const steerChoice = controlId ?? readPreference("desktop") ?? steer[0]?.device_id ?? null;
    const set = lead?.set ?? leadable();
    const leadHint = lead
      ? `${lead.info?.viewers ?? 0} following you${lead.set.shared ? "" : ". Share the set on a link so others can follow."}`
      : !set ? "Choose a current set (or open a set) to lead it."
        : set.shared ? "Everyone with the set's shared link moves to the item you show." : "Share the set on a link first, so others can follow you.";
    const controlHint = controlId
      ? `${controlled()?.room_name ?? "The projector"} shows the item you open in a set.`
      : steer.length ? "The projector shows the item you open in a set's service view." : "No projector accepts remote control right now.";
    return `<h2>Live</h2>
      <section class="live-group" aria-labelledby="live-watch">
        <h3 id="live-watch">Watch</h3>
        <button type="button" class="live-row" role="radio" aria-checked="${follow.on}" data-live="follow"${followList.length ? "" : " disabled"}>
          <span class="live-mark" aria-hidden="true">${follow.on ? icon("check") : ""}</span>
          <span class="row-main"><strong>Follow the projector</strong><small>${followList.length ? `The words on ${escapeHtml(followTarget?.room_name ?? "the projector")} fill this screen.` : "No projector is connected."}</small></span>
        </button>
        ${desktopChoices("follow-desktop", followList, followTarget?.device_id ?? null, false)}
      </section>
      ${canLead() ? `<section class="live-group" aria-labelledby="live-lead">
        <h3 id="live-lead">Lead</h3>
        <button type="button" class="live-row" role="switch" aria-checked="${Boolean(lead)}" data-live="lead"${set ? "" : " disabled"}>
          <span class="row-main"><strong>Lead ${escapeHtml(set?.name ?? "a set")}</strong><small>${escapeHtml(leadHint)}</small></span>
          <span class="switch-track" aria-hidden="true"><span class="switch-thumb"></span></span>
        </button>
        <button type="button" class="live-row" role="switch" aria-checked="${Boolean(controlId)}" data-live="control"${steer.length || controlId ? "" : " disabled"}>
          <span class="row-main"><strong>Control the projector</strong><small>${escapeHtml(controlHint)}</small></span>
          <span class="switch-track" aria-hidden="true"><span class="switch-thumb"></span></span>
        </button>
        ${desktopChoices("control-desktop", steer, steerChoice, false)}
        ${controlId ? `<a class="button secondary small live-remote" href="#/remote/${controlId}">${icon("remote")}Open the remote</a>` : ""}
      </section>` : ""}
      ${follow.on || lead || controlId ? `<button type="button" class="button secondary wide" data-live="off">Turn everything off</button>` : ""}`;
  };

  function drawSheet(): void {
    if (!sheet?.open) return;
    const body = sheet.querySelector<HTMLElement>(".live-content");
    if (!body) return;
    const focused = document.activeElement instanceof HTMLElement && body.contains(document.activeElement)
      ? (document.activeElement.dataset.live ? `[data-live="${document.activeElement.dataset.live}"]` : null)
      : null;
    body.innerHTML = sheetHtml();
    if (focused) body.querySelector<HTMLElement>(focused)?.focus();
  }

  const open = () => {
    if (sheet?.open) return;
    sheet = openSheet(`<div class="live-content"></div>`);
    sheet.classList.add("live-sheet");
    drawSheet();
    sheet.addEventListener("click", (event) => {
      const target = event.target as HTMLElement;
      const followDesktop = target.closest<HTMLElement>("[data-follow-desktop]")?.dataset.followDesktop;
      if (followDesktop) return void startFollow(followDesktop);
      const controlDesktop = target.closest<HTMLElement>("[data-control-desktop]")?.dataset.controlDesktop;
      if (controlDesktop) {
        if (controlId) startControl(controlDesktop);
        else {
          writePreference("desktop", controlDesktop);
          drawSheet();
        }
        return;
      }
      const action = target.closest<HTMLElement>("[data-live]")?.dataset.live;
      if (!action) return;
      void (async () => {
        try {
          if (action === "follow") {
            if (follow.on) follow.off();
            else await startFollow();
          } else if (action === "lead") {
            const set = leadable();
            if (lead) await stopLead();
            else if (set) await startLead(set);
          } else if (action === "control") {
            if (controlId) stopControl();
            else {
              const list = steerable();
              const preferred = readPreference("desktop");
              const desktop = list.find((entry) => entry.device_id === preferred) ?? list[0];
              if (desktop) startControl(desktop.device_id);
            }
          } else if (action === "off") {
            follow.off();
            await stopLead();
            stopControl();
            if (sheet) closeSheet(sheet);
          }
        } catch (error) {
          showToast(errorMessage(error), true);
        }
        drawSheet();
      })();
    });
    sheet.addEventListener("close", () => { sheet = null; });
  };

  document.addEventListener("click", (event) => {
    if ((event.target as HTMLElement).closest("#live-button")) open();
  });
  currentSet.subscribe(() => changed());

  return {
    draw: changed,
    showItem(set, index) {
      shown = { set, index };
      if (lead?.set.id === set.id) {
        const itemId = set.items[index]?.id ?? null;
        if (itemId !== lead.itemId) {
          lead.itemId = itemId;
          void report();
        }
      }
      void project();
    },
    leaveSet(set) {
      if (shown?.set.id === set.id) shown = null;
    },
    leading: (setId) => lead?.set.id === setId,
    liveInfo: (setId) => (lead?.set.id === setId ? lead.info : null),
    get controlled() {
      return controlled();
    },
    open,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    stop() {
      follow.off();
      void stopLead();
      controlId = null;
      projected = "";
      changed();
    },
  };
}
