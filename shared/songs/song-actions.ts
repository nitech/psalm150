/**
 * The song's toolbar, the same in both apps: which actions there are, in
 * what order, their names and icons, and which few are always in the bar.
 * Everything else is in ⋮ (bar-menu.ts), from where an action used often
 * also comes into the bar. Change the defaults here and the web client and
 * the desktop change together.
 *
 * Canonical copy: PSA150-server/shared/songs/. The desktop repo mirrors this
 * folder at src/shared/songs/ with `bun run sync:shared`; edit it here, never
 * in the mirror.
 */
import type { BarAction } from "./bar-menu.ts";

/**
 * What a screen can do with its song now, and in what state; an action
 * left out is not offered. Each app handles the clicks (`data-action`).
 */
export interface SongActionState {
  /** The song has chords: show or hide them. */
  chords?: { shown: boolean };
  /** − key +: the key the song shows in (or the steps), and how a screen reader says it. */
  transpose?: { value: string; spoken: string };
  /** The current set (web) or active setlist (desktop): + puts the song in, ✓ takes it out. */
  set?: { name: string; inSet: boolean };
  /** Add to a set chosen from a list (another one, when there is a current set). */
  addToSet?: true;
  favorite?: { on: boolean };
  record?: true;
  /** A song without chords can borrow them from a version found online. */
  findChords?: { href?: string };
  copy?: true;
  history?: true;
  keepAwake?: { on: boolean };
  share?: true;
  edit?: { href?: string; label?: string };
  delete?: true;
}

/**
 * The actions, in the menu's order. Always in the bar: chords, the current
 * set's + / ✓ (else the favourite star), share and edit. The rest wait in ⋮;
 * Transpose (− key +) always does.
 */
export function songBarActions(state: SongActionState): BarAction[] {
  const actions: BarAction[] = [];
  if (state.chords) {
    const shown = state.chords.shown;
    actions.push({ id: "chords", label: shown ? "Hide chords" : "Show chords", icon: "chordNote", fixed: true, checked: shown, className: shown ? "on" : "" });
  }
  // − key + is too wide for a toolbar: always in ⋮, however often it is used.
  if (state.transpose) actions.push({ id: "transpose", label: "Transpose", icon: "transpose", stepper: state.transpose, menuOnly: true });
  if (state.set) {
    const { name, inSet } = state.set;
    actions.push({
      id: "set",
      label: inSet ? `In ${name}` : `Add to ${name}`,
      icon: inSet ? "check" : "plus",
      fixed: true,
      checked: inSet,
      className: inSet ? "in-set" : "",
    });
  }
  if (state.addToSet) actions.push({ id: "add-to-set", label: state.set ? "Add to another set" : "Add to a set", icon: "sets" });
  if (state.favorite) {
    const on = state.favorite.on;
    actions.push({ id: "favorite", label: on ? "Favourite" : "Make a favourite", icon: "favorites", fixed: !state.set, checked: on, className: `fav-toggle${on ? " on" : ""}` });
  }
  if (state.record) actions.push({ id: "record", label: "Record how it is played", icon: "mic" });
  if (state.findChords) actions.push({ id: "find-chords", label: "Chords from the web", icon: "chords", href: state.findChords.href });
  if (state.copy) actions.push({ id: "copy", label: "Copy the words", icon: "copy" });
  if (state.history) actions.push({ id: "history", label: "History", icon: "history" });
  if (state.keepAwake) {
    const on = state.keepAwake.on;
    actions.push({ id: "keep-awake", label: "Keep screen on", icon: "sun", checked: on, switch: true, className: on ? "on" : "" });
  }
  if (state.share) actions.push({ id: "share", label: "Share song", icon: "share", fixed: true });
  if (state.edit) actions.push({ id: "edit", label: state.edit.label ?? "Edit song", icon: "edit", href: state.edit.href, fixed: true });
  if (state.delete) actions.push({ id: "delete", label: "Delete song", icon: "trash", danger: true, menuOnly: true });
  return actions;
}
