/**
 * The song editor in three modes, with a switch between them: Visual (the
 * default), Chords and the ChordPro source. All edit one `SongDoc`
 * (chord-doc.ts).
 *
 * The title is at the top in every mode but ChordPro; key, capo and the
 * other details are behind the cog in the bar at the bottom. Visual: the
 * whole song as one text, as it reads (words-editor.ts). Chords: the same
 * sections with the chords over the words, which cannot be changed there;
 * tapping a place in them (or Enter, `[` or Ctrl+K at the caret) opens a
 * bubble of chords under that letter, and a chord is moved by dragging it
 * (or ←/→ when it has focus). ChordPro: the source with colours, a list of
 * problems and a preview, typed as it is; Ctrl+K opens the same bubble at
 * the cursor.
 */
import {
  CHORD_PATTERN,
  MAJOR_KEYS,
  MINOR_KEYS,
  NO_TITLE,
  autoLabel,
  chordVariants,
  chordsInKey,
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
  trimSections,
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
import { editable, mountWordsEditor } from "./words-editor.ts";

export interface ChordEditor {
  /** The ChordPro source as it is now. */
  source(): string;
  destroy(): void;
}

type Mode = "visual" | "chords" | "code";
interface Caret { id: string; off: number }
interface Focus { id: string; off?: number; scroll?: boolean }
/** Where the chord bubble puts a chord: a place in a line, or a range of the ChordPro (an existing `[chord]`, or an empty range). */
type Bubble =
  | { kind: "line"; lineId: string; pos: number; chordId?: string }
  | { kind: "code"; start: number; end: number; chord?: string };

const coarse = matchMedia("(pointer: coarse)").matches;
/** A mouse: chords are placed from boxes above the letters, not by clicking the words. */
const mouse = matchMedia("(hover: hover) and (pointer: fine)").matches;
/** Fields with their own control; other details show as read-only text. */
const FIELD_KEYS = ["title", "author", "key", "capo", "number", "song_number", "song_num", "copyright", "ccli", "tempo", "time"];

export function mountChordEditor(
  root: HTMLElement,
  initial: string,
  parts: { modes: HTMLElement; save: () => void; /** Wide screens: the bar goes here, in the page's header. */ dock?: HTMLElement },
): ChordEditor {
  let doc: SongDoc = parseDoc(initial).doc;
  trimSections(doc);
  let mode: Mode = "visual";
  let history: string[] = [];
  let at = -1;
  let historyTimer = 0;
  let pendingFocus: Focus | null = null;
  let lastCaret: Caret | null = null;
  let bubble: Bubble | null = null;
  let keyShift = 0;
  const cleanups: Array<() => void> = [];
  const listen = <K extends keyof DocumentEventMap>(target: Document, type: K, handler: (event: DocumentEventMap[K]) => void, options?: AddEventListenerOptions) => {
    target.addEventListener(type, handler, options);
    cleanups.push(() => target.removeEventListener(type, handler, options));
  };

  root.classList.add("ce");
  root.dataset.mode = "visual";
  root.innerHTML = `
    <div class="ce-visual">
      <input class="ce-title" data-meta="title" autocomplete="off" placeholder="Song title" aria-label="Title" />
      <div class="ce-flow"></div>
      <div class="ce-sections"></div>
      <p class="hint ce-hint ce-hint-chords">${mouse ? "Point at a line and click a box above a letter" : "Tap a place in the words"} to put a chord there, and drag a chord to move it. The words are changed in Visual.</p>
    </div>
    <div class="ce-code" hidden>
      <div class="ce-code-main">
        <div class="ce-code-box"><div class="ce-code-inner"><pre class="ce-hl" aria-hidden="true"></pre><textarea class="ce-src" spellcheck="false" autocapitalize="off" autocomplete="off" aria-label="ChordPro source"></textarea></div></div>
        <ul class="ce-issues" aria-live="polite"></ul>
        <p class="hint">${mouse ? "Press Ctrl+K to pick a chord at the cursor. " : ""}Chords go in brackets before the syllable, like <code>[G]Amazing [D]grace</code>. Sections use <code>{start_of_chorus}</code> … <code>{end_of_chorus}</code>.</p>
      </div>
      <div class="ce-preview-col">
        <button type="button" class="button secondary small ce-preview-toggle" aria-expanded="false">Show preview</button>
        <div class="ce-preview" hidden></div>
      </div>
    </div>`;

  parts.modes.innerHTML = `<button type="button" data-mode="visual" class="on" aria-pressed="true">Visual</button><button type="button" data-mode="chords" aria-pressed="false">Chords</button><button type="button" data-mode="code" aria-pressed="false">ChordPro</button>`;

  const q = <T extends Element = HTMLElement>(selector: string, scope: ParentNode = root) => scope.querySelector<T>(selector)!;
  const sectionsEl = q(".ce-sections");
  const flowEl = q(".ce-flow");
  // Key, capo and the other details: shown in the panel behind the bar's cog.
  const settingsEl = document.createElement("div");
  settingsEl.className = "ce-settings";
  settingsEl.innerHTML = `
    <div class="ce-pair">
      <label>Key<select class="ce-key"></select></label>
      <label>Capo<select data-meta="capo"><option value="">None</option>${Array.from({ length: 11 }, (_, i) => `<option>${i + 1}</option>`).join("")}</select></label>
    </div>
    <div class="ce-key-prompt" hidden>
      <p></p>
      <button type="button" class="button primary small" data-key="yes">Move chords</button>
      <button type="button" class="button secondary small" data-key="no">Keep chords</button>
    </div>
    <details class="ce-more">
      <summary>More details</summary>
      <div class="ce-more-grid">
        <label class="ce-span">Author<input data-meta="author" autocomplete="off" /></label>
        <label>Number<input data-meta="number" autocomplete="off" inputmode="numeric" /></label>
        <label>CCLI<input data-meta="ccli" autocomplete="off" inputmode="numeric" /></label>
        <label>Tempo<input data-meta="tempo" autocomplete="off" inputmode="numeric" placeholder="BPM" /></label>
        <label>Time<input data-meta="time" autocomplete="off" placeholder="4/4" /></label>
        <label class="ce-span">Copyright<input data-meta="copyright" autocomplete="off" /></label>
      </div>
      <p class="ce-extras" hidden></p>
    </details>`;
  const keySelect = q<HTMLSelectElement>(".ce-key", settingsEl);
  const keyPrompt = q(".ce-key-prompt", settingsEl);
  const metaFields = () => [root, settingsEl].flatMap((scope) => [...scope.querySelectorAll<HTMLInputElement | HTMLSelectElement>("[data-meta]")]);
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
  document.body.append(bubbleEl);
  cleanups.push(() => bubbleEl.remove());
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
    const caret = caretNow();
    // In Visual, only when the words have the caret: on a phone, focusing them opens the keyboard.
    if (caret && locate(caret.id) && (mode !== "visual" || words.focused())) pendingFocus = { ...caret };
    render();
  }
  function commit(): void {
    remember();
    render();
  }
  /** Where the caret is in the words, in Visual or Chords. */
  function caretNow(): Caret | null {
    if (mode !== "visual") return lastCaret;
    const point = words.caret();
    return point ? { id: point.line, off: point.off } : null;
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

  /* ── Chords: the words with their chords over them ──────────────────── */

  function chipsHtml(line: LyricLine): string {
    return `<span class="ce-ghost" hidden aria-hidden="true"></span>${[...line.chords].sort((a, b) => a.pos - b.pos).map((chord) =>
      `<button type="button" class="ce-chip" data-chord="${chord.id}" aria-label="Chord ${escapeHtml(chord.name)}" aria-describedby="ce-chip-help">${escapeHtml(chord.name)}</button>`).join("")}`;
  }
  function lineHtml(line: Section["lines"][number]): string {
    if (line.kind === "lyric") {
      // With a mouse the words keep a caret (for the keyboard) but take no
      // typing. On a touch screen they are not editable at all, so a long
      // press does not select words while placing a chord.
      return `<div class="ce-line" data-line="${line.id}"><div class="ce-text" data-line="${line.id}" contenteditable="${mouse ? editable : "false"}" inputmode="none" aria-readonly="true" role="textbox" aria-label="Line" spellcheck="false">${escapeHtml(line.text)}</div><div class="ce-chips">${chipsHtml(line)}</div></div>`;
    }
    if (line.kind === "comment") return `<div class="ce-comment"><span class="ce-tag">Note</span><div class="ce-comment-text">${escapeHtml(line.text)}</div></div>`;
    return `<div class="ce-raw" title="Change this line in ChordPro"><code>${escapeHtml(line.text)}</code></div>`;
  }
  function sectionHtml(section: Section, verse: number): string {
    const name = escapeHtml(section.label || autoLabel(section, verse));
    return `<section class="ce-sec" data-item="${section.id}" aria-label="${name}">
      <h3 class="ce-sec-name">${name}</h3>
      <div class="ce-sec-body">${section.lines.map(lineHtml).join("")}</div>
    </section>`;
  }
  function render(): void {
    closeBubble(false);
    renderDetails();
    if (mode === "visual") {
      const focus = pendingFocus;
      pendingFocus = null;
      sectionsEl.innerHTML = "";
      words.render(focus?.id ? { line: focus.id, off: focus.off ?? 0 } : null);
      return;
    }
    flowEl.innerHTML = "";
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
    const el = sectionsEl.querySelector<HTMLElement>(`.ce-text[data-line="${focus.id}"]`);
    if (!el) return;
    setCaret(el, focus.off ?? el.textContent!.length);
    if (focus.scroll) el.scrollIntoView({ block: "center", behavior: "smooth" });
  }

  /* ── Song details ───────────────────────────────────────────────────── */

  function renderDetails(): void {
    metaFields().forEach((field) => {
      if (document.activeElement !== field) field.value = metaValue(doc, fieldKey(field.dataset.meta!));
    });
    const key = metaValue(doc, "key");
    const keys = [...MAJOR_KEYS, ...MINOR_KEYS];
    const option = (value: string) => `<option${value === key ? " selected" : ""}>${escapeHtml(value)}</option>`;
    keySelect.innerHTML = `<option value="">Not set</option>${key && !keys.includes(key) ? option(key) : ""}<optgroup label="Major">${MAJOR_KEYS.map(option).join("")}</optgroup><optgroup label="Minor">${MINOR_KEYS.map(option).join("")}</optgroup>`;
    const fieldKeys = new Set(FIELD_KEYS);
    const others = doc.items.filter((item) => item.kind === "meta" && !fieldKeys.has(item.key));
    const extras = q(".ce-extras", settingsEl);
    extras.hidden = !others.length;
    extras.innerHTML = others.length ? `Also in the song: ${others.map((item) => `<code>${escapeHtml(metaSource(item as MetaItem))}</code>`).join(" ")}. Change these in ChordPro.` : "";
  }
  metaFields().forEach((field) => {
    field.addEventListener(field.tagName === "SELECT" ? "change" : "input", () => {
      setMeta(doc, fieldKey(field.dataset.meta!), field.value.trim());
      if (mode === "code") writeCode();
      else rememberSoon();
    });
  });
  keySelect.addEventListener("change", () => {
    const before = metaValue(doc, "key");
    const after = keySelect.value;
    setMeta(doc, "key", after);
    if (mode === "code") writeCode();
    else remember();
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
    if (mode === "code") {
      // The source keeps its own undo (Ctrl+Z in it).
      writeCode();
      showToast(`Moved the chords to ${metaValue(doc, "key")}.`);
      return;
    }
    commit();
    showToast(`Moved the chords to ${metaValue(doc, "key")}.`, { action: { label: "Undo", run: undo } });
  });
  // Enter in a field must not save the form.
  const noSubmit = (event: KeyboardEvent) => {
    if (event.key === "Enter" && (event.target as HTMLElement).matches("input")) event.preventDefault();
  };
  root.addEventListener("keydown", noSubmit);
  settingsEl.addEventListener("keydown", noSubmit);

  /* ── Keys in the words of Chords ────────────────────────────────────── */

  /** Up and Down cross from line to line; false when the caret stays in its line. */
  function moveVertically(el: HTMLElement, direction: -1 | 1): boolean {
    const length = textNode(el)?.length ?? 0;
    const box = charBox(el, caretOffset(el));
    const row = parseFloat(getComputedStyle(el).lineHeight) || 40;
    if (length) {
      if (direction < 0 && box.top - charBox(el, 0).top > row / 2) return false;
      if (direction > 0 && charBox(el, length).top - box.top > row / 2) return false;
    }
    const all = [...sectionsEl.querySelectorAll<HTMLElement>(".ce-text")];
    const target = all[all.indexOf(el) + direction];
    if (!target) return false;
    const targetLength = textNode(target)?.length ?? 0;
    const y = (direction < 0 ? charBox(target, targetLength).top : charBox(target, 0).top) + 4;
    setCaret(target, offsetAt(target, box.x, y));
    target.closest(".ce-line")?.scrollIntoView({ block: "nearest" });
    return true;
  }

  // The words are changed in Visual; here `[` puts a chord at the caret.
  sectionsEl.addEventListener("beforeinput", (event) => {
    const el = (event.target as HTMLElement).closest<HTMLElement>(".ce-text");
    if (!el) return;
    event.preventDefault();
    if (event.inputType === "historyUndo") undo();
    else if (event.inputType === "historyRedo") redo();
    else if (event.inputType === "insertText" && event.data === "[") openLineBubble(el.dataset.line!, caretOffset(el), true);
  });
  // Typing that could not be stopped (such as a phone's word suggestions) is undone.
  sectionsEl.addEventListener("input", (event) => {
    const el = (event.target as HTMLElement).closest<HTMLElement>(".ce-text");
    const found = el && lyric(el.dataset.line!);
    if (!el || !found) return;
    el.textContent = found.line.text;
    layoutChips(found.line.id);
  });
  sectionsEl.addEventListener("paste", (event) => event.preventDefault());
  sectionsEl.addEventListener("keydown", (event) => {
    const target = event.target as HTMLElement;
    if (target.classList.contains("ce-text")) {
      if (event.key === "Enter" || ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k")) {
        event.preventDefault();
        openLineBubble(target.dataset.line!, caretOffset(target), true);
      } else if (event.key === "Backspace" || event.key === "Delete") {
        event.preventDefault();
      } else if ((event.key === "ArrowUp" || event.key === "ArrowDown") && !event.shiftKey) {
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
    }
  });

  /* In Chords, with a mouse, the space above a line is split into an unseen box per
     letter (as wide as the letter); the one under the pointer shows,
     reaching down over its letter, and clicking it opens the chord bubble
     there. On a touch screen, tapping a place in the words opens the
     bubble; tapping the space above a row does too. */
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
        cells.push(`<span class="ce-cell end" data-pos="${i}" title="After the line" style="left:${box.x - origin.left + (length ? 6 : 0)}px;top:${top}px;--letter-h:${box.h}px">+</span>`);
        continue;
      }
      range.setStart(node!, i);
      range.setEnd(node!, i + 1);
      const width = range.getClientRects()[0]?.width ?? 0;
      if (width < 1) continue;
      cells.push(`<span class="ce-cell" data-pos="${i}" style="left:${box.x - origin.left}px;top:${top}px;width:${width}px;--letter-h:${box.h}px"></span>`);
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
  sectionsEl.addEventListener("pointerdown", (event) => {
    const target = event.target as HTMLElement;
    if (target.closest(".ce-cell")) {
      event.preventDefault();
      return;
    }
    const chip = target.closest<HTMLElement>(".ce-chip");
    if (chip) {
      hideCells();
      return dragChord(event, chip);
    }
    const wrap = target.closest<HTMLElement>(".ce-line");
    if (wrap && chordSpotAt(wrap.querySelector<HTMLElement>(".ce-text")!, event.clientX, event.clientY) >= 0) event.preventDefault();
    if (wrap && event.pointerType !== "mouse") slideBox(event, wrap);
  });

  /** The letter under a point (its index), or the line's length after its last letter. */
  function letterAt(text: HTMLElement, x: number, y: number): number {
    const node = textNode(text);
    const length = node?.length ?? 0;
    if (!node || !length) return 0;
    const rowTop = charBox(text, offsetAt(text, x, y)).top;
    const range = document.createRange();
    let nearest = -1;
    let nearestDistance = Infinity;
    for (let i = 0; i < length; i += 1) {
      range.setStart(node, i);
      range.setEnd(node, i + 1);
      const rect = range.getClientRects()[0];
      if (!rect || Math.abs(rect.top - rowTop) > 4) continue;
      if (x >= rect.left && x < rect.right) return i;
      const distance = Math.min(Math.abs(x - rect.left), Math.abs(x - rect.right));
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearest = i;
      }
    }
    // Past the end of the last row: the place after the line.
    const end = charBox(text, length);
    if (Math.abs(end.top - rowTop) <= 4 && x >= end.x) return length;
    return Math.max(0, nearest);
  }
  /** Draws the box over a letter and the space above it (or the place after the line). */
  function drawSlideBox(wrap: HTMLElement, pos: number): void {
    const text = wrap.querySelector<HTMLElement>(".ce-text")!;
    const node = textNode(text);
    const length = node?.length ?? 0;
    const origin = wrap.getBoundingClientRect();
    const box = charBox(text, pos);
    let width = 22;
    let left = box.x - origin.left + (length && pos === length ? 6 : 0);
    if (node && pos < length) {
      const range = document.createRange();
      range.setStart(node, pos);
      range.setEnd(node, pos + 1);
      const rect = range.getClientRects()[0];
      width = rect?.width ?? width;
      left = (rect?.left ?? box.x) - origin.left;
    }
    let el = wrap.querySelector<HTMLElement>(".ce-slide");
    if (!el) {
      el = document.createElement("span");
      el.className = "ce-slide";
      el.setAttribute("aria-hidden", "true");
      wrap.querySelector(".ce-chips")!.prepend(el);
    }
    el.classList.toggle("end", pos === length);
    el.style.cssText = `left:${left - 1}px;top:${box.top - origin.top - 24}px;width:${width + 2}px;height:${box.h + 26}px`;
  }
  /*
   * On a touch screen: pressing a line shows the box at the letter under
   * the finger, sliding sideways moves it along the line, and letting go
   * opens the chord bubble there. Moving up or down scrolls the page as
   * usual (the browser cancels the press) and the box goes away.
   */
  function slideBox(event: PointerEvent, wrap: HTMLElement): void {
    const text = wrap.querySelector<HTMLElement>(".ce-text")!;
    let pos = letterAt(text, event.clientX, event.clientY);
    const row = event.clientY;
    drawSlideBox(wrap, pos);
    const magnify = (x: number) => {
      const slide = wrap.querySelector<HTMLElement>(".ce-slide");
      if (slide) showLoupe(wrap, slide.getBoundingClientRect(), x, row);
    };
    magnify(event.clientX);
    const move = (next: PointerEvent) => {
      if (next.pointerId !== event.pointerId) return;
      // Stay on the row the press started on, wherever the finger drifts up or down.
      const at = letterAt(text, next.clientX, row);
      if (at !== pos) {
        pos = at;
        drawSlideBox(wrap, pos);
      }
      magnify(next.clientX);
    };
    const end = (next: PointerEvent) => {
      if (next.pointerId !== event.pointerId) return;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
      wrap.querySelector(".ce-slide")?.remove();
      hideLoupe();
      if (next.type !== "pointerup") return;
      // Selecting words (a long press) is not a place for a chord.
      const selection = getSelection();
      if (selection && !selection.isCollapsed && text.contains(selection.anchorNode)) return;
      openLineBubble(text.dataset.line!, pos);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
  }
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
  });
  listen(document, "selectionchange", () => {
    const selection = getSelection();
    const node = selection?.anchorNode;
    const el = node && (node.nodeType === Node.ELEMENT_NODE ? node as Element : node.parentElement)?.closest<HTMLElement>(".ce-text");
    if (el && sectionsEl.contains(el)) lastCaret = { id: el.dataset.line!, off: caretOffset(el) };
  });

  /*
   * A magnifier above the finger while it places or moves a chord on a touch
   * screen, so the letter under the finger can be seen: a copy of the line,
   * larger, centred on `focus` (the box or the chord and its letter).
   */
  const LOUPE_SCALE = 1.7;
  function showLoupe(wrap: HTMLElement, focus: DOMRect, fingerX: number, fingerY: number): void {
    let loupe = sectionsEl.querySelector<HTMLElement>(".ce-loupe");
    if (!loupe) {
      loupe = document.createElement("div");
      loupe.className = "ce-loupe";
      loupe.setAttribute("aria-hidden", "true");
      loupe.inert = true;
      sectionsEl.append(loupe);
    }
    const copy = wrap.cloneNode(true) as HTMLElement;
    // Only the original is looked up by its line and chords.
    copy.querySelectorAll("[data-line], [data-chord], [id], [contenteditable]").forEach((node) => {
      node.removeAttribute("data-line");
      node.removeAttribute("data-chord");
      node.removeAttribute("id");
      node.removeAttribute("contenteditable");
    });
    copy.removeAttribute("data-line");
    const origin = wrap.getBoundingClientRect();
    const width = loupe.offsetWidth;
    const height = loupe.offsetHeight;
    const cx = focus.left + focus.width / 2 - origin.left;
    const cy = focus.top + focus.height / 2 - origin.top;
    copy.classList.add("ce-loupe-copy");
    copy.style.width = `${origin.width}px`;
    copy.style.transform = `translate(${width / 2 - cx * LOUPE_SCALE}px, ${height / 2 - cy * LOUPE_SCALE}px) scale(${LOUPE_SCALE})`;
    loupe.replaceChildren(copy);
    // Above the finger, clear of it, and inside the screen.
    const left = Math.min(Math.max(8, fingerX - width / 2), innerWidth - width - 8);
    const top = Math.max(8, Math.min(fingerY, focus.top) - height - 28);
    loupe.style.left = `${left}px`;
    loupe.style.top = `${top}px`;
  }
  function hideLoupe(): void {
    sectionsEl.querySelector(".ce-loupe")?.remove();
  }

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
      if (next.pointerType !== "mouse") {
        // The chord and the letter it is on, from the chord's top to the letter's foot.
        const chipBox = chip.getBoundingClientRect();
        const letter = charBox(text, chord.pos);
        const span = new DOMRect(chipBox.left, chipBox.top, chipBox.width, letter.top + letter.h - chipBox.top);
        showLoupe(wrap, span, next.clientX, next.clientY);
      }
    };
    const end = () => {
      chip.removeEventListener("pointermove", move);
      chip.removeEventListener("pointerup", end);
      chip.removeEventListener("pointercancel", end);
      chip.classList.remove("dragging");
      hideLoupe();
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

  /* ── The chord bubble ───────────────────────────────────────────────── */

  /**
   * Tapping a place in the words (or in the ChordPro) opens a bubble just
   * under that letter, so the word stays in view, with the chords of the
   * key. Tapping one puts it there and closes the bubble. In the visual
   * editor a dashed box shows where the chord goes.
   */
  function openBubble(next: Bubble, typing = false): void {
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
    const typing = text !== null && (document.activeElement === text || document.activeElement === bubbleInput);
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
    // The caret stays at the place, for the next chord from the keyboard.
    if (typing && text) setCaret(text, target.pos);
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

  /* ── Closing the bubble, and undo ───────────────────────────────────── */

  listen(document, "pointerdown", (event) => {
    const target = event.target as HTMLElement;
    // A tap elsewhere closes the bubble; a tap in the words opens it again there.
    if (bubble && !bubbleEl.contains(target)) closeBubble(false);
  }, { capture: true });
  listen(document, "keydown", (event) => {
    if (event.key === "Escape") {
      if (bubble) {
        event.preventDefault();
        event.stopPropagation();
        closeBubble(true);
      }
      return;
    }
    const mod = event.ctrlKey || event.metaKey;
    if (mode === "code" || !mod || event.target === bubbleInput || (event.target as HTMLElement).closest?.(".ce-well")) return;
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
  /** In ChordPro the song is read from the source on every change, for the bar and its panels. */
  function refreshCode(): void {
    const parsed = parseDoc(codeBox.value);
    const { issues } = parsed;
    doc = parsed.doc;
    renderDetails();
    words.refresh();
    const real = issues.filter((issue) => issue.message !== NO_TITLE);
    highlightEl.innerHTML = highlight(codeBox.value, new Set(real.map((issue) => issue.line)));
    window.clearTimeout(codeTimer);
    codeTimer = window.setTimeout(() => {
      q(".ce-issues").innerHTML = issues.map((issue: Issue) => `<li><button type="button" data-goto="${issue.line}">Line ${issue.line}</button>${escapeHtml(issue.message)}</li>`).join("");
      if (!preview.hidden) preview.innerHTML = renderSongBody(prepareSong(codeBox.value, 0), { chords: true });
    }, 150);
  }
  /** The song's line at a line of the source: the one there, or the one before it in its section, or the section's first. */
  function lineAt(lineNumber: number): Section["lines"][number] | null {
    let found: Section["lines"][number] | null = null;
    for (const item of doc.items) {
      if (item.kind !== "section" || (item.src ?? 0) > lineNumber) continue;
      found = item.lines.filter((line) => (line.src ?? 0) <= lineNumber).at(-1) ?? item.lines[0] ?? found;
    }
    return found;
  }
  const cursorLine = () => codeBox.value.slice(0, codeBox.selectionStart).split("\n").length;
  /** Writes the song back to the source after the bar's panels changed it, keeping the cursor on its line. */
  function writeCode(): void {
    const before = codeBox.value.slice(0, codeBox.selectionStart);
    const column = before.length - before.lastIndexOf("\n") - 1;
    const line = lineAt(before.split("\n").length);
    const { text, lines } = serializeDoc(doc);
    if (text === codeBox.value) return;
    const hadFocus = document.activeElement === codeBox;
    const target = (line && lines[line.id]) ?? before.split("\n").length;
    codeBox.value = text;
    const rows = text.split("\n");
    let index = 0;
    for (let i = 0; i < target - 1 && i < rows.length; i += 1) index += rows[i].length + 1;
    codeBox.setSelectionRange(index + Math.min(column, (rows[target - 1] ?? "").length), index + Math.min(column, (rows[target - 1] ?? "").length));
    if (hadFocus) codeBox.focus({ preventScroll: true });
    refreshCode();
  }
  listen(document, "selectionchange", () => {
    if (mode === "code" && document.activeElement === codeBox) words.refresh();
  });
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
  function openCodeBubble(index: number, typing = false): void {
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
    } else openBubble({ kind: "code", start: index, end: index }, typing);
  }
  // The source is typed as it is, `[chord]` too; only Ctrl+K opens the bubble (chords are placed by tapping in Chords).
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
  // Side by side, the source and the preview scroll together, by the same share of their length.
  const codeScroller = q(".ce-code-box");
  let leader: HTMLElement | null = null;
  let leaderTimer = 0;
  const follow = (from: HTMLElement, to: HTMLElement) => () => {
    if (!wide.matches || (leader && leader !== from)) return;
    leader = from;
    const range = from.scrollHeight - from.clientHeight;
    to.scrollTop = range > 0 ? (from.scrollTop / range) * (to.scrollHeight - to.clientHeight) : 0;
    window.clearTimeout(leaderTimer);
    leaderTimer = window.setTimeout(() => { leader = null; }, 120);
  };
  codeScroller.addEventListener("scroll", follow(codeScroller, preview), { passive: true });
  preview.addEventListener("scroll", follow(preview, codeScroller), { passive: true });
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

  /* ── Switching between the three ────────────────────────────────────── */

  function setMode(next: Mode): void {
    if (next === mode) return;
    closeBubble(false);
    if (next !== "code" && mode !== "code") {
      // Between Visual and Chords: the same lines, drawn for words or for chords.
      if (historyTimer) remember();
      const active = document.activeElement as HTMLElement | null;
      const caret = caretNow();
      if ((words.focused() || active?.matches(".ce-text")) && caret && lyric(caret.id)) pendingFocus = { ...caret };
      mode = next;
    } else if (next === "code") {
      if (historyTimer) remember();
      const caret = caretNow();
      const { text, lines } = serializeDoc(doc);
      codeBox.value = text;
      mode = "code";
      flowEl.innerHTML = "";
      refreshCode();
      showPreview(wide.matches);
      // The cursor goes to the same place in the source.
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
      trimSections(doc);
      mode = next;
      let nearest: Section["lines"][number] | null = null;
      for (const item of doc.items) {
        if (item.kind !== "section") continue;
        for (const line of item.lines) if ((line.src ?? 0) <= lineNumber && (!nearest || (line.src ?? 0) > (nearest.src ?? 0))) nearest = line;
      }
      if (hadFocus && nearest && nearest.kind === "lyric") {
        const off = nearest.src === lineNumber
          ? Math.min(nearest.text.length, codeBox.value.split("\n")[lineNumber - 1].slice(0, column).replace(/\[[^\]]*\]?/g, "").length)
          : nearest.text.length;
        pendingFocus = { id: nearest.id, off, scroll: true };
      }
      remember();
      if (issues.some((issue) => issue.message !== NO_TITLE)) showToast("The ChordPro had problems; lines the editor could not read are shown in grey.");
    }
    root.dataset.mode = mode;
    q(".ce-visual").hidden = mode === "code";
    q(".ce-code").hidden = mode !== "code";
    parts.modes.querySelectorAll<HTMLButtonElement>("[data-mode]").forEach((button) => {
      const on = button.dataset.mode === mode;
      button.classList.toggle("on", on);
      button.setAttribute("aria-pressed", String(on));
    });
    words.setMode(mode);
    if (mode !== "code") render();
  }
  parts.modes.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLElement>("[data-mode]");
    if (button) setMode(button.dataset.mode as Mode);
  });

  /* ── Start ──────────────────────────────────────────────────────────── */

  const words = mountWordsEditor(flowEl, {
    doc: () => doc,
    flush: () => { if (historyTimer) remember(); },
    remember,
    rememberSoon: () => rememberSoon(),
    undo,
    settings: settingsEl,
    save: parts.save,
    dock: parts.dock,
    codePlace: () => {
      const line = lineAt(cursorLine());
      return line ? { line: line.id, off: 0 } : null;
    },
    codeChanged: writeCode,
  });
  cleanups.push(() => words.destroy());
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
