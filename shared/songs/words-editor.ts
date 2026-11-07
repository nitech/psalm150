/**
 * The song editor's Visual mode: the whole song as one piece of text.
 *
 * Each section is a paragraph with its name above it, the way the song
 * reads; chords are not shown, but stay on their letters as the words
 * change. Enter on an empty line starts a new section, and Backspace at
 * the start of one joins it to the section before. A bar at the bottom
 * (over a phone's keyboard, or above Save) shows the type of the section
 * the caret is in; tapping it opens a panel to change the type, name,
 * move, copy or delete the section and add notes. Its cog opens the song's
 * key, capo and other details, and whether chords sound as they are put in. The bar serves ChordPro too, through the
 * host, which reads the song from the source and writes it back. Typing within a line is left to the browser and read back;
 * everything that crosses lines is done on the model and drawn again.
 */
import {
  applyEdit,
  autoLabel,
  convertPlain,
  copyLines,
  copyPieces,
  diffText,
  findLine,
  joinSection,
  lyricLine,
  newId,
  piecesText,
  replaceRange,
  sectionsOf,
  spaceSections,
  splitSection,
  typeName,
  type CommentLine,
  type Line,
  type LyricLine,
  type Piece,
  type Point,
  type Section,
  type SongDoc,
} from "./chord-doc.ts";
import { icon, type IconName } from "./icon.ts";
import { escapeHtml } from "./format.ts";
import { showToast } from "./host.ts";
import { t, tn } from "./i18n.ts";

/** Where the editor's bar moves into the header: wide enough for Back, the mode switch and the bar. */
export const DOCKED = "(min-width: 1100px)";

export type MenuItem = { label: string; run: () => void; disabled?: boolean; danger?: boolean } | "rule";
export type EditorMode = "visual" | "chords" | "code";

export interface WordsHost {
  /** Wide screens (`DOCKED`): the bar sits here, in the page's header, instead of floating at the bottom. */
  dock?: HTMLElement;
  /** When the bar goes into `dock`; `DOCKED` unless the app says otherwise (the web client always docks it, as iOS Safari lets a bar fixed at the bottom jump while scrolling). */
  dockWhen?: string;
  doc(): SongDoc;
  /** Saves typing not yet in the history, before a change of its own. */
  flush(): void;
  remember(): void;
  rememberSoon(): void;
  undo(): void;
  /** Saves the song (the bar's Save). */
  save(): void;
  /** In ChordPro: the line the cursor is in, from the source as it is now. */
  codePlace(): Point | null;
  /** In ChordPro: writes the song back to the source after the panel changed it. */
  codeChanged(): void;
  /** The song's key, capo and other details, and how chords sound, shown in the panel behind the cog. */
  settings: HTMLElement[];
}

export interface WordsEditor {
  /** Draws the song again; with a place, puts the caret there. */
  render(caret?: Point | null): void;
  /** Where the caret is, or was last. */
  caret(): Point | null;
  focused(): boolean;
  /** The bar's section button shows in Visual and ChordPro; its cog and Save in every mode. */
  setMode(mode: EditorMode): void;
  /** Shows the section the cursor is in again (ChordPro's cursor moved). */
  refresh(): void;
  destroy(): void;
}

/** `plaintext-only` keeps bold and the like out, where the browser has it. */
export const editable = (() => {
  const probe = document.createElement("div");
  try { probe.contentEditable = "plaintext-only"; } catch { /* older browsers */ }
  return probe.contentEditable === "plaintext-only" ? "plaintext-only" : "true";
})();

/** The section types the panel offers. */
const TYPES = ["verse", "chorus", "prechorus", "bridge", "intro", "interlude", "outro", "tag"];

export function mountWordsEditor(flow: HTMLElement, host: WordsHost): WordsEditor {
  let last: Point | null = null;
  /** What was copied here last, with its chords: pasting the same text puts them back. */
  let clip: { text: string; pieces: Piece[] } | null = null;
  let fieldDone: ((value: string) => void) | null = null;
  let fieldStart = "";
  let well: "section" | "settings" | "field" | null = null;
  let mode: EditorMode = "visual";
  const cleanups: Array<() => void> = [];

  flow.classList.add("ce-flow");
  flow.contentEditable = editable;
  flow.setAttribute("role", "textbox");
  flow.setAttribute("aria-multiline", "true");
  flow.setAttribute("aria-label", t("Song words"));
  flow.spellcheck = false;

  const bar = document.createElement("div");
  bar.className = "ce-bar";
  bar.innerHTML = `
    <button type="button" class="ce-bar-section" aria-haspopup="dialog" aria-expanded="false"><span></span>${icon("down")}</button>
    <button type="button" class="ce-bar-cog" aria-haspopup="dialog" aria-expanded="false" aria-label="${t("Key, capo, details and chord sound")}" title="${t("Key, capo, details and chord sound")}">${icon("settings")}</button>
    <button type="button" class="ce-bar-save">${icon("save")}${t("Save")}</button>`;
  const wellEl = document.createElement("div");
  wellEl.className = "ce-well";
  wellEl.setAttribute("role", "dialog");
  wellEl.hidden = true;
  wellEl.innerHTML = `
    <div class="ce-well-section" role="group" aria-label="${t("Section")}"></div>
    <div class="ce-well-settings"><p class="ce-well-title">${t("Song")}</p></div>
    <div class="ce-well-name">
      <p class="ce-well-title"></p>
      <div class="ce-well-field">
        <input autocomplete="off" enterkeyhint="done" />
        <button type="button" class="button primary small">${t("Done")}</button>
      </div>
    </div>`;
  document.body.append(wellEl, bar);
  cleanups.push(() => { bar.remove(); wellEl.remove(); });
  // Wide screens: the bar is part of the header (with the mode switch), not
  // a floating pill; narrower ones keep it at the bottom.
  const docked = matchMedia(host.dockWhen ?? DOCKED);
  const dock = () => {
    const inHeader = Boolean(host.dock && docked.matches);
    if (inHeader) host.dock!.append(bar);
    else document.body.append(bar);
    bar.classList.toggle("docked", inHeader);
    wellEl.classList.toggle("docked", inHeader);
    bar.style.bottom = "";
    placeBar();
  };
  docked.addEventListener("change", dock);
  cleanups.push(() => docked.removeEventListener("change", dock));
  const sectionButton = bar.querySelector<HTMLButtonElement>(".ce-bar-section")!;
  const cogButton = bar.querySelector<HTMLButtonElement>(".ce-bar-cog")!;
  const sectionWell = wellEl.querySelector<HTMLElement>(".ce-well-section")!;
  const settingsWell = wellEl.querySelector<HTMLElement>(".ce-well-settings")!;
  const nameWell = wellEl.querySelector<HTMLElement>(".ce-well-name")!;
  const fieldInput = nameWell.querySelector("input")!;
  settingsWell.append(...host.settings);
  // Opening More details makes the panel taller: it grows upwards from the bar.
  wellEl.addEventListener("toggle", () => placeBar(), true);

  const doc = () => host.doc();
  const lyric = (id: string) => {
    const found = findLine(doc(), id);
    return found ? found.section.lines[found.index] as LyricLine : null;
  };
  const lyrics = () => sectionsOf(doc()).flatMap((section) => section.lines.filter((line): line is LyricLine => line.kind === "lyric"));
  const lineEls = () => [...flow.querySelectorAll<HTMLElement>(".ce-l")];

  /* ── Drawing ────────────────────────────────────────────────────────── */

  function lineHtml(line: Line): string {
    if (line.kind === "lyric") return `<div class="ce-l" data-line="${line.id}">${escapeHtml(line.text) || "<br>"}</div>`;
    if (line.kind === "comment") return `<div class="ce-atom ce-note" contenteditable="false" data-note="${line.id}" title="${t("Change the note")}"><span class="ce-tag">${t("Note")}</span>${escapeHtml(line.text) || "&nbsp;"}</div>`;
    return `<div class="ce-atom ce-raw" contenteditable="false" title="${t("Change this line in ChordPro")}"><code>${escapeHtml(line.text)}</code></div>`;
  }
  function render(caret?: Point | null): void {
    const song = doc();
    if (!sectionsOf(song).length) song.items.push({ id: newId(), kind: "section", type: "none", label: "", lines: [lyricLine()], blankBefore: 1 });
    // Every section has a line to type in.
    for (const section of sectionsOf(song)) if (!section.lines.some((line) => line.kind === "lyric")) section.lines.unshift(lyricLine());
    let verse = 0;
    flow.innerHTML = song.items.map((item) => {
      if (item.kind === "meta") return "";
      if (item.kind === "raw") return lineHtml(item);
      if (item.type === "verse" || item.type === "none") verse += 1;
      return `<div class="ce-stanza" data-item="${item.id}" data-label="${escapeHtml(item.label || autoLabel(item, verse))}">${item.lines.map(lineHtml).join("")}</div>`;
    }).join("");
    if (caret && lyric(caret.line)) setCaret(caret);
    showBar();
  }

  /* ── Places in the text ─────────────────────────────────────────────── */

  const textOf = (el: HTMLElement) => el.textContent ?? "";
  /** The place in the words at a point in the page's text; between lines, the nearest line after. */
  function pointAt(node: Node, offset: number): Point | null {
    const holder = node.nodeType === Node.ELEMENT_NODE ? node as Element : node.parentElement;
    const el = holder?.closest<HTMLElement>(".ce-l");
    if (el && flow.contains(el)) {
      let off = 0;
      if (node === el) {
        for (let i = 0; i < offset && i < el.childNodes.length; i += 1) off += el.childNodes[i].textContent?.length ?? 0;
      } else {
        const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
        for (let text = walker.nextNode(); text; text = walker.nextNode()) {
          if (text === node) {
            off += offset;
            break;
          }
          off += text.textContent?.length ?? 0;
        }
      }
      return { line: el.dataset.line!, off: Math.min(off, textOf(el).length) };
    }
    const all = lineEls();
    if (!all.length) return null;
    const range = document.createRange();
    for (const line of all) {
      range.selectNodeContents(line);
      if (range.comparePoint(node, offset) <= 0) return { line: line.dataset.line!, off: 0 };
    }
    const end = all[all.length - 1];
    return { line: end.dataset.line!, off: textOf(end).length };
  }
  function span(range: { startContainer: Node; startOffset: number; endContainer: Node; endOffset: number }): { from: Point; to: Point } | null {
    const from = pointAt(range.startContainer, range.startOffset);
    const to = pointAt(range.endContainer, range.endOffset);
    return from && to ? { from, to } : null;
  }
  function selected(): { from: Point; to: Point } | null {
    const selection = getSelection();
    if (!selection?.rangeCount) return null;
    const range = selection.getRangeAt(0);
    return flow.contains(range.commonAncestorContainer) ? span(range) : null;
  }
  function setCaret(point: Point): void {
    const el = flow.querySelector<HTMLElement>(`.ce-l[data-line="${point.line}"]`);
    if (!el) return;
    flow.focus({ preventScroll: true });
    const node = el.firstChild?.nodeType === Node.TEXT_NODE ? el.firstChild as Text : null;
    const range = document.createRange();
    if (node) range.setStart(node, Math.min(point.off, node.length));
    else range.setStart(el, 0);
    range.collapse(true);
    const selection = getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    last = point;
    const box = range.getClientRects()[0] ?? el.getBoundingClientRect();
    const viewport = window.visualViewport;
    const floating = !bar.hidden && !bar.classList.contains("docked");
    const bottom = (viewport ? viewport.offsetTop + viewport.height : innerHeight) - (floating ? bar.offsetHeight + 24 : 0);
    const top = Math.max((viewport?.offsetTop ?? 0) + 60, host.dock && !floating ? host.dock.getBoundingClientRect().bottom + 8 : 0);
    if (box.bottom > bottom || box.top < top) el.scrollIntoView({ block: "center" });
  }
  const same = (a: Point, b: Point) => a.line === b.line && a.off === b.off;
  /** The place a line before or after `point`'s line ends or starts; null at the song's ends. */
  function across(point: Point, direction: -1 | 1): Point | null {
    const all = lyrics();
    const next = all[all.findIndex((line) => line.id === point.line) + direction];
    return next ? { line: next.id, off: direction < 0 ? next.text.length : 0 } : null;
  }

  /* ── Changes ────────────────────────────────────────────────────────── */

  function change(from: Point, to: Point, pieces: Piece[], quiet = false): void {
    host.flush();
    const { caret, lost } = replaceRange(doc(), from, to, pieces);
    host.remember();
    render(caret);
    if (lost && !quiet) showToast(tn(lost, "Removed {n} chord.", "Removed {n} chords."), { action: { label: t("Undo"), run: host.undo } });
  }
  function enter(from: Point, to: Point): void {
    const line = lyric(from.line);
    if (same(from, to) && line && !line.text && !line.chords.length) {
      // Enter on an empty line ends the section there.
      host.flush();
      const point = splitSection(doc(), from.line);
      if (!point) return;
      host.remember();
      render(point);
      return;
    }
    change(from, to, [{ lines: [lyricLine(), lyricLine()] }]);
  }

  flow.addEventListener("beforeinput", (event) => {
    const type = event.inputType;
    if (type === "historyUndo" || type === "historyRedo" || type.startsWith("format") || type === "insertFromDrop" || type === "deleteByDrag") {
      event.preventDefault();
      if (type === "historyUndo") host.undo();
      return;
    }
    if (type === "insertCompositionText") return;
    const target = event.getTargetRanges?.()[0];
    let place = (target && span(target)) ?? selected();
    if (!place) {
      event.preventDefault();
      return;
    }
    if (type === "insertParagraph" || type === "insertLineBreak") {
      event.preventDefault();
      enter(place.from, place.to);
      return;
    }
    if (type.startsWith("delete") && same(place.from, place.to)) {
      // At the start or end of a line, the browser would join its blocks; it is done here.
      const caret = place.from;
      const backward = type.endsWith("Backward");
      // At a section's first or last line, the sections join and the lines stay apart (Enter on an empty line undone).
      const found = findLine(doc(), caret.line)!;
      const lyricIndexes = found.section.lines.flatMap((line, index) => (line.kind === "lyric" ? [index] : []));
      const sections = sectionsOf(doc());
      const join = backward
        ? caret.off === 0 && found.index === lyricIndexes[0] && found.section
        : caret.off === (lyric(caret.line)?.text.length ?? 0) && found.index === lyricIndexes[lyricIndexes.length - 1] && sections[sections.indexOf(found.section) + 1];
      if (join) {
        host.flush();
        if (joinSection(doc(), join.id)) {
          event.preventDefault();
          host.remember();
          render(caret);
          return;
        }
      }
      if (backward && caret.off === 0) {
        const before = across(caret, -1);
        if (!before) return event.preventDefault();
        place = { from: before, to: caret };
      } else if (!backward && caret.off === (lyric(caret.line)?.text.length ?? 0)) {
        const after = across(caret, 1);
        if (!after) return event.preventDefault();
        place = { from: caret, to: after };
      } else return;
    }
    const data = event.data ?? event.dataTransfer?.getData("text/plain") ?? "";
    // Brackets would read as chords in the ChordPro.
    if (place.from.line === place.to.line && !/[[\]\n\r]/.test(data)) return;
    event.preventDefault();
    const text = data.replace(/[[\]]/g, "").replace(/\s*[\r\n]+\s*/g, " ");
    change(place.from, place.to, type.startsWith("delete") || !text ? [] : [{ lines: [lyricLine(text)] }]);
  });

  /** Lines the browser has changed in a way this editor does not draw (a line split, text between lines). */
  function broken(): boolean {
    const ids = lineEls().map((el) => el.dataset.line);
    const all = lyrics();
    if (ids.length !== all.length || ids.some((id, index) => id !== all[index].id)) return true;
    const odd = (node: Node, allowed: string) => (node.nodeType === Node.TEXT_NODE ? Boolean(node.textContent?.trim()) : node.nodeType === Node.ELEMENT_NODE && !(node as Element).matches(allowed));
    return [...flow.childNodes].some((node) => odd(node, ".ce-stanza, .ce-atom"))
      || [...flow.querySelectorAll(".ce-stanza")].some((stanza) => [...stanza.childNodes].some((node) => odd(node, ".ce-l, .ce-atom")));
  }
  /** Keeps a line one text node (or a `<br>` when empty), so places in it can be found. */
  function tidy(el: HTMLElement): void {
    const text = textOf(el);
    const plain = text
      ? el.childNodes.length === 1 && el.firstChild!.nodeType === Node.TEXT_NODE
      : el.childNodes.length === 1 && el.firstChild!.nodeName === "BR";
    if (plain) return;
    const selection = getSelection();
    const caret = selection?.rangeCount && el.contains(selection.anchorNode) ? pointAt(selection.anchorNode!, selection.anchorOffset) : null;
    if (text) el.textContent = text;
    else el.innerHTML = "<br>";
    if (caret) setCaret(caret);
  }
  function readBack(composing: boolean): void {
    if (!composing && broken()) {
      // Seldom: the browser changed lines in its own way. Draw the song as it stands.
      render(last);
      return;
    }
    const all = lyrics();
    let changed = false;
    lineEls().forEach((el, index) => {
      const line = all[index];
      if (!line || el.dataset.line !== line.id) return;
      if (!composing) tidy(el);
      const text = textOf(el).replace(/\n/g, " ");
      if (text === line.text) return;
      const edit = diffText(line.text, text);
      applyEdit(line, edit.start, edit.end, edit.insert);
      changed = true;
    });
    if (changed) host.rememberSoon();
  }
  flow.addEventListener("input", (event) => readBack((event as InputEvent).isComposing));
  flow.addEventListener("compositionend", () => readBack(false));

  /* ── Copy and paste ─────────────────────────────────────────────────── */

  function copy(event: ClipboardEvent, cut: boolean): void {
    const place = selected();
    if (!place || same(place.from, place.to)) return;
    event.preventDefault();
    const pieces = copyPieces(doc(), place.from, place.to);
    const text = piecesText(pieces);
    event.clipboardData?.setData("text/plain", text);
    clip = { text, pieces };
    if (cut) change(place.from, place.to, [], true);
  }
  flow.addEventListener("copy", (event) => copy(event, false));
  flow.addEventListener("cut", (event) => copy(event, true));
  flow.addEventListener("paste", (event) => {
    event.preventDefault();
    const place = selected();
    const text = (event.clipboardData?.getData("text/plain") ?? "").replace(/\r\n?/g, "\n");
    if (!place || !text) return;
    let pieces: Piece[];
    let converted = 0;
    if (clip && text === clip.text) pieces = clip.pieces.map((piece) => ({ ...piece, lines: copyLines(piece.lines) }));
    else if (!/[\n[]/.test(text)) pieces = [{ lines: [lyricLine(text.replace(/]/g, ""))] }];
    else {
      // Chords written over the words become chords on them; headings such as "Chorus" start sections.
      const plain = convertPlain(text);
      converted = plain.converted;
      pieces = plain.sections.map((section) => ({ type: section.headed ? section.type : undefined, lines: section.lines }));
    }
    if (!pieces.length) return;
    change(place.from, place.to, pieces);
    if (converted) showToast(tn(converted, "Placed the chords from {n} chord line.", "Placed the chords from {n} chord lines."));
  });

  /* ── The bar and its panel ──────────────────────────────────────────── */

  /** Where the caret (or ChordPro's cursor) is. */
  const place = () => (mode === "code" ? host.codePlace() : last);
  /** The section the caret is in, or the first. */
  const currentSection = (): Section | null => {
    const at = place();
    return (at ? findLine(doc(), at.line)?.section : null) ?? sectionsOf(doc())[0] ?? null;
  };
  const verseOf = (section: Section) => {
    const all = sectionsOf(doc());
    return all.slice(0, all.indexOf(section) + 1).filter((item) => item.type === "verse" || item.type === "none").length;
  };
  function showBar(): void {
    const section = currentSection();
    sectionButton.querySelector("span")!.textContent = section ? typeName(section.type === "none" ? "verse" : section.type) : "";
    if (well === "section") fillSection();
    placeBar();
  }
  /**
   * The bar keeps its place at the bottom with CSS, so scrolling does not
   * move it. Only a phone's keyboard lifts it, by the keyboard's height.
   */
  function placeBar(): void {
    if (bar.hidden) return;
    if (bar.classList.contains("docked")) {
      // In the header: the panel drops down from it, at its right edge.
      document.documentElement.style.scrollPaddingBottom = "";
      if (!well) return;
      const rect = bar.getBoundingClientRect();
      wellEl.style.bottom = "auto";
      wellEl.style.top = `${rect.bottom + 8}px`;
      wellEl.style.right = `${Math.max(12, document.documentElement.clientWidth - rect.right)}px`;
      wellEl.style.maxHeight = `${innerHeight - rect.bottom - 24}px`;
      return;
    }
    wellEl.style.top = "";
    wellEl.style.right = "";
    const viewport = window.visualViewport;
    const keyboard = viewport ? innerHeight - viewport.height - viewport.offsetTop : 0;
    bar.style.bottom = keyboard > 80 ? `${keyboard + 8}px` : "";
    const rect = bar.getBoundingClientRect();
    document.documentElement.style.scrollPaddingBottom = `${innerHeight - rect.top + 16}px`;
    if (!well) return;
    wellEl.style.bottom = `${innerHeight - rect.top + 8}px`;
    wellEl.style.maxHeight = `${rect.top - (viewport?.offsetTop ?? 0) - 18}px`;
  }
  dock();
  let frame = 0;
  const placeSoon = () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(placeBar);
  };
  const viewport = window.visualViewport;
  viewport?.addEventListener("resize", placeSoon);
  viewport?.addEventListener("scroll", placeSoon);
  window.addEventListener("resize", placeSoon);
  cleanups.push(() => {
    cancelAnimationFrame(frame);
    viewport?.removeEventListener("resize", placeSoon);
    viewport?.removeEventListener("scroll", placeSoon);
    window.removeEventListener("resize", placeSoon);
    document.documentElement.style.scrollPaddingBottom = "";
  });

  /** A row in the panel: a check by the type in use, or the action's symbol. */
  const row = (attrs: string, label: string, mark: IconName | null = null, extra = "") =>
    `<button type="button" class="ce-well-row${extra}" ${attrs}><span class="ce-well-check" aria-hidden="true">${mark ? icon(mark) : ""}</span>${escapeHtml(label)}</button>`;
  function fillSection(): void {
    const section = currentSection();
    if (!section) return;
    const all = sectionsOf(doc());
    const index = all.indexOf(section);
    sectionWell.innerHTML = `
      <p class="ce-well-title">${escapeHtml(section.label || autoLabel(section, verseOf(section)))}</p>
      <div class="ce-well-grid">${TYPES.map((type) => row(`data-type="${type}" role="menuitemradio" aria-checked="${section.type === type}"`, typeName(type), section.type === type ? "check" : null)).join("")}</div>
      <div class="ce-well-rule"></div>
      <div class="ce-well-grid">
        ${row('data-act="name"', section.label ? t("Rename…") : t("Name…"), "edit", " action")}
        ${row('data-act="note"', t("Add a note"), "note", " action")}
        ${row(`data-act="up"${index === 0 ? " disabled" : ""}`, t("Move up"), "arrowUp", " action")}
        ${row(`data-act="down"${index === all.length - 1 ? " disabled" : ""}`, t("Move down"), "arrowDown", " action")}
        ${row('data-act="copy"', t("Duplicate"), "copy", " action")}
        ${row('data-act="delete"', t("Delete"), "trash", " action danger")}
      </div>`;
  }
  function openWell(kind: "section" | "settings" | "field"): void {
    well = kind;
    if (kind === "section") fillSection();
    sectionWell.hidden = kind !== "section";
    settingsWell.hidden = kind !== "settings";
    nameWell.hidden = kind !== "field";
    sectionButton.setAttribute("aria-expanded", String(kind === "section"));
    cogButton.setAttribute("aria-expanded", String(kind === "settings"));
    wellEl.setAttribute("aria-label", kind === "settings" ? t("Key, capo, details and chord sound") : t("Section"));
    wellEl.hidden = false;
    wellEl.classList.remove("open");
    placeBar();
    requestAnimationFrame(() => wellEl.classList.add("open"));
  }
  function closeWell(): void {
    if (!well) return;
    if (well === "field") finishField();
    well = null;
    wellEl.hidden = true;
    wellEl.classList.remove("open");
    sectionButton.setAttribute("aria-expanded", "false");
    cogButton.setAttribute("aria-expanded", "false");
  }

  // Buttons in the bar and panel must not take focus from the words, or the caret (and a phone's keyboard) goes.
  const keepFocus = (event: PointerEvent) => {
    if ((event.target as HTMLElement).closest("button")) event.preventDefault();
  };
  bar.addEventListener("pointerdown", keepFocus);
  wellEl.addEventListener("pointerdown", keepFocus);
  bar.addEventListener("click", (event) => {
    const target = event.target as HTMLElement;
    if (target.closest(".ce-bar-save")) {
      closeWell();
      host.flush();
      host.save();
      return;
    }
    const kind = target.closest(".ce-bar-section") ? "section" : target.closest(".ce-bar-cog") ? "settings" : null;
    if (!kind) return;
    if (well === kind) closeWell();
    else {
      if (well) closeWell();
      openWell(kind);
    }
  });
  const edit = (run: () => Point | null | void) => {
    if (mode === "code") {
      run();
      host.codeChanged();
      showBar();
      return;
    }
    host.flush();
    const caret = run();
    host.remember();
    render(caret === undefined ? last : caret);
  };
  sectionWell.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("button");
    const section = currentSection();
    if (!button || !section) return;
    const song = doc();
    const all = sectionsOf(song);
    const index = all.indexOf(section);
    const swap = (other: Section) => {
      const a = song.items.indexOf(section);
      const b = song.items.indexOf(other);
      [song.items[a], song.items[b]] = [song.items[b], song.items[a]];
      spaceSections(song);
    };
    closeWell();
    if (button.dataset.type) return edit(() => { section.type = button.dataset.type!; });
    switch (button.dataset.act) {
      case "name":
        return openField(t("Section name"), section.label, autoLabel(section, verseOf(section)), (value) => edit(() => { section.label = value; }));
      case "note": {
        const note: CommentLine = { id: newId(), kind: "comment", tag: "c", text: "", orig: null };
        const here = place();
        const at = here ? section.lines.findIndex((line) => line.id === here.line) : -1;
        host.flush();
        section.lines.splice(at >= 0 ? at + 1 : section.lines.length, 0, note);
        if (mode !== "code") render(last);
        return editNote(note.id);
      }
      case "up": return edit(() => swap(all[index - 1]));
      case "down": return edit(() => swap(all[index + 1]));
      case "copy":
        return edit(() => {
          const copy: Section = { id: newId(), kind: "section", type: section.type, label: section.label, lines: copyLines(section.lines), blankBefore: 1 };
          song.items.splice(song.items.indexOf(section) + 1, 0, copy);
          const first = copy.lines.find((line) => line.kind === "lyric");
          return first ? { line: first.id, off: 0 } : null;
        });
      case "delete": {
        const name = section.label || autoLabel(section, verseOf(section));
        const first = (all[index + 1] ?? all[index - 1])?.lines.find((line) => line.kind === "lyric");
        edit(() => {
          song.items.splice(song.items.indexOf(section), 1);
          return first ? { line: first.id, off: 0 } : null;
        });
        showToast(t("Deleted {name}.", { name }), { action: { label: t("Undo"), run: host.undo } });
      }
    }
  });
  nameWell.addEventListener("click", (event) => {
    if ((event.target as HTMLElement).closest("button")) finishField(true);
  });
  const outside = (event: PointerEvent) => {
    const target = event.target as Node;
    if (well && !wellEl.contains(target) && !bar.contains(target)) closeWell();
  };
  document.addEventListener("pointerdown", outside, true);
  const escape = (event: KeyboardEvent) => {
    if (event.key !== "Escape" || !well) return;
    event.preventDefault();
    event.stopPropagation();
    if (well === "field") finishField(true, true);
    else closeWell();
  };
  document.addEventListener("keydown", escape, true);
  cleanups.push(() => {
    document.removeEventListener("pointerdown", outside, true);
    document.removeEventListener("keydown", escape, true);
  });

  function openField(label: string, value: string, placeholder: string, done: (value: string) => void): void {
    fieldDone = done;
    fieldStart = value;
    nameWell.querySelector(".ce-well-title")!.textContent = label;
    fieldInput.value = value;
    fieldInput.placeholder = placeholder;
    fieldInput.setAttribute("aria-label", label);
    openWell("field");
    fieldInput.focus({ preventScroll: true });
  }
  /** Closes the field; Escape (`cancel`) gives back what it held before. */
  function finishField(refocus = false, cancel = false): void {
    const done = fieldDone;
    fieldDone = null;
    if (well === "field") {
      well = null;
      wellEl.hidden = true;
      wellEl.classList.remove("open");
    }
    if (done) done(cancel ? fieldStart : fieldInput.value.trim());
    if (refocus && last && mode === "visual") setCaret(last);
  }
  fieldInput.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    finishField(true);
  });

  function editNote(id: string): void {
    const found = findLine(doc(), id);
    const note = found?.section.lines[found.index] as CommentLine | undefined;
    if (!found || !note) return;
    openField(t("Note"), note.text, t("Write a note"), (value) => edit(() => {
      if (value) note.text = value;
      else found.section.lines.splice(found.section.lines.indexOf(note), 1);
    }));
  }
  flow.addEventListener("click", (event) => {
    const note = (event.target as HTMLElement).closest<HTMLElement>(".ce-note");
    if (note) editNote(note.dataset.note!);
  });

  function setMode(next: EditorMode): void {
    mode = next;
    closeWell();
    sectionButton.hidden = mode === "chords";
    showBar();
  }

  /* ── Where the caret is ─────────────────────────────────────────────── */

  const onSelection = () => {
    const selection = getSelection();
    if (!selection?.rangeCount || !flow.contains(selection.anchorNode)) return;
    const point = pointAt(selection.focusNode!, selection.focusOffset);
    if (!point) return;
    // A caret between lines (on a section's name, or in the gap) goes into the nearest line.
    const holder = selection.anchorNode!.nodeType === Node.ELEMENT_NODE ? selection.anchorNode as Element : selection.anchorNode!.parentElement;
    if (selection.isCollapsed && !holder?.closest(".ce-l")) {
      setCaret(point);
      return;
    }
    const moved = currentSection() !== findLine(doc(), point.line)?.section;
    last = point;
    if (moved) showBar();
  };
  document.addEventListener("selectionchange", onSelection);
  cleanups.push(() => document.removeEventListener("selectionchange", onSelection));

  return {
    render,
    caret: () => last,
    focused: () => document.activeElement === flow,
    setMode,
    refresh: showBar,
    destroy: () => cleanups.forEach((cleanup) => cleanup()),
  };
}
