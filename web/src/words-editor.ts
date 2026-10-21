/**
 * The song editor's Visual mode: the whole song as one piece of text.
 *
 * Each section is a paragraph with its name above it, the way the song
 * reads; chords are not shown, but stay on their letters as the words
 * change. Enter on an empty line starts a new section, and Backspace at
 * the start of one joins it to the section before. A bar at the bottom
 * (over a phone's keyboard) changes the type of the section the caret is
 * in, and its menu names, moves, copies and deletes the section and adds
 * notes. Typing within a line is left to the browser and read back;
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
import { icon } from "./icons.ts";
import { escapeHtml, showToast } from "./ui.ts";

export type MenuItem = { label: string; run: () => void; disabled?: boolean; danger?: boolean } | "rule";

export interface WordsHost {
  doc(): SongDoc;
  /** Saves typing not yet in the history, before a change of its own. */
  flush(): void;
  remember(): void;
  rememberSoon(): void;
  undo(): void;
  openMenu(opener: HTMLElement, items: MenuItem[]): void;
  /** The bar with Save, which the section bar stays above when there is no keyboard. */
  dock(): HTMLElement | null;
}

export interface WordsEditor {
  /** Draws the song again; with a place, puts the caret there. */
  render(caret?: Point | null): void;
  /** Where the caret is, or was last. */
  caret(): Point | null;
  focused(): boolean;
  destroy(): void;
}

/** `plaintext-only` keeps bold and the like out, where the browser has it. */
export const editable = (() => {
  const probe = document.createElement("div");
  try { probe.contentEditable = "plaintext-only"; } catch { /* older browsers */ }
  return probe.contentEditable === "plaintext-only" ? "plaintext-only" : "true";
})();

/** The section types the bar offers, with the tag each shows as. */
export const TYPE_TAGS: Array<[string, string]> = [
  ["verse", "V"], ["chorus", "C"], ["prechorus", "PC"], ["bridge", "B"], ["intro", "I"], ["interlude", "IL"], ["outro", "O"], ["tag", "T"],
];

export function mountWordsEditor(flow: HTMLElement, host: WordsHost): WordsEditor {
  let last: Point | null = null;
  /** What was copied here last, with its chords: pasting the same text puts them back. */
  let clip: { text: string; pieces: Piece[] } | null = null;
  let fieldDone: ((value: string) => void) | null = null;
  let fieldStart = "";
  const cleanups: Array<() => void> = [];

  flow.classList.add("ce-flow");
  flow.contentEditable = editable;
  flow.setAttribute("role", "textbox");
  flow.setAttribute("aria-multiline", "true");
  flow.setAttribute("aria-label", "Song words");
  flow.spellcheck = false;

  const bar = document.createElement("div");
  bar.className = "ce-bar";
  bar.hidden = true;
  bar.innerHTML = `
    <div class="ce-bar-main">
      <div class="ce-bar-types" role="group" aria-label="Section type">${TYPE_TAGS.map(([type, tag]) =>
        `<button type="button" data-type="${type}" aria-pressed="false" aria-label="${typeName(type)}" title="${typeName(type)}">${tag}</button>`).join("")}</div>
      <button type="button" class="ce-bar-more" aria-label="More for this section" aria-haspopup="menu">${icon("more")}</button>
    </div>
    <div class="ce-bar-field" hidden>
      <input autocomplete="off" enterkeyhint="done" />
      <button type="button" class="button primary small">Done</button>
    </div>`;
  document.body.append(bar);
  cleanups.push(() => bar.remove());
  const fieldEl = bar.querySelector<HTMLElement>(".ce-bar-field")!;
  const fieldInput = fieldEl.querySelector("input")!;
  const mainEl = bar.querySelector<HTMLElement>(".ce-bar-main")!;

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
    if (line.kind === "comment") return `<div class="ce-atom ce-note" contenteditable="false" data-note="${line.id}" title="Change the note"><span class="ce-tag">Note</span>${escapeHtml(line.text) || "&nbsp;"}</div>`;
    return `<div class="ce-atom ce-raw" contenteditable="false" title="Change this line in ChordPro"><code>${escapeHtml(line.text)}</code></div>`;
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
    const bottom = (viewport ? viewport.offsetTop + viewport.height : innerHeight) - (bar.hidden ? 0 : bar.offsetHeight + 24);
    if (box.bottom > bottom || box.top < (viewport?.offsetTop ?? 0) + 60) el.scrollIntoView({ block: "center" });
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
    if (lost && !quiet) showToast(`Removed ${lost} chord${lost === 1 ? "" : "s"}.`, { action: { label: "Undo", run: host.undo } });
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
    if (converted) showToast(`Placed the chords from ${converted} chord line${converted === 1 ? "" : "s"}.`);
  });

  /* ── The section bar ────────────────────────────────────────────────── */

  const currentSection = (): Section | null => (last ? findLine(doc(), last.line)?.section ?? null : null);
  function showBar(): void {
    const section = currentSection();
    bar.querySelectorAll<HTMLButtonElement>("[data-type]").forEach((button) => {
      const on = button.dataset.type === section?.type;
      button.classList.toggle("on", on);
      button.setAttribute("aria-pressed", String(on));
    });
    placeBar();
  }
  function placeBar(): void {
    if (bar.hidden) return;
    const viewport = window.visualViewport;
    const height = viewport?.height ?? innerHeight;
    let bottom = (viewport?.offsetTop ?? 0) + height;
    // No keyboard: stay above Save.
    const dock = host.dock();
    if (innerHeight - height < 80 && dock) bottom = Math.min(bottom, dock.getBoundingClientRect().top);
    bar.style.top = `${bottom - bar.offsetHeight - 8}px`;
    document.documentElement.style.scrollPaddingBottom = `${bar.offsetHeight + 24}px`;
  }
  function setBar(open: boolean): void {
    if (bar.hidden !== open) return;
    bar.hidden = !open;
    if (open) showBar();
    else document.documentElement.style.scrollPaddingBottom = "";
  }
  const viewport = window.visualViewport;
  viewport?.addEventListener("resize", placeBar);
  viewport?.addEventListener("scroll", placeBar);
  window.addEventListener("scroll", placeBar, { passive: true });
  cleanups.push(() => {
    viewport?.removeEventListener("resize", placeBar);
    viewport?.removeEventListener("scroll", placeBar);
    window.removeEventListener("scroll", placeBar);
    document.documentElement.style.scrollPaddingBottom = "";
  });
  flow.addEventListener("focus", () => setBar(true));
  const blurred = (event: FocusEvent) => {
    const next = event.relatedTarget as Node | null;
    if (next && (bar.contains(next) || flow.contains(next))) return;
    if (!fieldEl.hidden) finishField();
    setBar(false);
  };
  flow.addEventListener("blur", blurred);
  fieldInput.addEventListener("blur", blurred);

  // Buttons in the bar must not take focus from the words, or the caret (and a phone's keyboard) goes.
  bar.addEventListener("pointerdown", (event) => {
    if ((event.target as HTMLElement).closest("button")) event.preventDefault();
  });
  bar.addEventListener("click", (event) => {
    const target = event.target as HTMLElement;
    const typeButton = target.closest<HTMLElement>("[data-type]");
    const section = currentSection();
    if (typeButton && section) {
      host.flush();
      section.type = typeButton.dataset.type!;
      host.remember();
      render(last);
    } else if (target.closest(".ce-bar-more") && section) host.openMenu(target.closest<HTMLElement>(".ce-bar-more")!, sectionMenu(section));
    else if (target.closest(".ce-bar-field button")) finishField();
  });

  function openField(label: string, value: string, placeholder: string, done: (value: string) => void): void {
    fieldDone = done;
    fieldStart = value;
    mainEl.hidden = true;
    fieldEl.hidden = false;
    fieldInput.value = value;
    fieldInput.placeholder = placeholder;
    fieldInput.setAttribute("aria-label", label);
    setBar(true);
    fieldInput.focus({ preventScroll: true });
  }
  /** Closes the field; Escape (`cancel`) gives back what it held before. */
  function finishField(refocus = false, cancel = false): void {
    const done = fieldDone;
    fieldDone = null;
    mainEl.hidden = false;
    fieldEl.hidden = true;
    if (done) done(cancel ? fieldStart : fieldInput.value.trim());
    if (refocus && last) setCaret(last);
  }
  fieldInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      finishField(true);
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      finishField(true, true);
    }
  });

  function editNote(id: string): void {
    const found = findLine(doc(), id);
    const note = found?.section.lines[found.index] as CommentLine | undefined;
    if (!found || !note) return;
    openField("Note", note.text, "Write a note", (value) => {
      host.flush();
      if (value) note.text = value;
      else found.section.lines.splice(found.section.lines.indexOf(note), 1);
      host.remember();
      render(last);
    });
  }
  flow.addEventListener("click", (event) => {
    const note = (event.target as HTMLElement).closest<HTMLElement>(".ce-note");
    if (note) editNote(note.dataset.note!);
  });

  function sectionMenu(section: Section): MenuItem[] {
    const song = doc();
    const all = sectionsOf(song);
    const index = all.indexOf(section);
    const verse = all.slice(0, index + 1).filter((item) => item.type === "verse" || item.type === "none").length;
    const edit = (run: () => Point | null | void) => () => {
      host.flush();
      const caret = run();
      host.remember();
      render(caret === undefined ? last : caret);
    };
    const move = (direction: -1 | 1) => edit(() => {
      const other = all[index + direction];
      const a = song.items.indexOf(section);
      const b = song.items.indexOf(other);
      [song.items[a], song.items[b]] = [song.items[b], song.items[a]];
      spaceSections(song);
    });
    return [
      {
        label: section.label ? `Rename “${section.label}”…` : "Name the section…",
        run: () => openField("Section name", section.label, autoLabel(section, verse), (value) => {
          host.flush();
          section.label = value;
          host.remember();
          render(last);
        }),
      },
      {
        label: "Add a note",
        run: () => {
          const note: CommentLine = { id: newId(), kind: "comment", tag: "c", text: "", orig: null };
          const at = last ? section.lines.findIndex((line) => line.id === last!.line) : -1;
          host.flush();
          section.lines.splice(at >= 0 ? at + 1 : section.lines.length, 0, note);
          render(last);
          editNote(note.id);
        },
      },
      "rule",
      { label: "Move up", disabled: index === 0, run: move(-1) },
      { label: "Move down", disabled: index === all.length - 1, run: move(1) },
      {
        label: "Duplicate",
        run: edit(() => {
          const copy: Section = { id: newId(), kind: "section", type: section.type, label: section.label, lines: copyLines(section.lines), blankBefore: 1 };
          song.items.splice(song.items.indexOf(section) + 1, 0, copy);
          const first = copy.lines.find((line) => line.kind === "lyric");
          return first ? { line: first.id, off: 0 } : null;
        }),
      },
      "rule",
      {
        label: "Delete section",
        danger: true,
        run: () => {
          const name = section.label || autoLabel(section, verse);
          const neighbour = all[index + 1] ?? all[index - 1];
          const first = neighbour?.lines.find((line) => line.kind === "lyric");
          edit(() => {
            song.items.splice(song.items.indexOf(section), 1);
            return first ? { line: first.id, off: 0 } : null;
          })();
          showToast(`Deleted ${name}.`, { action: { label: "Undo", run: host.undo } });
        },
      },
    ];
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
    destroy: () => cleanups.forEach((cleanup) => cleanup()),
  };
}
