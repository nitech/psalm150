/**
 * Tapping a chord in a song opens a sheet that shows how to play it, on the
 * instrument the person chose last (remembered on this device; a button by
 * the chord opens a menu of instruments). The ways to play it sit side by
 * side in one box, easiest first: swipe, or use ‹ ›, to go through them, and
 * ▷ beside the instrument sounds the one showing.
 */
import { playChord, type Sound } from "./chord-audio.ts";
import {
  chordNotes,
  guitarNotes,
  guitarShapes,
  noteName,
  parseChord,
  pianoShapes,
  type Chord,
  type GuitarShape,
  type PianoShape,
} from "./chord-shapes.ts";
import { announce } from "./a11y.ts";
import { icon } from "./icons.ts";
import { escapeHtml, readPreference, writePreference } from "./ui.ts";
import { openSheet } from "./views/songs.ts";

interface Instrument<Shape> {
  id: string;
  label: string;
  sound: Sound;
  shapes(chord: Chord): Shape[];
  /** "Open", "Barre, fret 3", "1st inversion". */
  shapeName(shape: Shape): string;
  draw(shape: Shape, chord: Chord): string;
  notes(shape: Shape): number[];
}

const guitar: Instrument<GuitarShape> = {
  id: "guitar",
  label: "Guitar",
  sound: "guitar",
  shapes: (chord) => guitarShapes(chord),
  shapeName: (shape) => shape.label,
  draw: drawGuitar,
  notes: guitarNotes,
};

const piano: Instrument<PianoShape> = {
  id: "piano",
  label: "Piano",
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

/** Opens the sheet for a chord a person taps in any song (`.ch` buttons from `renderSongBody`). */
export function installChordViewer(): void {
  document.addEventListener("click", (event) => {
    const button = (event.target as Element).closest?.<HTMLElement>("button.ch[data-chord]");
    if (!button) return;
    event.preventDefault();
    openChordSheet(button.dataset.chord ?? button.textContent ?? "");
  });
}

export function openChordSheet(name: string): void {
  const chord = parseChord(name);
  const subtitle = chord ? `${chord.quality[0].toUpperCase()}${chord.quality.slice(1)} · ${chordNotes(chord).join(" ")}` : "";
  // The chord, what it is, the instrument (a button with a menu, like ⋮)
  // and ▷ share one line; the shapes and their controls share one box.
  const sheet = openSheet(`<div class="chord-head">
      <div class="chord-name">
        <h2 class="chord-title">${escapeHtml(name)}</h2>
        ${subtitle ? `<p class="chord-subtitle">${escapeHtml(subtitle)}</p>` : ""}
      </div>
      ${chord ? `<div class="chord-instrument">
        <button type="button" class="button secondary" id="chord-instrument" aria-haspopup="menu" aria-expanded="false"></button>
        <div class="bar-menu" role="menu" aria-label="Instrument" hidden></div>
      </div>
      <button type="button" class="icon-button accent chord-play" id="chord-play" aria-label="Play the chord">${icon("play")}</button>` : ""}
    </div>
    <div id="chord-sheet"></div>`, { closeButton: false });
  const body = sheet.querySelector<HTMLElement>("#chord-sheet")!;
  if (!chord) {
    body.innerHTML = `<p class="muted">This chord's name is not one the app can read, so it cannot show how to play it.</p>`;
    return;
  }
  const picker = sheet.querySelector<HTMLButtonElement>("#chord-instrument")!;
  const menu = sheet.querySelector<HTMLElement>(".chord-instrument .bar-menu")!;
  const play = sheet.querySelector<HTMLButtonElement>("#chord-play")!;
  let instrument = chosenInstrument();
  let shapes: unknown[] = [];
  let current = 0;

  const render = () => {
    shapes = instrument.shapes(chord);
    current = 0;
    picker.innerHTML = `${instrument.label}${icon("down")}`;
    picker.setAttribute("aria-label", `Instrument: ${instrument.label}`);
    menu.innerHTML = INSTRUMENTS.map((item) => `<button type="button" role="menuitemradio" aria-checked="${item === instrument}" tabindex="-1" class="bar-menu-item" data-instrument="${item.id}"><span>${item.label}</span><span class="bar-menu-check" aria-hidden="true">${item === instrument ? icon("check") : ""}</span></button>`).join("");
    play.disabled = !shapes.length;
    body.innerHTML = shapes.length
      ? `<div class="chord-stage">
          <div class="chord-shapes" tabindex="0" role="group" aria-roledescription="carousel" aria-label="Ways to play ${escapeHtml(chord.name)} on ${instrument.label.toLowerCase()}">
            ${shapes.map((shape, index) => `<figure class="chord-shape chord-${instrument.id}" role="group" aria-roledescription="slide" aria-label="${index + 1} of ${shapes.length}: ${escapeHtml(instrument.shapeName(shape))}">
              ${instrument.draw(shape, chord)}
            </figure>`).join("")}
          </div>
          <p class="chord-shape-name" aria-live="polite"></p>
          <button type="button" class="icon-button ghost chord-step" data-step="-1" aria-label="Previous way">${icon("prev")}</button>
          <button type="button" class="icon-button ghost chord-step" data-step="1" aria-label="Next way">${icon("next")}</button>
          ${shapes.length > 1 ? `<div class="chord-dots" aria-hidden="true">${shapes.map(() => "<span></span>").join("")}</div>` : ""}
        </div>`
      : `<p class="muted">No way to play ${escapeHtml(chord.name)} on ${instrument.label.toLowerCase()} was found.</p>`;
    showCurrent();
  };

  const strip = () => body.querySelector<HTMLElement>(".chord-shapes");
  const showCurrent = () => {
    const name = body.querySelector<HTMLElement>(".chord-shape-name");
    if (!name) return;
    name.textContent = `${instrument.shapeName(shapes[current])} · ${current + 1}/${shapes.length}`;
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

  // On the whole sheet, so the instrument and ▷ in the head are heard too.
  const root = sheet.querySelector<HTMLElement>(".sheet-body")!;
  root.addEventListener("click", (event) => {
    const target = event.target as HTMLElement;
    if (target.closest("#chord-instrument")) {
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
      render();
      announce(next.label);
      return;
    }
    if (!target.closest(".chord-instrument")) closeMenu(false);
    const step = target.closest<HTMLElement>("[data-step]");
    if (step) goTo(current + Number(step.dataset.step));
    if (target.closest("#chord-play") && shapes.length) playChord(instrument.notes(shapes[current]), instrument.sound);
  });
  root.addEventListener("keydown", (event) => {
    const target = event.target as HTMLElement;
    if (!menu.hidden) {
      const all = items();
      const index = all.indexOf(document.activeElement as HTMLElement);
      if (event.key === "Escape") {
        // Closes the menu only, not the sheet.
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
  });
  // A swipe settles on a shape: follow it.
  body.addEventListener("scroll", (event) => {
    const row = event.target as HTMLElement;
    if (!row.classList?.contains("chord-shapes") || !row.clientWidth) return;
    const index = Math.round(row.scrollLeft / row.clientWidth);
    if (index !== current && index >= 0 && index < shapes.length) {
      current = index;
      showCurrent();
    }
  }, true);
  render();
  announce(`${chord.name}, ${instrument.label}`);
}

/* ── Drawings ─────────────────────────────────────────────────────────── */

const STRING_GAP = 28;
const FRET_GAP = 34;
const LEFT = 36;
const TOP = 44;

/** A chord box: strings left to right low to high, the nut or the first fret at the top. */
function drawGuitar(shape: GuitarShape, chord: Chord): string {
  const pressed = shape.frets.filter((fret) => fret > 0);
  const highest = pressed.length ? Math.max(...pressed) : 0;
  const first = highest <= 4 ? 1 : Math.min(...pressed);
  const rows = 4;
  const right = LEFT + STRING_GAP * 5;
  const bottom = TOP + FRET_GAP * rows;
  const y = (fret: number) => TOP + (fret - first + 0.5) * FRET_GAP;
  const x = (string: number) => LEFT + string * STRING_GAP;
  const flats = /b/.test(chord.rootName) || /b/.test(chord.bassName ?? "");
  const parts: string[] = [];
  for (let row = 0; row <= rows; row++) parts.push(`<line class="fret" x1="${LEFT}" x2="${right}" y1="${TOP + row * FRET_GAP}" y2="${TOP + row * FRET_GAP}"/>`);
  if (first === 1) parts.push(`<rect class="nut" x="${LEFT - 1}" y="${TOP - 5}" width="${right - LEFT + 2}" height="6" rx="1"/>`);
  else parts.push(`<text class="fret-number" x="${LEFT - 12}" y="${y(first) + 5}" text-anchor="end">${first}</text>`);
  for (let string = 0; string < 6; string++) parts.push(`<line class="string" x1="${x(string)}" x2="${x(string)}" y1="${TOP}" y2="${bottom}"/>`);
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
    if (fret >= 0) parts.push(`<text class="note" x="${x(string)}" y="${bottom + 22}" text-anchor="middle">${noteNameFor(chord, 40 + [0, 5, 10, 15, 19, 24][string] + fret, flats)}</text>`);
  });
  const spoken = shape.frets.map((fret, string) => `${["low E", "A", "D", "G", "B", "high E"][string]} ${fret < 0 ? "not played" : fret === 0 ? "open" : `fret ${fret}`}`).join(", ");
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
      blacks.push(`<rect class="key black${on ? " on" : ""}" x="${x}" y="0" width="14" height="74" rx="2"/>`);
      if (on) blacks.push(`<text class="key-label on-black" x="${x + 7}" y="64" text-anchor="middle">${label}</text>`);
    } else {
      const x = whiteIndex * whiteWidth;
      whites.push(`<rect class="key white${on ? " on" : ""}" x="${x}" y="0" width="${whiteWidth}" height="${height}" rx="3"/>`);
      if (on) whites.push(`<text class="key-label" x="${x + whiteWidth / 2}" y="${height - 10}" text-anchor="middle">${label}</text>`);
      whiteIndex++;
    }
  }
  const width = whiteIndex * whiteWidth;
  const spoken = notes.map((midi) => noteNameFor(chord, midi, flats)).join(", ");
  return `<svg class="chord-diagram piano" viewBox="-1 -1 ${width + 2} ${height + 2}" role="img" aria-label="Keys ${escapeHtml(spoken)}${shape.bass === null ? "" : ", the first with the left hand"}">${whites.join("")}${blacks.join("")}</svg>`;
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
