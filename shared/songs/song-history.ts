/**
 * A song's history: every saved version as a timeline, newest first, each
 * with a short note of what changed (made from the text, song-changes.ts),
 * who saved it and when, drawn as a graph so versions that branch (a
 * translation, say) show as lanes. For the one chosen, the lines that
 * differ (from the version before it, or from the current one), and
 * Restore, which saves that text again as a new version, so nothing is ever
 * lost. The window keeps one size whatever is chosen; the list and the
 * lines scroll inside it.
 *
 * The song server keeps every revision. The web client reads them with its
 * session, the desktop through its device token (`SongHistory`).
 *
 * Both the web client and the desktop use this folder as it is.
 */
import { announce } from "./a11y.ts";
import { daysSince, errorMessage, escapeHtml, relativeDate } from "./format.ts";
import { confirmAction, showToast } from "./host.ts";
import { locale, t, tn } from "./i18n.ts";
import { icon } from "./icon.ts";
import { diffLines, withContext } from "./line-diff.ts";
import { closeSheet, openSheet } from "./sheet.ts";
import { describeChange, revisionGraph, type GraphRow } from "./song-changes.ts";

export interface RevisionSummary {
  id: string;
  parent_revision_id: string | null;
  title: string;
  content_hash: string;
  created_at: string;
  created_by_name?: string | null;
}

export interface SongHistory {
  /** Whether this viewer may restore an earlier version. */
  canRestore: boolean;
  /** Newest first; the first is the current version. */
  list(songId: string): Promise<RevisionSummary[]>;
  /** A revision's ChordPro text. */
  source(songId: string, revisionId: string): Promise<string>;
  /** Saves `chordpro` as a new revision on top of the current one. */
  restore(songId: string, currentRevisionId: string, chordpro: string): Promise<void>;
}

/** What the lines show: what this save changed, or what restoring it would change now. */
type Compare = "change" | "current";

/** Each row of the timeline is this tall, so the graph's lines meet from row to row. */
const ROW_H = 52;
const LANE_W = 14;

const time = (date: Date) => date.toLocaleTimeString(locale(), { hour: "2-digit", minute: "2-digit" });

/** "14:05", "Yesterday 19:47", "3 days ago", "12 Oct". */
const shortWhen = (value: string) => {
  const date = new Date(value);
  const days = daysSince(value);
  if (days <= 0) return time(date);
  if (days === 1) return t("Yesterday {time}", { time: time(date) });
  return relativeDate(value);
};

const fullDate = (value: string) => new Date(value).toLocaleString(locale(), { dateStyle: "long", timeStyle: "short" });

/** Who saved it; a desktop's name without the app's name in front. */
/** Who saved a version: a person, or for a desktop "person · desktop" (without "Psalm150 on "). */
const who = (revision: RevisionSummary) => (revision.created_by_name ?? t("Imported")).replace(/(^|· )Psalm150 on /, "$1");

/** The graph's piece for one row: the lines through it and the version's dot. */
function graphSvg(row: GraphRow, lanes: number, current: boolean): string {
  const x = (lane: number) => 9 + lane * LANE_W;
  const mid = ROW_H / 2;
  const lane = (index: number) => `lane-${index % 4}`;
  const parts: string[] = [];
  for (const index of row.through) parts.push(`<line class="${lane(index)}" x1="${x(index)}" y1="0" x2="${x(index)}" y2="${ROW_H}"/>`);
  for (const index of row.into) {
    parts.push(index === row.lane
      ? `<line class="${lane(index)}" x1="${x(index)}" y1="0" x2="${x(index)}" y2="${mid}"/>`
      : `<path class="${lane(index)}" d="M${x(index)} 0 C${x(index)} ${mid * 0.7} ${x(row.lane)} ${mid * 0.3} ${x(row.lane)} ${mid}"/>`);
  }
  if (row.down) parts.push(`<line class="${lane(row.lane)}" x1="${x(row.lane)}" y1="${mid}" x2="${x(row.lane)}" y2="${ROW_H}"/>`);
  parts.push(`<circle class="${lane(row.lane)}${current ? " now" : ""}" cx="${x(row.lane)}" cy="${mid}" r="${current ? 5.5 : 4.5}"/>`);
  return `<svg class="history-graph" width="${x(lanes - 1) + 9}" height="${ROW_H}" viewBox="0 0 ${x(lanes - 1) + 9} ${ROW_H}" aria-hidden="true">${parts.join("")}</svg>`;
}

/** Opens the history; `restored` hears when an earlier version became current. */
export function openSongHistory(history: SongHistory, song: { id: string; title: string }, restored: () => void): void {
  const sheet = openSheet(`<div class="history-head"><h2>${t("History")}</h2><span class="history-count" hidden></span></div>
    <div class="history" aria-busy="true"><p class="muted">${t("Reading the versions…")}</p></div>`);
  sheet.classList.add("history-sheet");
  sheet.setAttribute("aria-description", song.title);
  const root = sheet.querySelector<HTMLElement>(".history")!;
  const count = sheet.querySelector<HTMLElement>(".history-count")!;
  const sources = new Map<string, Promise<string>>();
  const source = (id: string) => {
    let text = sources.get(id);
    if (!text) {
      text = history.source(song.id, id);
      sources.set(id, text);
      text.catch(() => sources.delete(id));
    }
    return text;
  };
  let revisions: RevisionSummary[] = [];
  /** Each version's note, once its text (and its parent's) is read. */
  const notes = new Map<string, string>();
  let selected = 0;
  let compare: Compare = "change";
  let drawing = 0;

  const parentOf = (index: number) => {
    const parentId = revisions[index]?.parent_revision_id;
    return parentId ? revisions.find((revision) => revision.id === parentId) ?? null : null;
  };

  /**
   * The note for version `index`: a restore says which version it brought
   * back (the same text as an older one); otherwise what changed from the
   * version it was saved on top of.
   */
  const noteFor = async (index: number): Promise<string> => {
    const revision = revisions[index];
    const parent = parentOf(index);
    const older = revisions.slice(index + 1).find((other) => other.content_hash === revision.content_hash && other !== parent);
    if (older && parent && parent.content_hash !== revision.content_hash) return t("Restored {when}", { when: shortWhen(older.created_at) });
    if (!revision.parent_revision_id) return describeChange(null, "");
    if (!parent) return t("Earlier changes");
    return describeChange(await source(parent.id), await source(revision.id));
  };

  const rowHtml = (revision: RevisionSummary, index: number, row: GraphRow, lanes: number) => {
    const note = notes.get(revision.id);
    return `<button type="button" class="history-row${index === selected ? " on" : ""}" role="option" aria-selected="${index === selected}" data-index="${index}" title="${escapeHtml(`${fullDate(revision.created_at)} · ${who(revision)}`)}">
      ${graphSvg(row, lanes, index === 0)}
      <span class="row-main"><strong class="history-note${note ? "" : " pending"}">${escapeHtml(note ?? t("Reading…"))}</strong><small>${escapeHtml(who(revision))} · ${escapeHtml(shortWhen(revision.created_at))}${revision.title !== song.title ? ` · ${escapeHtml(revision.title)}` : ""}</small></span>
      ${index === 0 ? `<span class="history-badge">${t("Current")}</span>` : ""}
    </button>`;
  };

  const drawList = () => {
    const graph = revisionGraph(revisions.map((revision) => ({ id: revision.id, parent: revision.parent_revision_id })));
    root.innerHTML = `<div class="history-list" role="listbox" aria-label="${escapeHtml(t("Versions"))}">${revisions.map((revision, index) => rowHtml(revision, index, graph.rows[index], graph.lanes)).join("")}</div>
      <section class="history-view" aria-label="${escapeHtml(t("The version chosen"))}"></section>`;
  };

  /** Marks the chosen row without redrawing the list, so focus and scroll stay. */
  const markSelected = () => {
    root.querySelectorAll<HTMLElement>(".history-row").forEach((row) => {
      const on = Number(row.dataset.index) === selected;
      row.classList.toggle("on", on);
      row.setAttribute("aria-selected", String(on));
    });
  };

  const drawView = async () => {
    const mine = ++drawing;
    const view = root.querySelector<HTMLElement>(".history-view")!;
    const chosen = revisions[selected];
    const isCurrent = selected === 0;
    const parent = parentOf(selected);
    const mode: Compare = isCurrent ? "change" : compare;
    // The first version has none before it: its whole text shows.
    const other = mode === "current" ? revisions[0] : parent;
    view.innerHTML = `<header class="history-view-head">
        <div class="history-view-title"><strong>${escapeHtml(notes.get(chosen.id) ?? "")}</strong><small>${escapeHtml(who(chosen))} · ${escapeHtml(fullDate(chosen.created_at))}</small></div>
        ${isCurrent ? "" : `<div class="segmented history-compare" role="radiogroup" aria-label="${escapeHtml(t("Show"))}">
          <button type="button" role="radio" aria-checked="${mode === "change"}" class="${mode === "change" ? "on" : ""}" data-compare="change">${t("This change")}</button>
          <button type="button" role="radio" aria-checked="${mode === "current"}" class="${mode === "current" ? "on" : ""}" data-compare="current">${t("Against now")}</button>
        </div>`}
      </header>
      <div class="history-diff" aria-live="polite"><p class="muted">${t("Reading…")}</p></div>
      ${history.canRestore && !isCurrent ? `<footer class="history-actions"><button type="button" class="button primary" data-restore>${icon("sync")}${t("Restore this version")}</button></footer>` : ""}`;
    const diffEl = view.querySelector<HTMLElement>(".history-diff")!;
    try {
      // Restoring makes `chosen` the text: show what changes from `other` to it.
      const [before, after] = await Promise.all([other ? source(other.id) : Promise.resolve(""), source(chosen.id)]);
      if (mine !== drawing) return;
      const lines = other ? withContext(diffLines(before, after)) : diffLines("", after).map((line) => ({ ...line, kind: "same" as const }));
      diffEl.innerHTML = !lines.length
        ? `<p class="muted">${mode === "current" ? t("The same text as now.") : t("The text is the same.")}</p>`
        : `<pre class="history-lines">${lines.map((line) => line.kind === "fold"
          ? `<span class="history-fold">⋯ ${tn(line.count, "{n} unchanged line", "{n} unchanged lines")}</span>`
          : `<span class="history-line ${line.kind}"><span class="history-sign" aria-hidden="true">${line.kind === "added" ? "+" : line.kind === "removed" ? "−" : " "}</span>${line.kind === "added" ? `<span class="sr-only">${t("Added:")} </span>` : line.kind === "removed" ? `<span class="sr-only">${t("Removed:")} </span>` : ""}${escapeHtml(line.text) || " "}</span>`).join("")}</pre>`;
    } catch (error) {
      if (mine === drawing) diffEl.innerHTML = `<p class="form-message">${escapeHtml(errorMessage(error))}</p>`;
    }
  };

  /** Notes come in as the texts are read; each fills its own row (and the view's head). */
  const readNotes = () => {
    revisions.forEach((revision, index) => {
      void noteFor(index).then((note) => {
        notes.set(revision.id, note);
        const row = root.querySelector<HTMLElement>(`.history-row[data-index="${index}"] .history-note`);
        if (row) {
          row.textContent = note;
          row.classList.remove("pending");
        }
        if (index === selected) {
          const head = root.querySelector<HTMLElement>(".history-view-title strong");
          if (head) head.textContent = note;
        }
      }).catch(() => {
        const row = root.querySelector<HTMLElement>(`.history-row[data-index="${index}"] .history-note`);
        if (row) row.textContent = t("Saved");
      });
    });
  };

  const choose = (index: number) => {
    if (index === selected) return;
    selected = index;
    compare = "change";
    markSelected();
    void drawView();
    announce(`${notes.get(revisions[index].id) ?? t("Version")}, ${fullDate(revisions[index].created_at)}`);
  };

  const restore = async () => {
    const chosen = revisions[selected];
    const current = revisions[0];
    if (!chosen || !current || chosen === current) return;
    if (!(await confirmAction(t("Restore the version from {date}? It is saved as a new version; the current one stays in the history.", { date: fullDate(chosen.created_at) })))) return;
    const button = root.querySelector<HTMLButtonElement>("[data-restore]");
    if (button) button.disabled = true;
    try {
      await history.restore(song.id, current.id, await source(chosen.id));
      closeSheet(sheet);
      showToast(t("Restored. The earlier text is now the current version."));
      restored();
    } catch (error) {
      if (button) button.disabled = false;
      showToast(errorMessage(error), true);
    }
  };

  sheet.addEventListener("click", (event) => {
    const target = event.target as HTMLElement;
    const row = target.closest<HTMLElement>("[data-index]");
    if (row) {
      choose(Number(row.dataset.index));
      return;
    }
    const mode = target.closest<HTMLElement>("[data-compare]")?.dataset.compare as Compare | undefined;
    if (mode && mode !== compare) {
      compare = mode;
      void drawView();
      return;
    }
    if (target.closest("[data-restore]")) void restore();
  });
  // ↑/↓ (and Home/End) move through the versions.
  sheet.addEventListener("keydown", (event) => {
    if (!(event.target as HTMLElement).closest(".history-list")) return;
    const moves: Record<string, number> = { ArrowUp: selected - 1, ArrowDown: selected + 1, Home: 0, End: revisions.length - 1 };
    if (!(event.key in moves)) return;
    event.preventDefault();
    const next = Math.max(0, Math.min(revisions.length - 1, moves[event.key]));
    choose(next);
    root.querySelector<HTMLElement>(`[data-index="${next}"]`)?.focus();
  });

  void history.list(song.id).then((list) => {
    revisions = list;
    root.removeAttribute("aria-busy");
    count.hidden = false;
    count.textContent = String(list.length);
    count.setAttribute("aria-label", tn(list.length, "{n} version", "{n} versions"));
    if (!list.length) {
      root.innerHTML = `<p class="muted">${t("No saved versions.")}</p>`;
      return;
    }
    // The newest change is what people come to see.
    selected = 0;
    drawList();
    readNotes();
    void drawView();
  }).catch((error) => {
    root.innerHTML = `<p class="form-message">${escapeHtml(errorMessage(error))}</p>`;
  });
}
