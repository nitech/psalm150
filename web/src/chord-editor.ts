/**
 * The song editor: a visual editor (the default) and the ChordPro source,
 * with a switch between them. Both edit one `SongDoc` (chord-doc.ts).
 *
 * Visual: song details as fields, sections as cards, and each line as
 * plain editable text with its chords as small buttons above it. Tapping a
 * place in the words (or `[` / Ctrl+K while typing) opens a bubble of chords
 * under that letter; a chord is moved by dragging it (or ←/→ when it has
 * focus). ChordPro: the source with colours, a list of problems and a
 * preview, and the same bubble when a place in it is tapped.
 */
import {
  CHORD_PATTERN,
  MAJOR_KEYS,
  MINOR_KEYS,
  NO_TITLE,
  SECTION_TYPES,
  applyEdit,
  autoLabel,
  chordVariants,
  chordsInKey,
  convertPlain,
  diffText,
  findMeta,
  keyDistance,
  metaSource,
  metaValue,
  newId,
  parseChordName,
  parseDoc,
  serializeDoc,
  setMeta,
  sortChords,
  transposeDoc,
  typeName,
  type Chord,
  type Issue,
  type LyricLine,
  type MetaItem,
  type Section,
  type SongDoc,
} from "./chord-doc.ts";
import { icon } from "./icons.ts";
import { prepareSong, renderSongBody } from "./song-render.ts";
import { escapeHtml, showToast } from "./ui.ts";

export interface ChordEditor {
  /** The ChordPro source as it is now. */
  source(): string;
  destroy(): void;
}

type Mode = "visual" | "code";
interface Caret { id: string; off: number }
interface Focus { id?: string; off?: number; sel?: string; scroll?: boolean }
/** Where the chord bubble puts a chord: a place in a line, or a range of the ChordPro (an existing `[chord]`, or an empty range). */
type Bubble =
  | { kind: "line"; lineId: string; pos: number; chordId?: string }
  | { kind: "code"; start: number; end: number; chord?: string };
type MenuItem = { label: string; run: () => void; disabled?: boolean; danger?: boolean } | "rule";

const coarse = matchMedia("(pointer: coarse)").matches;
/** A mouse: chords are placed from boxes above the letters, not by clicking the words. */
const mouse = matchMedia("(hover: hover) and (pointer: fine)").matches;
const editable = (() => {
  const probe = document.createElement("div");
  try { probe.contentEditable = "plaintext-only"; } catch { /* older browsers */ }
  return probe.contentEditable === "plaintext-only" ? "plaintext-only" : "true";
})();
/** Fields with their own control; other details show as read-only text. */
const FIELD_KEYS = ["title", "author", "key", "capo", "number", "song_number", "song_num", "copyright", "ccli", "tempo", "time"];

export function mountChordEditor(root: HTMLElement, initial: string, parts: { modes: HTMLElement }): ChordEditor {
  let doc: SongDoc = parseDoc(initial).doc;
  let mode: Mode = "visual";
  let history: string[] = [];
  let at = -1;
  let historyTimer = 0;
  let pendingFocus: Focus | null = null;
  let lastCaret: Caret | null = null;
  let bubble: Bubble | null = null;
  let keyShift = 0;
  /** A chord just put where the caret is: what is typed next goes after it. */
  let typingAfter: { lineId: string; chordId: string } | null = null;
  const cleanups: Array<() => void> = [];
  const listen = <K extends keyof DocumentEventMap>(target: Document, type: K, handler: (event: DocumentEventMap[K]) => void, options?: AddEventListenerOptions) => {
    target.addEventListener(type, handler, options);
    cleanups.push(() => target.removeEventListener(type, handler, options));
  };

  root.classList.add("ce");
  root.dataset.mode = "visual";
  root.innerHTML = `
    <div class="ce-visual">
      <section class="ce-meta" aria-label="Song details">
        <label class="ce-span">Title<input class="ce-title" data-meta="title" autocomplete="off" placeholder="Song title" /></label>
        <label>Author<input data-meta="author" autocomplete="off" /></label>
        <div class="ce-pair">
          <label>Key<select class="ce-key"></select></label>
          <label>Capo<select data-meta="capo"><option value="">None</option>${Array.from({ length: 11 }, (_, i) => `<option>${i + 1}</option>`).join("")}</select></label>
        </div>
        <div class="ce-key-prompt ce-span" hidden>
          <p></p>
          <button type="button" class="button primary small" data-key="yes">Move chords</button>
          <button type="button" class="button secondary small" data-key="no">Keep chords</button>
        </div>
        <details class="ce-more ce-span">
          <summary>More details</summary>
          <div class="ce-more-grid">
            <label>Number<input data-meta="number" autocomplete="off" inputmode="numeric" /></label>
            <label>CCLI<input data-meta="ccli" autocomplete="off" inputmode="numeric" /></label>
            <label>Tempo<input data-meta="tempo" autocomplete="off" inputmode="numeric" placeholder="BPM" /></label>
            <label>Time<input data-meta="time" autocomplete="off" placeholder="4/4" /></label>
            <label class="ce-span">Copyright<input data-meta="copyright" autocomplete="off" /></label>
          </div>
          <p class="ce-extras" hidden></p>
        </details>
      </section>
      <div class="ce-sections"></div>
      <div class="ce-add">
        <button type="button" class="button secondary small" data-add="verse">${icon("plus")}Verse</button>
        <button type="button" class="button secondary small" data-add="chorus">${icon("plus")}Chorus</button>
        <button type="button" class="button secondary small" data-add-more aria-haspopup="menu">${icon("plus")}Other</button>
      </div>
      <p class="hint ce-hint">${mouse ? "Point at a line and click a box above a letter" : "Tap a place in the words"} to put a chord there, and drag a chord to move it. You can paste a song with chords over the words.</p>
    </div>
    <div class="ce-code" hidden>
      <div class="ce-code-main">
        <div class="ce-code-box"><pre class="ce-hl" aria-hidden="true"></pre><textarea class="ce-src" spellcheck="false" autocapitalize="off" autocomplete="off" aria-label="ChordPro source"></textarea></div>
        <ul class="ce-issues" aria-live="polite"></ul>
        <p class="hint">${mouse ? "Press Ctrl+K to put a chord at the cursor, or click a chord to change it." : "Tap a place to put a chord there."} Chords go in brackets before the syllable, like <code>[G]Amazing [D]grace</code>. Sections use <code>{start_of_chorus}</code> … <code>{end_of_chorus}</code>.</p>
      </div>
      <div class="ce-preview-col">
        <button type="button" class="button secondary small ce-preview-toggle" aria-expanded="false">Show preview</button>
        <div class="ce-preview" hidden></div>
      </div>
    </div>`;

  parts.modes.innerHTML = `<button type="button" data-mode="visual" class="on" aria-pressed="true">Visual</button><button type="button" data-mode="code" aria-pressed="false">ChordPro</button>`;

  const q = <T extends Element = HTMLElement>(selector: string, scope: ParentNode = root) => scope.querySelector<T>(selector)!;
  const sectionsEl = q(".ce-sections");
  const keySelect = q<HTMLSelectElement>(".ce-key");
  const keyPrompt = q(".ce-key-prompt");
  const codeBox = q<HTMLTextAreaElement>(".ce-src");
  const highlightEl = q(".ce-hl");
  const preview = q(".ce-preview");

  const bubbleEl = document.createElement("div");
  bubbleEl.className = "ce-bubble";
  bubbleEl.setAttribute("role", "dialog");
  bubbleEl.hidden = true;
  bubbleEl.innerHTML = `
    <div class="ce-bubble-chords"></div>
    <div class="ce-bubble-more" hidden>
      <div class="ce-bubble-type">
        <input class="ce-bubble-input" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="Chord, like D/F#" aria-label="Chord" enterkeyhint="done" />
        <button type="button" class="button primary small ce-bubble-ok">Put in</button>
      </div>
      <p class="ce-bubble-warn" hidden>That does not look like a chord, but it is saved as you wrote it.</p>
      <div class="ce-bubble-variants"></div>
    </div>`;
  const menuEl = document.createElement("div");
  menuEl.className = "ce-menu";
  menuEl.setAttribute("role", "menu");
  menuEl.hidden = true;
  document.body.append(bubbleEl, menuEl);
  cleanups.push(() => { bubbleEl.remove(); menuEl.remove(); });
  const bubbleInput = q<HTMLInputElement>(".ce-bubble-input", bubbleEl);

  /* ── History ────────────────────────────────────────────────────────── */

  function remember(): void {
    window.clearTimeout(historyTimer);
    historyTimer = 0;
    const snapshot = JSON.stringify(doc);
    if (history[at] === snapshot) return;
    history = history.slice(0, at + 1);
    history.push(snapshot);
    if (history.length > 200) history.shift();
    at = history.length - 1;
  }
  const rememberSoon = () => { window.clearTimeout(historyTimer); historyTimer = window.setTimeout(remember, 600); };
  function undo(): void {
    if (historyTimer) remember();
    if (at <= 0) return;
    at -= 1;
    restore();
  }
  function redo(): void {
    if (at >= history.length - 1) return;
    at += 1;
    restore();
  }
  function restore(): void {
    doc = JSON.parse(history[at]) as SongDoc;
    if (lastCaret && locate(lastCaret.id)) pendingFocus = { ...lastCaret };
    render();
  }
  function commit(): void {
    remember();
    render();
  }
  /** After a reorder, keep a blank line between a section and its neighbours. */
  function spaceSections(): void {
    let previous: SongDoc["items"][number] | null = null;
    for (const item of doc.items) {
      if (previous && item.kind !== "meta" && (item.kind === "section" || previous.kind === "section")) item.blankBefore = Math.max(item.blankBefore ?? 1, 1);
      previous = item;
    }
  }

  /* ── The document ───────────────────────────────────────────────────── */

  function locate(id: string): { section: Section; line: LyricLine | Section["lines"][number]; index: number } | null {
    for (const item of doc.items) {
      if (item.kind !== "section") continue;
      const index = item.lines.findIndex((line) => line.id === id);
      if (index >= 0) return { section: item, line: item.lines[index], index };
    }
    return null;
  }
  function lyric(id: string): { section: Section; line: LyricLine; index: number } | null {
    const found = locate(id);
    return found && found.line.kind === "lyric" ? found as { section: Section; line: LyricLine; index: number } : null;
  }
  const findSection = (id: string) => doc.items.find((item): item is Section => item.kind === "section" && item.id === id)!;
  const emptyLine = (): LyricLine => ({ id: newId(), kind: "lyric", text: "", chords: [] });
  const hasAnyChord = () => doc.items.some((item) => item.kind === "section" && item.lines.some((line) => line.kind === "lyric" && line.chords.length));
  /** The detail a field edits: an existing one of its names, or the first name. */
  const fieldKey = (name: string) => name === "number"
    ? ["number", "song_number", "song_num"].find((key) => findMeta(doc, key)) ?? "number"
    : name === "author" ? ["author", "artist", "composer", "lyricist"].find((key) => findMeta(doc, key)) ?? "author" : name;

  /* ── Measuring text ─────────────────────────────────────────────────── */

  const textNode = (el: Element) => (el.firstChild && el.firstChild.nodeType === Node.TEXT_NODE ? el.firstChild as Text : null);
  /** Where character `off` starts (or, at the end, where the text ends). */
  function charBox(el: HTMLElement, off: number): { x: number; top: number; h: number } {
    const node = textNode(el);
    if (!node || !node.length) {
      const rect = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      const size = parseFloat(style.fontSize);
      const height = size * 1.2;
      return { x: rect.left + parseFloat(style.paddingLeft), top: rect.top + parseFloat(style.paddingTop) + ((parseFloat(style.lineHeight) || size * 1.4) - height) / 2, h: height };
    }
    const end = off >= node.length;
    const range = document.createRange();
    const from = end ? node.length - 1 : Math.max(0, off);
    range.setStart(node, from);
    range.setEnd(node, from + 1);
    const rects = range.getClientRects();
    const rect = rects.length ? rects[end ? rects.length - 1 : 0] : range.getBoundingClientRect();
    return { x: end ? rect.right : rect.left, top: rect.top, h: rect.height };
  }
  /** The character boundary nearest a point. */
  function offsetAt(el: HTMLElement, x: number, y: number): number {
    const length = textNode(el)?.length ?? 0;
    let best = 0;
    let bestDistance = Infinity;
    for (let i = 0; i <= length; i += 1) {
      const box = charBox(el, i);
      const distance = Math.abs(box.x - x) + Math.abs(box.top + box.h / 2 - y) * 4;
      if (distance < bestDistance) {
        bestDistance = distance;
        best = i;
      }
    }
    return best;
  }
  /** The boundary under a point in the space above a row of text, or -1. */
  function chordSpotAt(el: HTMLElement, x: number, y: number): number {
    const off = offsetAt(el, x, y);
    return y < charBox(el, off).top ? off : -1;
  }
  function caretOffset(el: HTMLElement, start = false): number {
    const selection = getSelection();
    if (!selection?.rangeCount) return 0;
    const range = selection.getRangeAt(0);
    if (!el.contains(range.startContainer)) return 0;
    const before = document.createRange();
    before.selectNodeContents(el);
    if (start) before.setEnd(range.startContainer, range.startOffset);
    else before.setEnd(range.endContainer, range.endOffset);
    return before.toString().length;
  }
  function setCaret(el: HTMLElement, off: number): void {
    el.focus({ preventScroll: true });
    const node = textNode(el);
    const range = document.createRange();
    if (node) range.setStart(node, Math.min(off, node.length));
    else range.setStart(el, 0);
    range.collapse(true);
    const selection = getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
  }

  /* ── Visual editor ──────────────────────────────────────────────────── */

  function chipsHtml(line: LyricLine): string {
    return `<span class="ce-ghost" hidden aria-hidden="true"></span>${[...line.chords].sort((a, b) => a.pos - b.pos).map((chord) =>
      `<button type="button" class="ce-chip" data-chord="${chord.id}" aria-label="Chord ${escapeHtml(chord.name)}" aria-describedby="ce-chip-help">${escapeHtml(chord.name)}</button>`).join("")}`;
  }
  function lineHtml(line: Section["lines"][number]): string {
    if (line.kind === "lyric") {
      return `<div class="ce-line" data-line="${line.id}"><div class="ce-text" data-line="${line.id}" contenteditable="${editable}" role="textbox" aria-label="Line" spellcheck="false">${escapeHtml(line.text)}</div><div class="ce-chips">${chipsHtml(line)}</div></div>`;
    }
    if (line.kind === "comment") {
      return `<div class="ce-comment"><span class="ce-tag">Note</span><div class="ce-comment-text" data-line="${line.id}" contenteditable="${editable}" role="textbox" aria-label="Note">${escapeHtml(line.text)}</div></div>`;
    }
    return `<div class="ce-raw" title="Edit this line in ChordPro"><code>${escapeHtml(line.text)}</code></div>`;
  }
  function typeOptions(type: string): string {
    const types = SECTION_TYPES.some(([value]) => value === type) ? SECTION_TYPES : [...SECTION_TYPES, [type, typeName(type)] as [string, string]];
    return types.map(([value, name]) => `<option value="${value}"${value === type ? " selected" : ""}>${name}</option>`).join("");
  }
  function sectionHtml(section: Section, verse: number): string {
    const auto = autoLabel(section, verse);
    const name = escapeHtml(section.label || auto);
    const first = section.lines.find((line) => line.kind === "lyric" && line.text.trim()) as LyricLine | undefined;
    return `<section class="ce-sec" data-item="${section.id}" aria-label="${name}">
      <div class="ce-sec-head">
        <button type="button" class="ce-grip" aria-label="Move ${name}" title="Drag to move">${icon("grip")}</button>
        <span class="ce-type"><select aria-label="Section type">${typeOptions(section.type)}</select></span>
        <input class="ce-label" value="${escapeHtml(section.label)}" placeholder="${escapeHtml(auto)}" aria-label="Section name" autocomplete="off" />
        <span class="ce-peek" aria-hidden="true"><strong>${name}</strong> ${escapeHtml(first?.text.trim() ?? "")}</span>
        <button type="button" class="icon-button ghost small ce-sec-menu" aria-label="More for ${name}" aria-haspopup="menu">${icon("more")}</button>
      </div>
      <div class="ce-sec-body">${section.lines.map(lineHtml).join("")}</div>
    </section>`;
  }
  function render(): void {
    cellsLine = null;
    let verse = 0;
    sectionsEl.innerHTML = doc.items.filter((item) => item.kind !== "meta").map((item) => {
      if (item.kind === "raw") return `<div class="ce-raw" data-item="${item.id}" title="Edit this line in ChordPro"><code>${escapeHtml(item.text)}</code></div>`;
      if (item.kind === "section") {
        if (item.type === "verse" || item.type === "none") verse += 1;
        return sectionHtml(item, verse);
      }
      return "";
    }).join("") + `<p id="ce-chip-help" class="sr-only">Arrow keys move the chord, Delete removes it, Enter changes it.</p>`;
    closeBubble(false);
    renderDetails();
    layoutAll();
    restoreFocus();
  }
  function layoutChips(id: string): void {
    const wrap = sectionsEl.querySelector<HTMLElement>(`.ce-line[data-line="${id}"]`);
    const found = lyric(id);
    if (!wrap || !found) return;
    const text = wrap.firstElementChild as HTMLElement;
    const origin = wrap.getBoundingClientRect();
    const placed = [...wrap.querySelectorAll<HTMLElement>(".ce-chip")].map((chip) => {
      const chord = found.line.chords.find((candidate) => candidate.id === chip.dataset.chord);
      const box = charBox(text, chord?.pos ?? 0);
      return { chip, x: box.x - origin.left, top: box.top - origin.top };
    }).sort((a, b) => a.top - b.top || a.x - b.x);
    // Chords close together are nudged apart so each can be read and tapped.
    let rowTop: number | null = null;
    let right = -Infinity;
    for (const item of placed) {
      if (rowTop === null || Math.abs(item.top - rowTop) > 4) {
        rowTop = item.top;
        right = -Infinity;
      }
      const x = Math.max(item.x, right + 4);
      item.chip.style.left = `${x}px`;
      item.chip.style.top = `${item.top - item.chip.offsetHeight - 1}px`;
      right = x + item.chip.offsetWidth - 7;
    }
  }
  function layoutAll(): void {
    sectionsEl.querySelectorAll<HTMLElement>(".ce-line").forEach((wrap) => layoutChips(wrap.dataset.line!));
  }
  function renderChips(id: string, focusChord?: string, fresh?: string): void {
    const wrap = sectionsEl.querySelector<HTMLElement>(`.ce-line[data-line="${id}"]`);
    const found = lyric(id);
    if (!wrap || !found) return;
    wrap.querySelector(".ce-chips")!.innerHTML = chipsHtml(found.line);
    if (cellsLine === id) cellsLine = null;
    layoutChips(id);
    if (fresh) wrap.querySelector(`.ce-chip[data-chord="${fresh}"]`)?.classList.add("fresh");
    if (focusChord) wrap.querySelector<HTMLElement>(`.ce-chip[data-chord="${focusChord}"]`)?.focus({ preventScroll: true });
  }
  function restoreFocus(): void {
    const focus = pendingFocus;
    pendingFocus = null;
    if (!focus) return;
    if (focus.sel) {
      const el = sectionsEl.querySelector<HTMLElement>(focus.sel);
      el?.focus({ preventScroll: true });
      if (focus.scroll) el?.scrollIntoView({ block: "center", behavior: "smooth" });
      return;
    }
    const el = sectionsEl.querySelector<HTMLElement>(`.ce-text[data-line="${focus.id}"], .ce-comment-text[data-line="${focus.id}"]`);
    if (!el) return;
    setCaret(el, focus.off ?? el.textContent!.length);
    if (focus.scroll) el.scrollIntoView({ block: "center", behavior: "smooth" });
  }

  /* ── Song details ───────────────────────────────────────────────────── */

  function renderDetails(): void {
    root.querySelectorAll<HTMLInputElement | HTMLSelectElement>("[data-meta]").forEach((field) => {
      if (document.activeElement !== field) field.value = metaValue(doc, fieldKey(field.dataset.meta!));
    });
    const key = metaValue(doc, "key");
    const keys = [...MAJOR_KEYS, ...MINOR_KEYS];
    const option = (value: string) => `<option${value === key ? " selected" : ""}>${escapeHtml(value)}</option>`;
    keySelect.innerHTML = `<option value="">Not set</option>${key && !keys.includes(key) ? option(key) : ""}<optgroup label="Major">${MAJOR_KEYS.map(option).join("")}</optgroup><optgroup label="Minor">${MINOR_KEYS.map(option).join("")}</optgroup>`;
    const fieldKeys = new Set(FIELD_KEYS);
    const others = doc.items.filter((item) => item.kind === "meta" && !fieldKeys.has(item.key));
    const extras = q(".ce-extras");
    extras.hidden = !others.length;
    extras.innerHTML = others.length ? `Also in the song: ${others.map((item) => `<code>${escapeHtml(metaSource(item as MetaItem))}</code>`).join(" ")}. Change these in ChordPro.` : "";
  }
  root.querySelectorAll<HTMLInputElement | HTMLSelectElement>("[data-meta]").forEach((field) => {
    field.addEventListener(field.tagName === "SELECT" ? "change" : "input", () => {
      setMeta(doc, fieldKey(field.dataset.meta!), field.value.trim());
      rememberSoon();
    });
  });
  keySelect.addEventListener("change", () => {
    const before = metaValue(doc, "key");
    const after = keySelect.value;
    setMeta(doc, "key", after);
    remember();
    const steps = before && after ? keyDistance(before, after) : null;
    keyShift = steps ?? 0;
    keyPrompt.hidden = !keyShift || !hasAnyChord();
    if (!keyPrompt.hidden) keyPrompt.querySelector("p")!.textContent = `Move the chords from ${before} to ${after} too?`;
  });
  keyPrompt.addEventListener("click", (event) => {
    const choice = (event.target as HTMLElement).closest<HTMLElement>("[data-key]")?.dataset.key;
    if (!choice) return;
    keyPrompt.hidden = true;
    if (choice !== "yes") return;
    transposeDoc(doc, keyShift, false);
    commit();
    showToast(`Moved the chords to ${metaValue(doc, "key")}.`, { action: { label: "Undo", run: undo } });
  });
  // Enter in a field must not save the form.
  root.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && (event.target as HTMLElement).matches("input")) event.preventDefault();
  });

  /* ── Typing in lines ────────────────────────────────────────────────── */

  function onTextInput(el: HTMLElement): void {
    closeBubble(false);
    const found = lyric(el.dataset.line!);
    if (!found) return;
    const text = el.textContent!.replace(/\n/g, " ");
    // Keep one plain text node, so positions can be measured.
    if (el.childNodes.length > 1 || (el.firstChild && el.firstChild.nodeType !== Node.TEXT_NODE) || text !== el.textContent) {
      const off = caretOffset(el);
      el.textContent = text;
      setCaret(el, off);
    }
    if (text === found.line.text) return;
    const edit = diffText(found.line.text, text);
    const held = typingAfter?.lineId === found.line.id ? found.line.chords.find((chord) => chord.id === typingAfter!.chordId) : undefined;
    typingAfter = null;
    applyEdit(found.line, edit.start, edit.end, edit.insert);
    if (cellsLine === found.line.id) hideCells();
    if (held && held.pos === edit.start + edit.insert.length && edit.start === edit.end) held.pos = edit.start;
    layoutChips(found.line.id);
    rememberSoon();
  }
  function splitLine(el: HTMLElement): void {
    const found = lyric(el.dataset.line!)!;
    const a = caretOffset(el, true);
    const b = caretOffset(el);
    const at = Math.min(a, b);
    applyEdit(found.line, at, Math.max(a, b), "");
    const line = found.line;
    const next: LyricLine = { id: newId(), kind: "lyric", text: line.text.slice(at), chords: line.chords.filter((chord) => chord.pos >= at).map((chord) => ({ ...chord, pos: chord.pos - at })) };
    line.chords = line.chords.filter((chord) => chord.pos < at);
    line.text = line.text.slice(0, at);
    found.section.lines.splice(found.index + 1, 0, next);
    pendingFocus = { id: next.id, off: 0 };
    commit();
  }
  function joinWithPrevious(el: HTMLElement): void {
    const found = locate(el.dataset.line!)!;
    const line = found.line as LyricLine;
    const empty = !line.text && !line.chords.length;
    const previous = found.section.lines[found.index - 1];
    if (!previous || previous.kind !== "lyric") {
      if (empty && found.section.lines.length > 1) {
        found.section.lines.splice(found.index, 1);
        const target = previous ?? found.section.lines[0];
        pendingFocus = { id: target.id, off: previous ? undefined : 0 };
        commit();
      }
      return;
    }
    const off = previous.text.length;
    previous.chords.push(...line.chords.map((chord) => ({ ...chord, pos: chord.pos + off })));
    previous.text += line.text;
    found.section.lines.splice(found.index, 1);
    pendingFocus = { id: previous.id, off };
    commit();
  }
  function joinNext(el: HTMLElement): void {
    const found = lyric(el.dataset.line!)!;
    const next = found.section.lines[found.index + 1];
    if (!next || next.kind !== "lyric") return;
    const off = found.line.text.length;
    found.line.chords.push(...next.chords.map((chord) => ({ ...chord, pos: chord.pos + off })));
    found.line.text += next.text;
    found.section.lines.splice(found.index + 1, 1);
    pendingFocus = { id: found.line.id, off };
    commit();
  }
  /** Up and Down cross from line to line; false when the caret stays in its line. */
  function moveVertically(el: HTMLElement, direction: -1 | 1): boolean {
    const length = textNode(el)?.length ?? 0;
    const box = charBox(el, caretOffset(el));
    const row = parseFloat(getComputedStyle(el).lineHeight) || 40;
    if (length) {
      if (direction < 0 && box.top - charBox(el, 0).top > row / 2) return false;
      if (direction > 0 && charBox(el, length).top - box.top > row / 2) return false;
    }
    const all = [...sectionsEl.querySelectorAll<HTMLElement>(".ce-text, .ce-comment-text")];
    const target = all[all.indexOf(el) + direction];
    if (!target) return false;
    const targetLength = textNode(target)?.length ?? 0;
    const y = (direction < 0 ? charBox(target, targetLength).top : charBox(target, 0).top) + 4;
    setCaret(target, offsetAt(target, box.x, y));
    target.closest(".ce-line, .ce-comment")?.scrollIntoView({ block: "nearest" });
    return true;
  }
  function paste(el: HTMLElement, text: string): void {
    const found = lyric(el.dataset.line!)!;
    const line = found.line;
    const a = Math.min(caretOffset(el, true), caretOffset(el));
    const b = Math.max(caretOffset(el, true), caretOffset(el));
    const rows = text.replace(/\r\n?/g, "\n").replace(/\n+$/, "").split("\n");
    if (rows.length === 1 && !text.includes("[")) {
      applyEdit(line, a, b, rows[0]);
      el.textContent = line.text;
      setCaret(el, a + rows[0].length);
      renderChips(line.id);
      remember();
      return;
    }
    const { sections, converted } = convertPlain(text);
    applyEdit(line, a, b, "");
    const replace = !line.text && !line.chords.length;
    if (sections.length === 1 && sections[0].lines.length === 1 && !sections[0].headed) {
      const pasted = sections[0].lines[0];
      applyEdit(line, a, a, pasted.text);
      line.chords.push(...pasted.chords.map((chord) => ({ ...chord, pos: chord.pos + a })));
      sortChords(line);
      pendingFocus = { id: line.id, off: a + pasted.text.length };
    } else if (sections.length) {
      // Text before the first heading goes where the caret is; each heading or blank line starts a new section after this one.
      const inline = sections[0].headed ? [] : sections[0].lines;
      found.section.lines.splice(found.index + (replace ? 0 : 1), replace ? 1 : 0, ...inline);
      const added = sections.slice(sections[0].headed ? 0 : 1).map((part): Section => ({ id: newId(), kind: "section", type: part.type, label: "", lines: part.lines, blankBefore: 1 }));
      // A section left with nothing in it gives way to the pasted ones.
      const emptied = !found.section.lines.some((candidate) => candidate.kind !== "lyric" || candidate.text || candidate.chords.length);
      doc.items.splice(doc.items.indexOf(found.section) + (emptied ? 0 : 1), emptied ? 1 : 0, ...added);
      if (!emptied && !found.section.lines.length) found.section.lines.push(emptyLine());
      const last = (added[added.length - 1]?.lines ?? sections[0].lines).at(-1)!;
      pendingFocus = { id: last.id, scroll: true };
    }
    commit();
    if (converted) showToast(`Placed the chords from ${converted} chord line${converted === 1 ? "" : "s"}.`);
  }

  sectionsEl.addEventListener("beforeinput", (event) => {
    const el = (event.target as HTMLElement).closest<HTMLElement>(".ce-text, .ce-comment-text");
    if (!el) return;
    const isText = el.classList.contains("ce-text");
    if (event.inputType === "insertParagraph" || event.inputType === "insertLineBreak") {
      event.preventDefault();
      if (isText) splitLine(el);
      else moveVertically(el, 1);
    } else if (isText && event.inputType === "insertText" && event.data === "[") {
      event.preventDefault();
      openLineBubble(el.dataset.line!, caretOffset(el), true);
    } else if (event.inputType === "historyUndo") {
      event.preventDefault();
      undo();
    } else if (event.inputType === "historyRedo") {
      event.preventDefault();
      redo();
    }
  });
  sectionsEl.addEventListener("input", (event) => {
    const target = event.target as HTMLElement;
    if (target.classList.contains("ce-text")) onTextInput(target);
    else if (target.classList.contains("ce-comment-text")) {
      const found = locate(target.dataset.line!);
      if (found && found.line.kind === "comment") found.line.text = target.textContent!.replace(/\n/g, " ");
      rememberSoon();
    } else if (target.classList.contains("ce-label")) {
      findSection(target.closest<HTMLElement>(".ce-sec")!.dataset.item!).label = (target as HTMLInputElement).value;
      rememberSoon();
    }
  });
  sectionsEl.addEventListener("change", (event) => {
    const select = event.target as HTMLSelectElement;
    if (!select.closest(".ce-type")) return;
    const id = select.closest<HTMLElement>(".ce-sec")!.dataset.item!;
    findSection(id).type = select.value;
    pendingFocus = { sel: `.ce-sec[data-item="${id}"] .ce-type select` };
    commit();
  });
  sectionsEl.addEventListener("keydown", (event) => {
    const target = event.target as HTMLElement;
    if (target.classList.contains("ce-text")) {
      const off = caretOffset(target);
      const collapsed = getSelection()?.isCollapsed ?? true;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        openLineBubble(target.dataset.line!, off, true);
      } else if (event.key === "Backspace" && collapsed && off === 0) {
        event.preventDefault();
        joinWithPrevious(target);
      } else if (event.key === "Delete" && collapsed && off === (textNode(target)?.length ?? 0)) {
        event.preventDefault();
        joinNext(target);
      } else if ((event.key === "ArrowUp" || event.key === "ArrowDown") && !event.shiftKey) {
        if (moveVertically(target, event.key === "ArrowUp" ? -1 : 1)) event.preventDefault();
      }
    } else if (target.classList.contains("ce-comment-text")) {
      if (event.key === "Backspace" && !target.textContent) {
        event.preventDefault();
        const found = locate(target.dataset.line!)!;
        found.section.lines.splice(found.index, 1);
        if (!found.section.lines.length) found.section.lines.push(emptyLine());
        const near = found.section.lines[Math.max(0, found.index - 1)];
        pendingFocus = { id: near.id };
        commit();
      } else if (event.key === "ArrowUp" || event.key === "ArrowDown") {
        if (moveVertically(target, event.key === "ArrowUp" ? -1 : 1)) event.preventDefault();
      }
    } else if (target.classList.contains("ce-chip")) {
      const wrap = target.closest<HTMLElement>(".ce-line")!;
      const found = lyric(wrap.dataset.line!)!;
      const chord = found.line.chords.find((candidate) => candidate.id === target.dataset.chord)!;
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        event.preventDefault();
        const pos = Math.max(0, Math.min(found.line.text.length, chord.pos + (event.key === "ArrowLeft" ? -1 : 1)));
        if (pos !== chord.pos) {
          chord.pos = pos;
          sortChords(found.line);
          renderChips(found.line.id, chord.id);
          rememberSoon();
        }
      } else if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault();
        removeChord(found.line, chord);
        setCaret(wrap.querySelector<HTMLElement>(".ce-text")!, chord.pos);
      }
    } else if (target.classList.contains("ce-grip") && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
      event.preventDefault();
      moveSection(target.closest<HTMLElement>(".ce-sec")!.dataset.item!, event.key === "ArrowUp" ? -1 : 1, ".ce-grip");
    }
  });

  /* With a mouse, pointing at a line splits the space above it into a box
     per letter (as wide as the letter); clicking a box opens the chord
     bubble there, and clicking the words only edits them. On a touch
     screen, tapping a place in the words opens the bubble. Tapping the
     space above a row does too, without moving the caret (or opening a
     phone's keyboard). */
  let cellsLine: string | null = null;
  function showCells(wrap: HTMLElement): void {
    const id = wrap.dataset.line!;
    if (cellsLine === id) return;
    hideCells();
    cellsLine = id;
    const text = wrap.querySelector<HTMLElement>(".ce-text")!;
    const node = textNode(text);
    const length = node?.length ?? 0;
    const origin = wrap.getBoundingClientRect();
    const range = document.createRange();
    const cells: string[] = [];
    for (let i = 0; i <= length; i += 1) {
      const box = charBox(text, i);
      const top = box.top - origin.top - 23;
      if (i === length) {
        // A place after the last letter, for a chord that ends the line: set apart, so it does not read as a letter.
        cells.push(`<span class="ce-cell end" data-pos="${i}" title="After the line" style="left:${box.x - origin.left + (length ? 6 : 0)}px;top:${top}px">+</span>`);
        continue;
      }
      range.setStart(node!, i);
      range.setEnd(node!, i + 1);
      const width = range.getClientRects()[0]?.width ?? 0;
      if (width < 1) continue;
      cells.push(`<span class="ce-cell" data-pos="${i}" style="left:${box.x - origin.left}px;top:${top}px;width:${width}px"></span>`);
    }
    wrap.querySelector(".ce-chips")!.insertAdjacentHTML("afterbegin", cells.join(""));
  }
  function hideCells(): void {
    sectionsEl.querySelectorAll(".ce-cell").forEach((cell) => cell.remove());
    cellsLine = null;
  }
  sectionsEl.addEventListener("pointermove", (event) => {
    if (event.pointerType !== "mouse" || event.buttons) return;
    const wrap = (event.target as HTMLElement).closest<HTMLElement>(".ce-line");
    if (wrap) showCells(wrap);
    else if (cellsLine) hideCells();
  });
  sectionsEl.addEventListener("pointerleave", hideCells);
  let pointerType = "";
  sectionsEl.addEventListener("pointerdown", (event) => {
    pointerType = event.pointerType;
    const target = event.target as HTMLElement;
    if (target.closest(".ce-cell")) {
      event.preventDefault();
      return;
    }
    const chip = target.closest<HTMLElement>(".ce-chip");
    if (chip || target.closest(".ce-grip")) hideCells();
    if (chip) return dragChord(event, chip);
    const grip = target.closest<HTMLElement>(".ce-grip");
    if (grip) return dragSection(event, grip);
    const wrap = target.closest<HTMLElement>(".ce-line");
    if (wrap && chordSpotAt(wrap.querySelector<HTMLElement>(".ce-text")!, event.clientX, event.clientY) >= 0) event.preventDefault();
  });
  sectionsEl.addEventListener("click", (event) => {
    const target = event.target as HTMLElement;
    const cell = target.closest<HTMLElement>(".ce-cell");
    if (cell) {
      openLineBubble(cell.closest<HTMLElement>(".ce-line")!.dataset.line!, Number(cell.dataset.pos));
      return;
    }
    const chip = target.closest<HTMLElement>(".ce-chip");
    // A pointer opens the bubble on release (dragChord); Enter or Space comes here.
    if (chip) {
      if (event.detail === 0) openLineBubble(chip.closest<HTMLElement>(".ce-line")!.dataset.line!, 0, false, chip.dataset.chord);
      return;
    }
    const wrap = target.closest<HTMLElement>(".ce-line");
    if (wrap && event.detail > 0 && pointerType !== "mouse") {
      const text = wrap.querySelector<HTMLElement>(".ce-text")!;
      // Selecting words (a drag or a double tap) is not a place for a chord.
      const selection = getSelection();
      if (selection && !selection.isCollapsed && text.contains(selection.anchorNode)) return;
      openLineBubble(text.dataset.line!, offsetAt(text, event.clientX, event.clientY));
      return;
    }
    const menuButton = target.closest<HTMLElement>(".ce-sec-menu");
    if (menuButton) openMenu(menuButton, sectionMenu(menuButton.closest<HTMLElement>(".ce-sec")!.dataset.item!));
  });
  sectionsEl.addEventListener("paste", (event) => {
    const el = (event.target as HTMLElement).closest<HTMLElement>(".ce-text, .ce-comment-text");
    if (!el) return;
    event.preventDefault();
    const text = event.clipboardData?.getData("text/plain") ?? "";
    if (!text) return;
    if (el.classList.contains("ce-comment-text")) document.execCommand("insertText", false, text.replace(/\s*\n\s*/g, " "));
    else paste(el, text);
  });
  listen(document, "selectionchange", () => {
    const selection = getSelection();
    const node = selection?.anchorNode;
    const el = node && (node.nodeType === Node.ELEMENT_NODE ? node as Element : node.parentElement)?.closest<HTMLElement>(".ce-text");
    if (el && sectionsEl.contains(el)) lastCaret = { id: el.dataset.line!, off: caretOffset(el) };
    if (typingAfter) {
      const chord = lyric(typingAfter.lineId)?.line.chords.find((candidate) => candidate.id === typingAfter!.chordId);
      if (!el || el.dataset.line !== typingAfter.lineId || chord?.pos !== lastCaret?.off) typingAfter = null;
    }
  });

  /* Dragging a chord along its line. */
  function dragChord(event: PointerEvent, chip: HTMLElement): void {
    if (event.button > 0) return;
    event.preventDefault();
    const wrap = chip.closest<HTMLElement>(".ce-line")!;
    const id = wrap.dataset.line!;
    const text = wrap.querySelector<HTMLElement>(".ce-text")!;
    const found = lyric(id)!;
    const chord = found.line.chords.find((candidate) => candidate.id === chip.dataset.chord)!;
    const start = chord.pos;
    const rect = chip.getBoundingClientRect();
    const box = charBox(text, chord.pos);
    // Aim at the text under the chord, from the point where it was picked up.
    const dy = box.top + box.h / 2 - event.clientY;
    const grabX = event.clientX - rect.left - 7;
    let moved = false;
    chip.setPointerCapture(event.pointerId);
    const move = (next: PointerEvent) => {
      if (!moved && Math.hypot(next.clientX - event.clientX, next.clientY - event.clientY) < 5) return;
      if (!moved) closeBubble(false);
      moved = true;
      chip.classList.add("dragging");
      const off = offsetAt(text, next.clientX - grabX, next.clientY + dy);
      if (off !== chord.pos) {
        chord.pos = off;
        layoutChips(id);
      }
    };
    const end = () => {
      chip.removeEventListener("pointermove", move);
      chip.removeEventListener("pointerup", end);
      chip.removeEventListener("pointercancel", end);
      chip.classList.remove("dragging");
      if (!moved) {
        openLineBubble(id, chord.pos, false, chord.id);
        return;
      }
      if (chord.pos !== start) {
        sortChords(found.line);
        renderChips(id);
        remember();
      }
    };
    chip.addEventListener("pointermove", move);
    chip.addEventListener("pointerup", end);
    chip.addEventListener("pointercancel", end);
  }
  function removeChord(line: LyricLine, chord: Chord): void {
    line.chords = line.chords.filter((candidate) => candidate !== chord);
    remember();
    renderChips(line.id);
    showToast(`Removed ${chord.name}.`, { action: { label: "Undo", run: undo } });
  }

  /* ── Sections ───────────────────────────────────────────────────────── */

  /** Moving a section: every section folds to one row while it is held. */
  function dragSection(event: PointerEvent, grip: HTMLElement): void {
    if (event.button > 0) return;
    event.preventDefault();
    const card = grip.closest<HTMLElement>(".ce-sec")!;
    const before = [...sectionsEl.children].map((child) => (child as HTMLElement).dataset.item).join();
    const startTop = grip.getBoundingClientRect().top;
    (document.activeElement as HTMLElement | null)?.blur?.();
    sectionsEl.classList.add("sorting");
    card.classList.add("lifting");
    // Keep the held section under the finger as the others fold.
    window.scrollBy(0, grip.getBoundingClientRect().top - startTop);
    // On the window, not the grip: moving the card in the page drops pointer capture.
    const move = (next: PointerEvent) => {
      if (next.pointerId !== event.pointerId) return;
      const others = [...sectionsEl.children].filter((child) => child !== card && (child as HTMLElement).dataset.item);
      let target: Element | null = null;
      for (const other of others) {
        const rect = other.getBoundingClientRect();
        if (next.clientY < rect.top + rect.height / 2) {
          target = other;
          break;
        }
      }
      target ??= sectionsEl.querySelector("#ce-chip-help");
      if (target !== card.nextElementSibling && target !== card) sectionsEl.insertBefore(card, target);
      if (next.clientY < 100) window.scrollBy(0, -12);
      else if (next.clientY > innerHeight - 160) window.scrollBy(0, 12);
    };
    const end = (next: PointerEvent) => {
      if (next.pointerId !== event.pointerId) return;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
      card.classList.remove("lifting");
      const order = [...sectionsEl.children].map((child) => (child as HTMLElement).dataset.item).filter(Boolean) as string[];
      const dropTop = card.getBoundingClientRect().top;
      sectionsEl.classList.remove("sorting");
      if (order.join() === before.split(",").filter(Boolean).join()) {
        window.scrollBy(0, card.getBoundingClientRect().top - dropTop);
        layoutAll();
        return;
      }
      const moved = order.map((id) => doc.items.find((item) => item.id === id)!);
      let slot = 0;
      doc.items = doc.items.map((item) => (item.kind === "meta" ? item : moved[slot++]));
      spaceSections();
      commit();
      // Unfolded again: keep the moved section where it was dropped.
      const placed = sectionsEl.querySelector<HTMLElement>(`.ce-sec[data-item="${card.dataset.item}"]`);
      if (placed) window.scrollBy(0, placed.getBoundingClientRect().top - dropTop);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
  }
  function moveSection(id: string, direction: -1 | 1, focus = ".ce-type select"): void {
    const items = doc.items;
    const from = items.findIndex((item) => item.id === id);
    let to = from + direction;
    while (to >= 0 && to < items.length && items[to].kind === "meta") to += direction;
    if (to < 0 || to >= items.length) return;
    [items[from], items[to]] = [items[to], items[from]];
    spaceSections();
    pendingFocus = { sel: `.ce-sec[data-item="${id}"] ${focus}`, scroll: true };
    commit();
  }
  function sectionMenu(id: string): MenuItem[] {
    const section = findSection(id);
    const movable = doc.items.filter((item) => item.kind !== "meta");
    const index = movable.indexOf(section);
    return [
      { label: "Move up", disabled: index === 0, run: () => moveSection(id, -1) },
      { label: "Move down", disabled: index === movable.length - 1, run: () => moveSection(id, 1) },
      {
        label: "Duplicate",
        run: () => {
          const copy = JSON.parse(JSON.stringify(section)) as Section;
          copy.id = newId();
          copy.blankBefore = 1;
          copy.lines.forEach((line) => {
            line.id = newId();
            if (line.kind === "lyric") line.chords.forEach((chord) => { chord.id = newId(); });
          });
          doc.items.splice(doc.items.indexOf(section) + 1, 0, copy);
          pendingFocus = { sel: `.ce-sec[data-item="${copy.id}"] .ce-label`, scroll: true };
          commit();
        },
      },
      {
        label: "Add a note",
        run: () => {
          const note = { id: newId(), kind: "comment" as const, tag: "c", text: "", orig: null };
          section.lines.push(note);
          pendingFocus = { id: note.id };
          commit();
        },
      },
      "rule",
      {
        label: "Delete section",
        danger: true,
        run: () => {
          const name = section.label || typeName(section.type === "none" ? "verse" : section.type);
          doc.items.splice(doc.items.indexOf(section), 1);
          commit();
          showToast(`Deleted ${name}.`, { action: { label: "Undo", run: undo } });
        },
      },
    ];
  }
  function addSection(type: string): void {
    if (historyTimer) remember();
    const section: Section = { id: newId(), kind: "section", type, label: "", lines: [emptyLine()], blankBefore: 1 };
    doc.items.push(section);
    pendingFocus = { id: section.lines[0].id, scroll: true };
    commit();
  }
  root.querySelectorAll<HTMLButtonElement>("[data-add]").forEach((button) => {
    button.addEventListener("click", () => addSection(button.dataset.add!));
  });
  q("[data-add-more]").addEventListener("click", (event) => {
    openMenu(event.currentTarget as HTMLElement, SECTION_TYPES
      .filter(([type]) => !["verse", "chorus", "none"].includes(type))
      .map(([type, name]) => ({ label: name, run: () => addSection(type) })));
  });

  /* ── The chord bubble ───────────────────────────────────────────────── */

  /**
   * Tapping a place in the words (or in the ChordPro) opens a bubble just
   * under that letter, so the word stays in view, with the chords of the
   * key. Tapping one puts it there and closes the bubble. In the visual
   * editor a dashed box shows where the chord goes.
   */
  function openBubble(next: Bubble, typing = false): void {
    closeMenu();
    closeBubble(false);
    bubble = next;
    const key = metaValue(doc, "key");
    const current = bubbleChord();
    const chords = chordsInKey(key || "C");
    q(".ce-bubble-chords", bubbleEl).innerHTML = chords.map((name) => chordButton(name, name === current)).join("")
      + `<button type="button" class="ce-pick ce-bubble-more-toggle" aria-expanded="false" aria-label="Other chord">…</button>`
      + (current ? `<button type="button" class="ce-pick ce-bubble-remove" aria-label="Remove ${escapeHtml(current)}">${icon("trash")}</button>` : "");
    bubbleInput.value = current && !chords.includes(current) ? current : "";
    bubbleEl.setAttribute("aria-label", current ? `Change ${current}` : "Add a chord");
    showMore(typing || Boolean(bubbleInput.value));
    if (next.kind === "line") markLine(true);
    bubbleEl.hidden = false;
    placeBubble();
    if (typing) bubbleInput.focus({ preventScroll: true });
  }
  /** The chord the bubble would change, or "" when it adds one. */
  function bubbleChord(): string {
    const target = bubble;
    if (!target) return "";
    if (target.kind === "code") return target.chord ?? "";
    return lyric(target.lineId)?.line.chords.find((chord) => chord.id === target.chordId)?.name ?? "";
  }
  function showMore(open: boolean): void {
    q(".ce-bubble-more", bubbleEl).hidden = !open;
    bubbleEl.querySelector(".ce-bubble-more-toggle")?.setAttribute("aria-expanded", String(open));
    if (open) fillVariants();
  }
  /** The dashed box where a new chord goes, or the chord being changed. */
  function markLine(on: boolean): void {
    if (!bubble || bubble.kind !== "line") return;
    const wrap = sectionsEl.querySelector<HTMLElement>(`.ce-line[data-line="${bubble.lineId}"]`);
    if (!wrap) return;
    wrap.querySelectorAll(".ce-chip.editing").forEach((chip) => chip.classList.remove("editing"));
    const ghost = wrap.querySelector<HTMLElement>(".ce-ghost")!;
    ghost.hidden = true;
    if (!on) return;
    if (bubble.chordId) {
      wrap.querySelector(`.ce-chip[data-chord="${bubble.chordId}"]`)?.classList.add("editing");
      return;
    }
    const box = charBox(wrap.querySelector<HTMLElement>(".ce-text")!, bubble.pos);
    const origin = wrap.getBoundingClientRect();
    ghost.hidden = false;
    ghost.style.left = `${box.x - origin.left}px`;
    ghost.style.top = `${box.top - origin.top - ghost.offsetHeight - 1}px`;
  }
  /** Where the bubble points: the bottom of the letter at the place. */
  function bubbleAnchor(): { x: number; top: number; bottom: number } | null {
    if (!bubble) return null;
    if (bubble.kind === "code") return codeCaretBox(bubble.start);
    const text = sectionsEl.querySelector<HTMLElement>(`.ce-text[data-line="${bubble.lineId}"]`);
    if (!text) return null;
    const box = charBox(text, bubble.pos);
    return { x: box.x, top: box.top, bottom: box.top + box.h };
  }
  function placeBubble(): void {
    const anchor = bubbleAnchor();
    if (!anchor) return closeBubble(false);
    const viewport = window.visualViewport;
    const viewTop = viewport?.offsetTop ?? 0;
    const viewBottom = viewTop + (viewport?.height ?? innerHeight);
    const width = bubbleEl.offsetWidth;
    const height = bubbleEl.offsetHeight;
    const left = Math.min(Math.max(8, anchor.x - 28), innerWidth - width - 8);
    // Under the letter; above the line only when there is no room below (a phone's keyboard).
    const below = anchor.bottom + 10 + height <= viewBottom - 8 || anchor.top - 10 - height < viewTop + 8;
    const top = below ? anchor.bottom + 10 : anchor.top - 10 - height;
    bubbleEl.classList.toggle("above", !below);
    bubbleEl.style.left = `${left + scrollX}px`;
    bubbleEl.style.top = `${top + scrollY}px`;
    bubbleEl.style.setProperty("--arrow", `${Math.min(Math.max(14, anchor.x - left), width - 14)}px`);
  }
  function closeBubble(refocus: boolean): void {
    if (!bubble) return;
    const was = bubble;
    markLine(false);
    bubble = null;
    bubbleEl.hidden = true;
    if (!refocus) return;
    if (was.kind === "code") codeBox.focus({ preventScroll: true });
    else {
      const text = sectionsEl.querySelector<HTMLElement>(`.ce-text[data-line="${was.lineId}"]`);
      if (text) setCaret(text, was.pos);
    }
  }
  const chordButton = (name: string, on = false) => `<button type="button" class="ce-pick${on ? " on" : ""}" data-pick="${escapeHtml(name)}">${escapeHtml(name)}</button>`;
  function fillVariants(): void {
    const typed = parseChordName(bubbleInput.value) ?? parseChordName(bubbleChord());
    const key = metaValue(doc, "key");
    const root = typed?.root ?? parseChordName(key)?.root ?? "C";
    q(".ce-bubble-variants", bubbleEl).innerHTML = chordVariants(root, key).map((name) => chordButton(name)).join("");
    const value = bubbleInput.value.trim();
    q(".ce-bubble-warn", bubbleEl).hidden = !value || CHORD_PATTERN.test(value);
  }
  function placeChord(lineId: string, pos: number, name: string, chordId?: string): string {
    const line = lyric(lineId)!.line;
    const existing = chordId ? line.chords.find((chord) => chord.id === chordId) : line.chords.find((chord) => chord.pos === pos);
    if (existing) {
      existing.name = name;
      return existing.id;
    }
    const id = newId();
    line.chords.push({ id, pos, name });
    sortChords(line);
    return id;
  }
  /** Puts the chosen chord in, or takes the chord out when `name` is empty. */
  function choose(name: string): void {
    const target = bubble;
    if (!target) return;
    const value = name.trim();
    if (target.kind === "code") {
      closeBubble(false);
      if (!value && target.end === target.start) return;
      codeBox.focus({ preventScroll: true });
      codeBox.setSelectionRange(target.start, target.end);
      const insert = value ? `[${value}]` : "";
      if (!document.execCommand("insertText", false, insert)) codeBox.setRangeText(insert, target.start, target.end, "end");
      refreshCode();
      return;
    }
    const text = sectionsEl.querySelector<HTMLElement>(`.ce-text[data-line="${target.lineId}"]`);
    const typing = text !== null && document.activeElement === text;
    closeBubble(false);
    if (!value) {
      const found = lyric(target.lineId);
      const chord = found?.line.chords.find((candidate) => candidate.id === target.chordId);
      if (found && chord) removeChord(found.line, chord);
      return;
    }
    const id = placeChord(target.lineId, target.pos, value, target.chordId);
    remember();
    renderChips(target.lineId, undefined, id);
    // Typing goes on after the new chord, at the place it was put.
    if (typing && text && !target.chordId) {
      setCaret(text, target.pos);
      typingAfter = { lineId: target.lineId, chordId: id };
    }
  }
  /** Opens the bubble at a place in a line; a chord already there is changed. */
  function openLineBubble(lineId: string, pos: number, typing = false, chordId?: string): void {
    const line = lyric(lineId)?.line;
    if (!line) return;
    const chord = chordId ? line.chords.find((candidate) => candidate.id === chordId) : line.chords.find((candidate) => candidate.pos === pos);
    openBubble({ kind: "line", lineId, pos: chord?.pos ?? pos, chordId: chord?.id }, typing);
  }
  // Pressing a button in the bubble must not take focus from the words, or the caret (and a phone's keyboard) is lost.
  bubbleEl.addEventListener("pointerdown", (event) => {
    if ((event.target as HTMLElement).closest("button")) event.preventDefault();
  });
  bubbleEl.addEventListener("click", (event) => {
    const target = event.target as HTMLElement;
    const pick = target.closest<HTMLElement>("[data-pick]");
    if (pick) choose(pick.dataset.pick!);
    else if (target.closest(".ce-bubble-ok")) choose(bubbleInput.value);
    else if (target.closest(".ce-bubble-remove")) choose("");
    else if (target.closest(".ce-bubble-more-toggle")) {
      const open = q(".ce-bubble-more", bubbleEl).hidden;
      showMore(open);
      placeBubble();
      if (open) bubbleInput.focus({ preventScroll: true });
    }
  });
  bubbleInput.addEventListener("input", fillVariants);
  bubbleInput.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    const target = bubble;
    choose(bubbleInput.value);
    if (target?.kind === "line") {
      const text = sectionsEl.querySelector<HTMLElement>(`.ce-text[data-line="${target.lineId}"]`);
      if (text && document.activeElement !== text) setCaret(text, target.pos);
    }
  });
  const reposition = () => { if (bubble) placeBubble(); };
  window.visualViewport?.addEventListener("resize", reposition);
  window.addEventListener("resize", reposition);
  cleanups.push(() => {
    window.visualViewport?.removeEventListener("resize", reposition);
    window.removeEventListener("resize", reposition);
  });

  /* ── Menus ──────────────────────────────────────────────────────────── */

  let menuItems: MenuItem[] = [];
  let menuOpener: HTMLElement | null = null;
  function openMenu(opener: HTMLElement, items: MenuItem[]): void {
    closeBubble(false);
    menuItems = items;
    menuOpener = opener;
    menuEl.innerHTML = items.map((item, index) => item === "rule"
      ? "<hr />"
      : `<button type="button" role="menuitem" data-index="${index}"${item.disabled ? " disabled" : ""}${item.danger ? ' class="danger"' : ""}>${escapeHtml(item.label)}</button>`).join("");
    menuEl.hidden = false;
    const rect = opener.getBoundingClientRect();
    const width = menuEl.offsetWidth;
    const height = menuEl.offsetHeight;
    const top = rect.bottom + 6 + height > innerHeight - 90 ? rect.top - height - 6 : rect.bottom + 6;
    menuEl.style.left = `${Math.min(Math.max(16, rect.right - width), innerWidth - width - 16) + scrollX}px`;
    menuEl.style.top = `${top + scrollY}px`;
    opener.setAttribute("aria-expanded", "true");
    menuEl.querySelector<HTMLElement>("button:not(:disabled)")?.focus();
  }
  function closeMenu(refocus = false): void {
    if (menuEl.hidden) return;
    menuEl.hidden = true;
    menuOpener?.setAttribute("aria-expanded", "false");
    if (refocus) menuOpener?.focus();
  }
  menuEl.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLElement>("button[data-index]");
    if (!button) return;
    const item = menuItems[Number(button.dataset.index)];
    closeMenu();
    if (item !== "rule") item.run();
  });
  menuEl.addEventListener("keydown", (event) => {
    const buttons = [...menuEl.querySelectorAll<HTMLElement>("button:not(:disabled)")];
    const index = buttons.indexOf(document.activeElement as HTMLElement);
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      buttons[(index + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length].focus();
    } else if (event.key === "Tab") closeMenu();
  });
  listen(document, "pointerdown", (event) => {
    const target = event.target as HTMLElement;
    if (!menuEl.hidden && !menuEl.contains(target) && target.closest("[aria-haspopup]") !== menuOpener) closeMenu();
    // A tap elsewhere closes the bubble; a tap in the words opens it again there.
    if (bubble && !bubbleEl.contains(target)) closeBubble(false);
  }, { capture: true });
  listen(document, "keydown", (event) => {
    if (event.key === "Escape") {
      if (bubble) {
        event.preventDefault();
        event.stopPropagation();
        closeBubble(true);
      } else if (!menuEl.hidden) {
        event.preventDefault();
        closeMenu(true);
      }
      return;
    }
    const mod = event.ctrlKey || event.metaKey;
    if (mode !== "visual" || !mod || event.target === bubbleInput) return;
    const key = event.key.toLowerCase();
    if (key === "z") {
      event.preventDefault();
      if (event.shiftKey) redo();
      else undo();
    } else if (key === "y") {
      event.preventDefault();
      redo();
    }
  });

  /* ── ChordPro source ────────────────────────────────────────────────── */

  function highlight(source: string, problems: Set<number>): string {
    return `${source.split("\n").map((line, index) => {
      const trimmed = line.trim();
      let html: string;
      if (trimmed.startsWith("#")) html = `<span class="h-note">${escapeHtml(line)}</span>`;
      else if (/^\s*\{.*\}\s*$/.test(line)) {
        html = escapeHtml(line).replace(/^(\s*\{)(\s*[A-Za-z_][\w-]*)(.*?)(\}\s*)$/, (_, open: string, name: string, value: string, close: string) =>
          `<span class="h-mark">${open}</span><span class="h-dir${/^\s*(start_of_|end_of_|so[a-z]$|eo[a-z]$)/i.test(name) ? " h-section" : ""}">${name}</span>${value}<span class="h-mark">${close}</span>`);
      } else html = escapeHtml(line).replace(/\[([^[\]]*)\]/g, '<span class="h-chord"><span class="h-mark">[</span>$1<span class="h-mark">]</span></span>');
      return `<span class="h-line${problems.has(index + 1) ? " h-problem" : ""}" data-n="${index + 1}">${html}</span>`;
    }).join("\n")} `;
  }
  let codeTimer = 0;
  function refreshCode(): void {
    const { issues } = parseDoc(codeBox.value);
    const real = issues.filter((issue) => issue.message !== NO_TITLE);
    highlightEl.innerHTML = highlight(codeBox.value, new Set(real.map((issue) => issue.line)));
    window.clearTimeout(codeTimer);
    codeTimer = window.setTimeout(() => {
      q(".ce-issues").innerHTML = issues.map((issue: Issue) => `<li><button type="button" data-goto="${issue.line}">Line ${issue.line}</button>${escapeHtml(issue.message)}</li>`).join("");
      if (!preview.hidden) preview.innerHTML = renderSongBody(prepareSong(codeBox.value, 0), { chords: true });
    }, 150);
  }
  codeBox.addEventListener("input", () => {
    closeBubble(false);
    refreshCode();
  });
  /** The letter at `index` in the source, measured in the coloured copy under the textarea. */
  function codeCaretBox(index: number): { x: number; top: number; bottom: number } | null {
    const walker = document.createTreeWalker(highlightEl, NodeFilter.SHOW_TEXT);
    let seen = 0;
    let last: Text | null = null;
    for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
      if (index < seen + node.length) {
        const off = index - seen;
        const range = document.createRange();
        if (node.data[off] !== "\n") {
          range.setStart(node, off);
          range.setEnd(node, off + 1);
          const rect = range.getClientRects()[0];
          if (rect) return { x: rect.left, top: rect.top, bottom: rect.bottom };
        }
        // At the end of a line: after its last letter, or at the start of an empty line.
        if (off > 0 && node.data[off - 1] !== "\n") {
          range.setStart(node, off - 1);
          range.setEnd(node, off);
          const rect = range.getClientRects()[0];
          if (rect) return { x: rect.right, top: rect.top, bottom: rect.bottom };
        }
        break;
      }
      seen += node.length;
      last = node;
    }
    const lineNumber = codeBox.value.slice(0, index).split("\n").length;
    const row = highlightEl.querySelector(`[data-n="${lineNumber}"]`)?.getBoundingClientRect() ?? last?.parentElement?.getBoundingClientRect();
    return row ? { x: row.left, top: row.top, bottom: row.bottom } : null;
  }
  /** Opens the bubble at a place in the source; inside a `[chord]` it changes that chord. Not in directives or `#` lines. */
  function openCodeBubble(index: number, typing = false, onlyOnChord = false): void {
    const value = codeBox.value;
    const lineStart = value.lastIndexOf("\n", index - 1) + 1;
    const lineEnd = value.indexOf("\n", index) < 0 ? value.length : value.indexOf("\n", index);
    const line = value.slice(lineStart, lineEnd);
    if (/^\s*[{#]/.test(line)) return closeBubble(false);
    const col = index - lineStart;
    const open = line.lastIndexOf("[", col);
    const close = line.indexOf("]", open);
    if (open >= 0 && close > open && col > open && col <= close && !line.slice(open + 1, close).includes("[")) {
      openBubble({ kind: "code", start: lineStart + open, end: lineStart + close + 1, chord: line.slice(open + 1, close).trim() }, typing);
    } else if (onlyOnChord) closeBubble(false);
    else openBubble({ kind: "code", start: index, end: index }, typing);
  }
  let codePointer = "";
  codeBox.addEventListener("pointerdown", (event) => { codePointer = event.pointerType; });
  codeBox.addEventListener("click", () => {
    // A mouse click opens the bubble only on a chord; Ctrl+K puts one at the cursor.
    if (codeBox.selectionStart === codeBox.selectionEnd) openCodeBubble(codeBox.selectionStart, false, codePointer === "mouse");
  });
  codeBox.addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      openCodeBubble(codeBox.selectionStart, true);
    }
  });
  q(".ce-issues").addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLElement>("[data-goto]");
    if (button) selectCodeLine(Number(button.dataset.goto), 0, true);
  });
  const previewToggle = q<HTMLButtonElement>(".ce-preview-toggle");
  const wide = matchMedia("(min-width: 1100px)");
  function showPreview(open: boolean): void {
    preview.hidden = !open;
    previewToggle.setAttribute("aria-expanded", String(open));
    previewToggle.textContent = open ? "Hide preview" : "Show preview";
    if (open) preview.innerHTML = renderSongBody(prepareSong(codeBox.value, 0), { chords: true });
  }
  previewToggle.addEventListener("click", () => showPreview(preview.hidden));
  const onWide = () => { if (mode === "code") showPreview(wide.matches); };
  wide.addEventListener("change", onWide);
  cleanups.push(() => wide.removeEventListener("change", onWide));
  function selectCodeLine(line: number, column: number, focus: boolean): void {
    const rows = codeBox.value.split("\n");
    let index = 0;
    for (let i = 0; i < line - 1 && i < rows.length; i += 1) index += rows[i].length + 1;
    index += Math.min(column, (rows[line - 1] ?? "").length);
    if (focus || !coarse) codeBox.focus({ preventScroll: true });
    codeBox.setSelectionRange(index, index);
    highlightEl.querySelector(`[data-n="${line}"]`)?.scrollIntoView({ block: "center" });
  }

  /* ── Switching between the two ──────────────────────────────────────── */

  function setMode(next: Mode): void {
    if (next === mode) return;
    closeBubble(false);
    closeMenu();
    if (next === "code") {
      if (historyTimer) remember();
      const { text, lines } = serializeDoc(doc);
      codeBox.value = text;
      mode = "code";
      refreshCode();
      showPreview(wide.matches);
      // The cursor goes to the same place in the source.
      const caret = lastCaret;
      const found = caret ? lyric(caret.id) : null;
      if (caret && found && lines[caret.id]) {
        const column = caret.off + found.line.chords.filter((chord) => chord.pos <= caret.off).reduce((sum, chord) => sum + chord.name.length + 2, 0);
        requestAnimationFrame(() => selectCodeLine(lines[caret.id], column, false));
      }
    } else {
      const position = codeBox.selectionStart;
      const before = codeBox.value.slice(0, position);
      const lineNumber = before.split("\n").length;
      const column = position - before.lastIndexOf("\n") - 1;
      const hadFocus = document.activeElement === codeBox;
      const { doc: parsed, issues } = parseDoc(codeBox.value);
      doc = parsed;
      mode = "visual";
      let nearest: Section["lines"][number] | null = null;
      for (const item of doc.items) {
        if (item.kind !== "section") continue;
        for (const line of item.lines) if ((line.src ?? 0) <= lineNumber && (!nearest || (line.src ?? 0) > (nearest.src ?? 0))) nearest = line;
      }
      if (hadFocus && nearest && nearest.kind !== "raw") {
        let off: number | undefined;
        if (nearest.kind === "lyric") {
          off = nearest.src === lineNumber
            ? Math.min(nearest.text.length, codeBox.value.split("\n")[lineNumber - 1].slice(0, column).replace(/\[[^\]]*\]?/g, "").length)
            : nearest.text.length;
        }
        pendingFocus = { id: nearest.id, off, scroll: true };
      }
      remember();
      if (issues.some((issue) => issue.message !== NO_TITLE)) showToast("The ChordPro had problems; lines the editor could not read are shown in grey.");
    }
    root.dataset.mode = mode;
    q(".ce-visual").hidden = mode !== "visual";
    q(".ce-code").hidden = mode !== "code";
    parts.modes.querySelectorAll<HTMLButtonElement>("[data-mode]").forEach((button) => {
      const on = button.dataset.mode === mode;
      button.classList.toggle("on", on);
      button.setAttribute("aria-pressed", String(on));
    });
    if (mode === "visual") render();
  }
  parts.modes.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLElement>("[data-mode]");
    if (button) setMode(button.dataset.mode as Mode);
  });

  /* ── Start ──────────────────────────────────────────────────────────── */

  remember();
  render();
  // The screen is drawn before it is on the page; place chords once it has a size.
  let frame = 0;
  const resize = new ResizeObserver(() => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(layoutAll);
  });
  resize.observe(sectionsEl);
  cleanups.push(() => resize.disconnect());
  void document.fonts?.ready.then(layoutAll);

  return {
    source: () => (mode === "code" ? codeBox.value : serializeDoc(doc).text),
    destroy: () => {
      window.clearTimeout(historyTimer);
      window.clearTimeout(codeTimer);
      cleanups.forEach((cleanup) => cleanup());
    },
  };
}
