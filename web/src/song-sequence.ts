/**
 * Going through a list's songs from one song page to the next. A tap on a
 * song in a list marked `data-song-list` (search results, the set editor)
 * remembers the list's songs from the one tapped onwards; the song page then
 * swipes (phones) or steps (Previous / Next) through them. Back from the song
 * tapped first goes to the list, never to a song above it.
 */

export interface SongStep {
  id: string;
  title: string;
}

interface Sequence {
  songs: SongStep[];
  /** The song tapped in the list; the sequence starts here. */
  start: number;
  /** The list's route, to go back to. */
  back: string;
  /** The song shown now (a song may be in a set twice). */
  current: number;
}

let sequence: Sequence | null = null;

const SONG_LINK = /^#\/songs\/([0-9a-f-]{36})$/i;

document.addEventListener("click", (event) => {
  const link = (event.target as HTMLElement).closest<HTMLAnchorElement>("a[href^='#/songs/']");
  const list = link?.closest<HTMLElement>("[data-song-list]");
  if (!link || !list) {
    // Any other way into a song (a link, the address bar) has no sequence.
    if (link) sequence = null;
    return;
  }
  const links = [...list.querySelectorAll<HTMLAnchorElement>("a[href^='#/songs/']")]
    .filter((candidate) => SONG_LINK.test(candidate.getAttribute("href") ?? ""));
  const songs = links.map((candidate) => ({
    id: SONG_LINK.exec(candidate.getAttribute("href")!)![1],
    title: candidate.dataset.title ?? candidate.querySelector("strong")?.textContent?.trim() ?? candidate.textContent?.trim() ?? "",
  }));
  const start = links.indexOf(link);
  sequence = start < 0 ? null : { songs, start, back: location.hash, current: start };
}, { capture: true });

/**
 * Where song `id` sits in the remembered list: the songs before and after
 * it (`previous` is null at the song tapped first, where Back goes to the
 * list), and the list's route. Null when the song was not opened from a list.
 */
export function songNeighbours(id: string): { previous: SongStep | null; next: SongStep | null; back: string } | null {
  if (!sequence) return null;
  if (sequence.songs[sequence.current]?.id !== id) {
    sequence.current = sequence.songs.findIndex((song, position) => position >= sequence!.start && song.id === id);
  }
  const index = sequence.current;
  if (index < 0) return null;
  return {
    previous: index > sequence.start ? sequence.songs[index - 1] : null,
    next: sequence.songs[index + 1] ?? null,
    back: sequence.back,
  };
}

/** Moves to the next (1) or previous (-1) song, before opening it. */
export function stepSequence(step: 1 | -1): void {
  if (sequence) sequence.current += step;
}

/** Forgets the list, as when going back to it. */
export function endSequence(): void {
  sequence = null;
}
