/**
 * A song's history: every saved revision, newest first, who saved it and
 * when; for the one chosen, the lines that differ (from the current version,
 * or from the version before it), and Restore, which saves that text again
 * as a new revision, so nothing is ever lost.
 *
 * The song server keeps every revision. The web client reads them with its
 * session, the desktop through its device token (`SongHistory`).
 *
 * Canonical copy: PSA150-server/shared/songs/. The desktop repo mirrors this
 * folder at src/shared/songs/ with `bun run sync:shared`; edit it here, never
 * in the mirror.
 */
import { announce } from "./a11y.ts";
import { errorMessage, escapeHtml, relativeDate } from "./format.ts";
import { confirmAction, showToast } from "./host.ts";
import { icon } from "./icon.ts";
import { diffLines, withContext } from "./line-diff.ts";
import { closeSheet, openSheet } from "./sheet.ts";

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

type Compare = "current" | "previous";

const when = (value: string) => {
  const date = new Date(value);
  return `${relativeDate(value)}, ${date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}`;
};

const fullDate = (value: string) => new Date(value).toLocaleString(undefined, { dateStyle: "long", timeStyle: "short" });

/** Opens the history; `restored` hears when an earlier version became current. */
export function openSongHistory(history: SongHistory, song: { id: string; title: string }, restored: () => void): void {
  const sheet = openSheet(`<h2>History</h2><p class="muted history-sub">${escapeHtml(song.title)}</p><div class="history" aria-busy="true"><p class="muted">Reading the versions…</p></div>`);
  sheet.classList.add("history-sheet");
  const root = sheet.querySelector<HTMLElement>(".history")!;
  const sub = sheet.querySelector<HTMLElement>(".history-sub")!;
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
  let selected = 0;
  let compare: Compare = "current";
  let drawing = 0;

  const listHtml = () => revisions.map((revision, index) => `<button type="button" class="history-row${index === selected ? " on" : ""}" role="option" aria-selected="${index === selected}" data-index="${index}" title="${escapeHtml(fullDate(revision.created_at))}">
      <span class="row-main"><strong>${escapeHtml(when(revision.created_at))}</strong><small>${escapeHtml(revision.created_by_name ?? "Imported")}${revision.title !== song.title ? ` · ${escapeHtml(revision.title)}` : ""}</small></span>
      ${index === 0 ? `<span class="history-badge">Current</span>` : ""}
    </button>`).join("");

  const draw = async () => {
    const mine = ++drawing;
    const isCurrent = selected === 0;
    const mode: Compare = isCurrent ? "previous" : compare;
    const chosen = revisions[selected];
    const other = mode === "current" ? revisions[0] : revisions[selected + 1];
    root.removeAttribute("aria-busy");
    root.innerHTML = `<div class="history-list" role="listbox" aria-label="Versions">${listHtml()}</div>
      <div class="history-view">
        ${isCurrent ? "" : `<div class="segmented history-compare" role="radiogroup" aria-label="Compare with">
          <button type="button" role="radio" aria-checked="${mode === "current"}" class="${mode === "current" ? "on" : ""}" data-compare="current">Current version</button>
          <button type="button" role="radio" aria-checked="${mode === "previous"}" class="${mode === "previous" ? "on" : ""}" data-compare="previous"${revisions[selected + 1] ? "" : " disabled"}>Version before</button>
        </div>`}
        <p class="history-caption">${mode === "current" ? "What restoring this version would change" : other ? "What this save changed" : "The first version"}</p>
        <div class="history-diff" aria-live="polite"><p class="muted">Reading…</p></div>
        ${history.canRestore && !isCurrent ? `<button type="button" class="button primary wide" data-restore>${icon("sync")}Restore this version</button>` : ""}
      </div>`;
    const diffEl = root.querySelector<HTMLElement>(".history-diff")!;
    try {
      // Restoring makes `chosen` the text: show what changes from `other` to it.
      const [before, after] = await Promise.all([other ? source(other.id) : Promise.resolve(""), source(chosen.id)]);
      if (mine !== drawing) return;
      const lines = other ? withContext(diffLines(before, after)) : diffLines("", after).map((line) => ({ ...line, kind: "same" as const }));
      diffEl.innerHTML = !lines.length
        ? `<p class="muted">The text is the same.</p>`
        : `<pre class="history-lines">${lines.map((line) => line.kind === "fold"
          ? `<span class="history-fold">⋯ ${line.count} unchanged ${line.count === 1 ? "line" : "lines"}</span>`
          : `<span class="history-line ${line.kind}"><span class="history-sign" aria-hidden="true">${line.kind === "added" ? "+" : line.kind === "removed" ? "−" : " "}</span>${line.kind === "added" ? `<span class="sr-only">Added: </span>` : line.kind === "removed" ? `<span class="sr-only">Removed: </span>` : ""}${escapeHtml(line.text) || " "}</span>`).join("")}</pre>`;
    } catch (error) {
      if (mine === drawing) diffEl.innerHTML = `<p class="form-message">${escapeHtml(errorMessage(error))}</p>`;
    }
  };

  const restore = async () => {
    const chosen = revisions[selected];
    const current = revisions[0];
    if (!chosen || !current || chosen === current) return;
    if (!(await confirmAction(`Restore the version from ${fullDate(chosen.created_at)}? It is saved as a new version; the current one stays in the history.`))) return;
    const button = root.querySelector<HTMLButtonElement>("[data-restore]");
    if (button) button.disabled = true;
    try {
      await history.restore(song.id, current.id, await source(chosen.id));
      closeSheet(sheet);
      showToast("Restored. The earlier text is now the current version.");
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
      selected = Number(row.dataset.index);
      void draw().then(() => root.querySelector<HTMLElement>(`[data-index="${selected}"]`)?.focus());
      announce(selected === 0 ? "The current version" : `The version from ${fullDate(revisions[selected].created_at)}`);
      return;
    }
    const mode = target.closest<HTMLElement>("[data-compare]")?.dataset.compare as Compare | undefined;
    if (mode) {
      compare = mode;
      void draw();
      return;
    }
    if (target.closest("[data-restore]")) void restore();
  });
  // ↑/↓ move through the versions.
  sheet.addEventListener("keydown", (event) => {
    if (!(event.target as HTMLElement).closest(".history-list") || !["ArrowUp", "ArrowDown"].includes(event.key)) return;
    event.preventDefault();
    const next = Math.max(0, Math.min(revisions.length - 1, selected + (event.key === "ArrowDown" ? 1 : -1)));
    if (next === selected) return;
    selected = next;
    void draw().then(() => root.querySelector<HTMLElement>(`[data-index="${selected}"]`)?.focus());
  });

  void history.list(song.id).then((list) => {
    revisions = list;
    sub.textContent = `${song.title} · ${list.length} ${list.length === 1 ? "version" : "versions"}`;
    if (!list.length) {
      root.innerHTML = `<p class="muted">No saved versions.</p>`;
      return;
    }
    // The current one alone has nothing to compare; open on the one before it.
    selected = list.length > 1 ? 1 : 0;
    void draw();
  }).catch((error) => {
    root.innerHTML = `<p class="form-message">${escapeHtml(errorMessage(error))}</p>`;
  });
}
