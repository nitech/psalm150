/**
 * The online song search offered when a library search finds nothing. It
 * never starts by itself: the song list offers it and the operator asks
 * for it (the button, or Enter in the search field).
 */
export type OnlineSearch =
  | { status: "none" }
  /** Nothing in the library matches `query`; the list offers to look online. */
  | { status: "offer"; query: string }
  | { status: "searching"; query: string }
  /** Finished; the results (maybe none) are in the console's `webResults`. */
  | { status: "found"; query: string }
  | { status: "failed"; query: string; message: string };

export const NO_ONLINE_SEARCH: OnlineSearch = { status: "none" };

/** Queries shorter than this find too much to be worth a search. */
export const ONLINE_SEARCH_MIN_CHARS = 3;

/**
 * The online search state after the library search for `query` finished.
 * `eligible`: online search is on, the view is Search, the query is text
 * (not `#key`) and long enough, and the library found nothing.
 * A search for the same query keeps its state; a new query starts again
 * at the offer.
 */
export function onlineSearchAfter(current: OnlineSearch, query: string, eligible: boolean): OnlineSearch {
  if (!eligible) return NO_ONLINE_SEARCH;
  if (current.status !== "none" && current.query === query) return current;
  return { status: "offer", query };
}
