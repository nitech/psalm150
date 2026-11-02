/**
 * Tapping a chord in a song shows how to play it, on the instrument the
 * person chose last (remembered on this device; a button by the chord opens
 * a menu of instruments): in a panel beside or under the song where the app
 * has room for one, so the words stay in view and scroll, else in a sheet.
 * The ways to play it sit side by side in one box, easiest first: swipe, or
 * use ‹ ›, to go through them, and ▷ beside the instrument sounds the one
 * showing. Tapping a string or a key in the drawing sounds that one note.
 */
import { playChord, playNote, preloadSound, type Sound } from "./chord-audio.ts";
import {
  chordNotes,
  guitarNotes,
  GUITAR_TUNING,
  guitarShapes,
  noteName,
  parseChord,
  pianoShapes,
  type Chord,
  type GuitarShape,
  type PianoShape,
} from "./chord-shapes.ts";
import { announce } from "./a11y.ts";
import { t } from "./i18n.ts";
import { icon } from "./icon.ts";
import { escapeHtml, readPreference, writePreference } from "./format.ts";
import { closeSheet, openSheet } from "./sheet.ts";

interface Instrument<Shape> {
  id: string;
  /** Its name in the reader's language. */
  label(): string;
  /** "Ways to play G on guitar", whole, so it reads well in every language. */
  ways(chord: string): string;
  /** "No way to play G on guitar was found." */
  none(chord: string): string;
  sound: Sound;
  shapes(chord: Chord): Shape[];
  /** "Open", "Barre, fret 3", "1st inversion". */
  shapeName(shape: Shape): string;
  draw(shape: Shape, chord: Chord): string;
  notes(shape: Shape): number[];
}

const guitar: Instrument<GuitarShape> = {
  id: "guitar",
  label: () => t("Guitar"),
  ways: (chord) => t("Ways to play {chord} on guitar", { chord }),
  none: (chord) => t("No way to play {chord} on guitar was found.", { chord }),
  sound: "guitar",
  shapes: (chord) => guitarShapes(chord),
  shapeName: (shape) => shape.label,
  draw: drawGuitar,
  notes: guitarNotes,
};

const piano: Instrument<PianoShape> = {
  id: "piano",
  label: () => t("Piano"),
  ways: (chord) => t("Ways to play {chord} on piano", { chord }),
  none: (chord) => t("No way to play {chord} on piano was found.", { chord }),
  sound: "piano",
  shapes: pianoShapes,
  shapeName: (shape) => shape.label,
  draw: drawPiano,
  notes: (shape) => (shape.bass === null ? shape.notes : [shape.bass, ...shape.notes]),
};

/** In the order the switch shows them. More instruments go here. */
const INSTRUMENTS = [guitar, piano] as Instrument<unknown>[];

function chosenInstrument(): Instrument<unknown> {
  const id = readPreference("instrument");
  return INSTRUMENTS.find((instrument) => instrument.id === id) ?? INSTRUMENTS[0];
}

/** The instruments, for the song editor's chord sound: the same choice as this sheet's. */
export const instruments = (): Array<{ id: string; label: string; chosen: boolean }> => {
  const chosen = chosenInstrument();
  return INSTRUMENTS.map((instrument) => ({ id: instrument.id, label: instrument.label(), chosen: instrument === chosen }));
};

export function chooseInstrument(id: string): void {
  const next = INSTRUMENTS.find((instrument) => instrument.id === id);
  if (!next) return;
  writePreference("instrument", next.id);
  preloadSound(next.sound);
}

export function preloadChosenSound(): void {
  preloadSound(chosenInstrument().sound);
}

/**
 * Sounds a chord by its name on the chosen instrument, the easiest way
 * first; a name the app cannot read is silent, and the same chord still
 * ringing rings on.
 */
export function soundChord(name: string): void {
  const chord = parseChord(name);
  if (!chord) return;
  const instrument = chosenInstrument();
  const [shape] = instrument.shapes(chord);
  if (shape !== undefined) playChord(instrument.notes(shape), instrument.sound, true);
}

/**
 * Shows how to play a chord a person taps in any song (`.ch` buttons from
 * `renderSongBody`): in the app's chord panel (`.chord-dock`) when it has
 * one with room, so the song stays in view and scrolls beside it, else in a
 * sheet. Escape in the panel closes it.
 */
export function installChordViewer(): void {
  document.addEventListener("click", (event) => {
    const button = (event.target as Element).closest?.<HTMLElement>("button.ch[data-chord]");
    if (!button) return;
    event.preventDefault();
    showChord(button.dataset.chord ?? button.textContent ?? "", button);
  });
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || !docked || event.defaultPrevented) return;
    if (!docked.dock.contains(event.target as Node)) return;
    event.preventDefault();
    closeChordDock(true);
  });
}

/**
 * The chord panel in use: the element the app gave, the chord button it was
 * opened from (focus goes back there when it closes), and how to stop it.
 */
let docked: { dock: HTMLElement; opener: HTMLElement | null; stop: () => void; resize: ResizeObserver } | null = null;

/**
 * The chord in the panel when there is one with room, else in a sheet. The
 * app places an empty `<aside class="chord-dock" hidden>` beside or under
 * the song and says in CSS where it goes: `--chord-dock: none` (say, on a
 * phone held sideways) means no room, and the sheet opens instead. A chord
 * tapped inside a dialog always opens a sheet.
 */
export function showChord(name: string, from?: HTMLElement | null): void {
  const dock = from?.closest("dialog") ? null : document.querySelector<HTMLElement>(".chord-dock");
  if (dock && openDock(dock, name, from ?? null)) return;
  openChordSheet(name);
}

function openDock(dock: HTMLElement, name: string, opener: HTMLElement | null): boolean {
  if (docked && (docked.dock !== dock || !dock.isConnected)) closeChordDock(false);
  const wasOpen = !dock.hidden;
  dock.hidden = false;
  if (getComputedStyle(dock).getPropertyValue("--chord-dock").trim() === "none" || !dock.getClientRects().length) {
    if (wasOpen) closeChordDock(false);
    dock.hidden = true;
    return false;
  }
  docked?.stop();
  docked?.resize.disconnect();
  dock.setAttribute("aria-label", t("How to play {chord}", { chord: name }));
  dock.innerHTML = `<div class="chord-dock-inner">${chordMarkup(name, true)}</div>`;
  const stop = bindChord(dock, name, () => closeChordDock(true));
  // Pages leave room under the song for a panel along the bottom.
  const resize = new ResizeObserver(() => {
    document.documentElement.style.setProperty("--chord-dock-h", `${Math.round(dock.getBoundingClientRect().height)}px`);
  });
  resize.observe(dock);
  docked = { dock, opener, stop, resize };
  markShown(name);
  return true;
}

/** Closes the chord panel, if open; `refocus` returns focus to the chord it showed. */
export function closeChordDock(refocus = false): void {
  if (!docked) return;
  const { dock, opener, stop, resize } = docked;
  docked = null;
  stop();
  resize.disconnect();
  dock.hidden = true;
  dock.replaceChildren();
  document.documentElement.style.removeProperty("--chord-dock-h");
  markShown(null);
  if (refocus && opener?.isConnected) opener.focus();
}

/** The chord in the panel is marked wherever it is played in the song. */
function markShown(name: string | null): void {
  document.querySelectorAll<HTMLElement>("button.ch.shown").forEach((button) => button.classList.remove("shown"));
  if (!name) return;
  document.querySelectorAll<HTMLElement>("button.ch[data-chord]").forEach((button) => {
    if (button.dataset.chord === name) button.classList.add("shown");
  });
}

/** Opens the sheet for a chord: a phone's bottom sheet, a dialog on a wide screen. */
export function openChordSheet(name: string): void {
  const sheet = openSheet(chordMarkup(name, false), { closeButton: false });
  bindChord(sheet.querySelector<HTMLElement>(".sheet-body")!, name, () => closeSheet(sheet));
}

/**
 * The chord, what it is, the instrument (a button with a menu, like ⋮) and
 * ▷ on one line; under them one box with the ways to play it. In the panel
 * a × closes it.
 */
function chordMarkup(name: string, closable: boolean): string {
  const chord = parseChord(name);
  const subtitle = chord ? `${chord.quality[0].toUpperCase()}${chord.quality.slice(1)} · ${chordNotes(chord).join(" ")}` : "";
  return `<div class="chord-head">
      <div class="chord-name">
        <h2 class="chord-title">${escapeHtml(name)}</h2>
        ${subtitle ? `<p class="chord-subtitle">${escapeHtml(subtitle)}</p>` : ""}
      </div>
      ${chord ? `<div class="chord-instrument">
        <button type="button" class="button secondary" data-chord-instrument aria-haspopup="menu" aria-expanded="false"></button>
        <div class="bar-menu" role="menu" aria-label="${t("Instrument")}" hidden></div>
      </div>
      <button type="button" class="icon-button accent chord-play" data-chord-play aria-label="${t("Play the chord")}" title="${t("Play the chord")}">${icon("play")}</button>` : ""}
      ${closable ? `<button type="button" class="icon-button ghost chord-close" data-chord-close aria-label="${t("Close")}" title="${t("Close (Esc)")}">${icon("close")}</button>` : ""}
    </div>
    <div class="chord-body">${chord ? "" : `<p class="muted">${t("This chord's name is not one the app can read, so it cannot show how to play it.")}</p>`}</div>`;
}

/**
 * Brings a chord's markup to life inside `root`: the instrument menu, ▷,
 * the shapes to swipe or step through, and a string or key to tap. Returns
 * a function that stops listening (the panel is used again for the next chord).
 */
function bindChord(root: HTMLElement, name: string, close: () => void): () => void {
  const listening = new AbortController();
  const signal = listening.signal;
  root.querySelector("[data-chord-close]")?.addEventListener("click", close, { signal });
  const chord = parseChord(name);
  if (!chord) return () => listening.abort();
  const body = root.querySelector<HTMLElement>(".chord-body")!;
  const picker = root.querySelector<HTMLButtonElement>("[data-chord-instrument]")!;
  const menu = root.querySelector<HTMLElement>(".chord-instrument .bar-menu")!;
  const play = root.querySelector<HTMLButtonElement>("[data-chord-play]")!;
  let instrument = chosenInstrument();
  let shapes: unknown[] = [];
  let current = 0;

  const render = () => {
    shapes = instrument.shapes(chord);
    current = 0;
    picker.innerHTML = `${instrument.label()}${icon("down")}`;
    picker.setAttribute("aria-label", t("Instrument: {instrument}", { instrument: instrument.label() }));
    menu.innerHTML = INSTRUMENTS.map((item) => `<button type="button" role="menuitemradio" aria-checked="${item === instrument}" tabindex="-1" class="bar-menu-item" data-instrument="${item.id}"><span>${item.label()}</span><span class="bar-menu-check" aria-hidden="true">${item === instrument ? icon("check") : ""}</span></button>`).join("");
    play.disabled = !shapes.length;
    body.innerHTML = shapes.length
      ? `<div class="chord-stage">
          <div class="chord-shapes" tabindex="0" role="group" aria-roledescription="carousel" aria-label="${instrument.ways(escapeHtml(chord.name))}">
            ${shapes.map((shape, index) => `<figure class="chord-shape chord-${instrument.id}" role="group" aria-roledescription="slide" aria-label="${t("{index} of {count}: {name}", { index: index + 1, count: shapes.length, name: escapeHtml(instrument.shapeName(shape)) })}">
              ${instrument.draw(shape, chord)}
            </figure>`).join("")}
          </div>
          <p class="chord-shape-name" aria-live="polite"></p>
          <button type="button" class="icon-button ghost chord-step" data-step="-1" aria-label="${t("Previous way")}">${icon("prev")}</button>
          <button type="button" class="icon-button ghost chord-step" data-step="1" aria-label="${t("Next way")}">${icon("next")}</button>
          ${shapes.length > 1 ? `<div class="chord-dots" aria-hidden="true">${shapes.map(() => "<span></span>").join("")}</div>` : ""}
        </div>`
      : `<p class="muted">${instrument.none(escapeHtml(chord.name))}</p>`;
    showCurrent();
  };

  const strip = () => body.querySelector<HTMLElement>(".chord-shapes");
  const showCurrent = () => {
    const label = body.querySelector<HTMLElement>(".chord-shape-name");
    if (!label) return;
    label.textContent = `${instrument.shapeName(shapes[current])} · ${current + 1}/${shapes.length}`;
    body.querySelectorAll<HTMLElement>(".chord-dots span").forEach((dot, index) => dot.classList.toggle("on", index === current));
    body.querySelector<HTMLButtonElement>("[data-step='-1']")!.disabled = current === 0;
    body.querySelector<HTMLButtonElement>("[data-step='1']")!.disabled = current === shapes.length - 1;
  };
  const goTo = (index: number) => {
    const row = strip();
    if (!row) return;
    current = Math.max(0, Math.min(shapes.length - 1, index));
    row.scrollTo({ left: current * row.clientWidth, behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    showCurrent();
  };

  // The instrument menu opens and closes like ⋮ (bar-menu.ts): arrows move
  // through it, Escape and a tap elsewhere close it.
  const items = () => [...menu.querySelectorAll<HTMLElement>(".bar-menu-item")];
  const openMenu = () => {
    menu.hidden = false;
    picker.setAttribute("aria-expanded", "true");
    (items().find((item) => item.getAttribute("aria-checked") === "true") ?? items()[0])?.focus();
  };
  const closeMenu = (refocus: boolean) => {
    if (menu.hidden) return;
    menu.hidden = true;
    picker.setAttribute("aria-expanded", "false");
    if (refocus) picker.focus();
  };

  root.addEventListener("click", (event) => {
    const target = event.target as HTMLElement;
    if (target.closest("[data-chord-instrument]")) {
      if (menu.hidden) openMenu();
      else closeMenu(false);
      return;
    }
    const choice = target.closest<HTMLElement>("[data-instrument]");
    if (choice) {
      closeMenu(true);
      const next = INSTRUMENTS.find((item) => item.id === choice.dataset.instrument);
      if (!next || next === instrument) return;
      instrument = next;
      writePreference("instrument", next.id);
      preloadSound(next.sound);
      render();
      announce(next.label());
      return;
    }
    if (!target.closest(".chord-instrument")) closeMenu(false);
    // A string or key in the drawing: its own note.
    const note = target.closest<SVGElement>("[data-midi]");
    if (note) {
      playNote(Number(note.dataset.midi), instrument.sound);
      const svg = note.closest("svg")!;
      flash(note.dataset.string ? svg.querySelector<SVGElement>(`.string[data-string="${note.dataset.string}"]`) : note);
      return;
    }
    const step = target.closest<HTMLElement>("[data-step]");
    if (step) goTo(current + Number(step.dataset.step));
    if (target.closest("[data-chord-play]") && shapes.length) playChord(instrument.notes(shapes[current]), instrument.sound);
  }, { signal });
  root.addEventListener("keydown", (event) => {
    const target = event.target as HTMLElement;
    if (!menu.hidden) {
      const all = items();
      const index = all.indexOf(document.activeElement as HTMLElement);
      if (event.key === "Escape") {
        // Closes the menu only, not the sheet or the panel.
        event.preventDefault();
        event.stopPropagation();
        closeMenu(true);
      } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        all[(index + (event.key === "ArrowDown" ? 1 : -1) + all.length) % all.length]?.focus();
      } else if (event.key === "Tab") {
        closeMenu(false);
      }
      return;
    }
    if (target.closest(".chord-shapes") && (event.key === "ArrowRight" || event.key === "ArrowLeft")) {
      goTo(current + (event.key === "ArrowRight" ? 1 : -1));
      event.preventDefault();
    }
  }, { signal });
  // A swipe settles on a shape: follow it.
  body.addEventListener("scroll", (event) => {
    const row = event.target as HTMLElement;
    if (!row.classList?.contains("chord-shapes") || !row.clientWidth) return;
    const index = Math.round(row.scrollLeft / row.clientWidth);
    if (index !== current && index >= 0 && index < shapes.length) {
      current = index;
      showCurrent();
    }
  }, { capture: true, signal });
  preloadSound(instrument.sound);
  render();
  announce(`${chord.name}, ${instrument.label()}`);
  return () => listening.abort();
}

/** Lights a string or key for a moment as it sounds. */
function flash(element: SVGElement | null): void {
  if (!element) return;
  element.classList.remove("struck");
  // Restart the animation when the same one is tapped again.
  void element.getBoundingClientRect();
  element.classList.add("struck");
  element.addEventListener("animationend", () => element.classList.remove("struck"), { once: true });
}

/* ── Drawings ─────────────────────────────────────────────────────────── */

const STRING_GAP = 28;
const FRET_GAP = 34;
const LEFT = 36;
const TOP = 44;

/**
 * A chord box: strings left to right low to high, named under it from the
 * tuning, the nut or the first fret at the top.
 */
function drawGuitar(shape: GuitarShape): string {
  const pressed = shape.frets.filter((fret) => fret > 0);
  const highest = pressed.length ? Math.max(...pressed) : 0;
  const first = highest <= 4 ? 1 : Math.min(...pressed);
  const rows = 4;
  const right = LEFT + STRING_GAP * 5;
  const bottom = TOP + FRET_GAP * rows;
  const y = (fret: number) => TOP + (fret - first + 0.5) * FRET_GAP;
  const x = (string: number) => LEFT + string * STRING_GAP;
  const parts: string[] = [];
  for (let row = 0; row <= rows; row++) parts.push(`<line class="fret" x1="${LEFT}" x2="${right}" y1="${TOP + row * FRET_GAP}" y2="${TOP + row * FRET_GAP}"/>`);
  if (first === 1) parts.push(`<rect class="nut" x="${LEFT - 1}" y="${TOP - 5}" width="${right - LEFT + 2}" height="6" rx="1"/>`);
  else parts.push(`<text class="fret-number" x="${LEFT - 12}" y="${y(first) + 5}" text-anchor="end">${first}</text>`);
  for (let string = 0; string < 6; string++) parts.push(`<line class="string" data-string="${string}" x1="${x(string)}" x2="${x(string)}" y1="${TOP}" y2="${bottom}"/>`);
  if (shape.barre) {
    const { fret, from, to } = shape.barre;
    parts.push(`<rect class="dot" x="${x(from) - 11}" y="${y(fret) - 11}" width="${x(to) - x(from) + 22}" height="22" rx="11"/>`);
    parts.push(`<text class="finger" x="${(x(from) + x(to)) / 2}" y="${y(fret) + 5}" text-anchor="middle">1</text>`);
  }
  shape.frets.forEach((fret, string) => {
    if (fret < 0) parts.push(`<text class="mute" x="${x(string)}" y="${TOP - 14}" text-anchor="middle">×</text>`);
    else if (fret === 0) parts.push(`<circle class="open" cx="${x(string)}" cy="${TOP - 19}" r="6"/>`);
    else if (!(shape.barre && fret === shape.barre.fret && string >= shape.barre.from && string <= shape.barre.to)) {
      parts.push(`<circle class="dot" cx="${x(string)}" cy="${y(fret)}" r="11"/>`);
      if (shape.fingers[string]) parts.push(`<text class="finger" x="${x(string)}" y="${y(fret) + 5}" text-anchor="middle">${shape.fingers[string]}</text>`);
    }
  });
  // Under each string its name, from the tuning (E A D G B E), dim where it is not played.
  GUITAR_TUNING.forEach((open, string) => {
    parts.push(`<text class="note${shape.frets[string] < 0 ? " unplayed" : ""}" x="${x(string)}" y="${bottom + 22}" text-anchor="middle">${noteName(open, false)}</text>`);
  });
  // Over everything, a strip per string that is played, to tap it alone.
  shape.frets.forEach((fret, string) => {
    if (fret >= 0) parts.push(`<rect class="hit" data-string="${string}" data-midi="${GUITAR_TUNING[string] + fret}" x="${x(string) - STRING_GAP / 2}" y="${TOP - 30}" width="${STRING_GAP}" height="${bottom - TOP + 64}"/>`);
  });
  const spoken = shape.frets.map((fret, string) => {
    const note = noteName(GUITAR_TUNING[string], false);
    if (fret < 0) return t("{note} string not played", { note });
    return fret === 0 ? t("{note} string open", { note }) : t("{note} string fret {fret}", { note, fret });
  }).join(", ");
  return `<svg class="chord-diagram" viewBox="0 0 ${right + 30} ${bottom + 34}" role="img" aria-label="${escapeHtml(spoken)}">${parts.join("")}</svg>`;
}

/** The keys around the chord, with its keys marked and named. */
function drawPiano(shape: PianoShape, chord: Chord): string {
  const notes = shape.bass === null ? shape.notes : [shape.bass, ...shape.notes];
  const isBlack = (midi: number) => [1, 3, 6, 8, 10].includes(midi % 12);
  // One white key of room on each side of the chord.
  let from = Math.min(...notes) - 1;
  while (isBlack(from)) from--;
  let to = Math.max(...notes) + 1;
  while (isBlack(to)) to++;
  const flats = /b/.test(chord.rootName) || /b/.test(chord.bassName ?? "");
  const whiteWidth = 24;
  const height = 120;
  const whites: string[] = [];
  const blacks: string[] = [];
  let whiteIndex = 0;
  for (let midi = from; midi <= to; midi++) {
    const black = isBlack(midi);
    const on = notes.includes(midi);
    const label = on ? noteNameFor(chord, midi, flats) : "";
    if (black) {
      const x = whiteIndex * whiteWidth - 7;
      blacks.push(`<rect class="key black${on ? " on" : ""}" data-midi="${midi}" x="${x}" y="0" width="14" height="74" rx="2"/>`);
      if (on) blacks.push(`<text class="key-label on-black" x="${x + 7}" y="64" text-anchor="middle">${label}</text>`);
    } else {
      const x = whiteIndex * whiteWidth;
      whites.push(`<rect class="key white${on ? " on" : ""}" data-midi="${midi}" x="${x}" y="0" width="${whiteWidth}" height="${height}" rx="3"/>`);
      if (on) whites.push(`<text class="key-label" x="${x + whiteWidth / 2}" y="${height - 10}" text-anchor="middle">${label}</text>`);
      whiteIndex++;
    }
  }
  const width = whiteIndex * whiteWidth;
  const spoken = notes.map((midi) => noteNameFor(chord, midi, flats)).join(", ");
  return `<svg class="chord-diagram piano" viewBox="-1 -1 ${width + 2} ${height + 2}" role="img" aria-label="${shape.bass === null ? t("Keys {notes}", { notes: escapeHtml(spoken) }) : t("Keys {notes}, the first with the left hand", { notes: escapeHtml(spoken) })}">${whites.join("")}${blacks.join("")}</svg>`;
}

/** A note's name as the chord spells it (Bb in Gm, A# in F#), else by the chord's accidentals. */
function noteNameFor(chord: Chord, midi: number, flats: boolean): string {
  const pitch = midi % 12;
  const spelled = chordNotes(chord).find((name) => {
    const index = "C D EF G A B".indexOf(name[0]);
    const shift = [...name.slice(1)].reduce((sum, sign) => sum + (sign === "#" ? 1 : sign === "b" ? -1 : 0), 0);
    return (index + shift + 12) % 12 === pitch;
  });
  return spelled ?? noteName(pitch, flats);
}
