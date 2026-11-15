import type { Cleanup, LibraryContext } from "./context.ts";
import { projectedLines } from "./projected-lines.ts";
import type { DesktopState, SongDetail } from "./types.ts";
import { errorMessage, showToast } from "./ui.ts";
import { songEditor, songPage } from "./views/songs.ts";

/**
 * The projected song as it reads on its own page, inside the follow view
 * (follow.ts): chords, key and the song's own bar, with the lines on the
 * screen marked and kept in view. Owners and leaders edit it right there,
 * key and all (Edit, or Continue editing a draft), without leaving the
 * projector: Save or Back comes back to the song on the screen. While the
 * editor is open the view stays on its song, wherever the projector goes.
 */
export interface FollowSong {
  /**
   * Shows the projection's song and marks its slide. False when there is no
   * song to show (none, or not in the library): the words show instead.
   */
  show(state: DesktopState): boolean;
  /** The editor is open: the view holds still. */
  readonly editing: boolean;
  /**
   * Opens a route in the view when it is the song shown or its editor; false
   * for any other, which leaves the projector as before.
   */
  open(route: string): boolean;
  /** Takes the song away (an editor keeps its changes as a draft). */
  clear(): void;
}

export function mountFollowSong(
  host: HTMLElement,
  context: (main: HTMLElement) => LibraryContext,
  /** The follow view draws again (the editor closed, a song could not be read). */
  redraw: () => void,
): FollowSong {
  /** The song on the page or in the editor. */
  let song: SongDetail | null = null;
  let editing = false;
  let cleanup: Cleanup | void = undefined;
  /** The song being read; one that could not be (the words show for it). */
  let loading: string | null = null;
  let unavailable: string | null = null;
  /** The projection, to mark its slide. */
  let state: DesktopState | null = null;
  /** The slide marked last, so only a new one moves the song. */
  let marked = "";
  /** Bumped by every change, so an editor that opens late is not left over a newer view. */
  let token = 0;

  /** The shell's context, with the song and its editor opening here. */
  const ctx = (): LibraryContext => {
    const base = context(host);
    return {
      ...base,
      navigate: (route, replace) => {
        if (!open(route)) base.navigate(route, replace);
      },
    };
  };

  const close = () => {
    token += 1;
    const done = cleanup;
    cleanup = undefined;
    editing = false;
    marked = "";
    if (typeof done === "function") done();
    host.replaceChildren();
  };

  const showPage = (detail: SongDetail) => {
    close();
    song = detail;
    cleanup = songPage(ctx(), detail, {
      back: "",
      go: () => undefined,
      peek: () => null,
      // Transposing or hiding the chords draws the song again: mark it again.
      drawn: () => mark(),
    }).cleanup;
  };

  const load = async (id: string) => {
    loading = id;
    try {
      const detail = await context(host).api.getSong(id);
      if (loading !== id) return;
      loading = null;
      if (!editing) showPage(detail);
    } catch {
      if (loading !== id) return;
      loading = null;
      unavailable = id;
      redraw();
    }
  };

  const edit = async (detail: SongDetail) => {
    close();
    editing = true;
    song = detail;
    const mine = token;
    redraw();
    const base = ctx();
    try {
      const result = await songEditor({ ...base, session: base.session! }, [detail.id]);
      if (mine === token) cleanup = result;
      else if (typeof result === "function") result();
    } catch (error) {
      if (mine !== token) return;
      showToast(errorMessage(error), true);
      back();
    }
  };

  /** From the editor (saved, discarded or Back) to the song on the screen, read afresh. */
  const back = () => {
    close();
    song = null;
    redraw();
  };

  const open = (route: string): boolean => {
    const match = /^#\/songs\/([^/?#]+)(\/edit)?$/.exec(route);
    if (!match || !song || match[1] !== song.id) return false;
    if (match[2]) void edit(song);
    else back();
    return true;
  };

  /** Marks the lines on the screen and, when the slide changed, brings them into the middle of the view. */
  const mark = () => {
    if (!song || editing || !state) return;
    const lines = [...host.querySelectorAll<HTMLElement>(".reader-line")];
    // The words alone: with chords shown, a line is chords over words.
    const words = lines.map((line) => line.querySelector(".ly")
      ? [...line.querySelectorAll(".ly")].map((part) => part.textContent ?? "").join("")
      : line.textContent ?? "");
    const shown = state.song_id === song.id && state.slide_index !== null
      ? projectedLines(words, state.slides, state.slide_index)
      : [];
    lines.forEach((line, index) => line.classList.toggle("on-screen", shown.includes(index)));
    const key = `${song.id}:${state.slide_index}:${shown.join(",")}`;
    if (key === marked) return;
    const first = !marked;
    marked = key;
    const scroller = host.closest<HTMLElement>(".follow-scroll");
    if (!shown.length || !scroller) return;
    const top = lines[shown[0]].getBoundingClientRect().top;
    const bottom = lines[shown[shown.length - 1]].getBoundingClientRect().bottom;
    // The song's bar covers the top of the view: the middle of what is below it.
    const view = scroller.getBoundingClientRect();
    const barBottom = host.querySelector(".app-bar")?.getBoundingClientRect().bottom ?? view.top;
    const middle = (Math.max(view.top, barBottom) + view.bottom) / 2;
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    scroller.scrollBy({ top: (top + bottom) / 2 - middle, behavior: first || reduce ? "auto" : "smooth" });
  };

  return {
    show(next) {
      if (next.song_id !== state?.song_id) unavailable = null;
      state = next;
      if (editing) return true;
      const id = next.song_id;
      if (!id || id === unavailable) return false;
      if (song?.id === id && cleanup) mark();
      // Until the new song is read, the one before stays.
      else if (loading !== id) void load(id);
      return true;
    },
    get editing() {
      return editing;
    },
    open,
    clear() {
      loading = null;
      if (song || cleanup || host.childElementCount) close();
      song = null;
    },
  };
}
