/**
 * Chords from the web for a song of ours that has none: search online,
 * pick a version, see our own words with its chords laid over them
 * ([chord-match.ts](../../../shared/chord-match.ts)), and save only when it looks right.
 * Nothing changes until Save, which makes a new revision (so it can be
 * undone like any edit).
 */
import { announce, keepFocus, setTitle } from "../../../shared/songs/a11y.ts";
import { ApiError } from "../api.ts";
import { keySteps, matchChords, type ChordMatch, type KeyChoice } from "../../../shared/chord-match.ts";
import { emptyState, pageHead, type AppContext, type Cleanup } from "../context.ts";
import { icon } from "../icons.ts";
import { prepareSong, renderSongBody } from "../song-render.ts";
import type { OnlineSong } from "../types.ts";
import { errorMessage, escapeHtml, showToast, transposeLabel } from "../ui.ts";
import { t, tn } from "../../../shared/songs/i18n.ts";

interface Candidate {
  song: OnlineSong;
  match: ChordMatch;
}

export async function findChords(ctx: AppContext, [songId]: string[]): Promise<Cleanup> {
  const song = await ctx.api.getSong(songId);
  setTitle(t("Chords for {title}", { title: song.title }), t("Songs"));
  const back = `#/songs/${song.id}`;
  if (!ctx.canEdit) {
    ctx.navigate(back, true);
    return () => undefined;
  }

  ctx.main.innerHTML = `${pageHead({ title: t("Chords from the web"), subtitle: song.title, back })}
  <form class="chords-search" id="chords-search" role="search">
    <div class="search-field">${icon("search")}<input type="search" id="chords-query" value="${escapeHtml(song.title)}" aria-label="${t("Search online for")}" enterkeyhint="search" autocomplete="off" /></div>
    <button type="submit" class="button secondary">${t("Search")}</button>
  </form>
  <div id="chords-results"></div>`;

  const form = ctx.main.querySelector<HTMLFormElement>("#chords-search")!;
  const input = ctx.main.querySelector<HTMLInputElement>("#chords-query")!;
  const results = ctx.main.querySelector<HTMLElement>("#chords-results")!;
  let abort: AbortController | null = null;
  let candidates: Candidate[] | null = null;
  let chosen = 0;
  /** Keep the song's key (move the chords) or take the chords' key. */
  let keyChoice: KeyChoice = "song";
  let saving = false;

  /** The chosen version laid over the song, in the chosen key. */
  const current = (): ChordMatch => matchChords(song.chordpro, candidates![chosen].song.chordpro, keyChoice);

  /**
   * The key line: the saved song's `{key}` always fits its chords. When the
   * song's key and the chords' key differ, the leader picks which one stays.
   */
  const keyPart = (match: ChordMatch): string => {
    const { songKey, onlineKey } = match;
    const strong = (key: string) => `<strong>${escapeHtml(key)}</strong>`;
    if (!onlineKey) {
      return `<p class="chord-key-note">${songKey
        ? t("The key of these chords cannot be told, so they are kept as written. Check that they fit the song's key, {key}.", { key: strong(songKey) })
        : t("The key of these chords cannot be told, so they are kept as written.")}</p>`;
    }
    if (!songKey) return `<p class="chord-key-note">${t("The song has no key yet. It gets {key}, the key these chords are in.", { key: strong(onlineKey) })}</p>`;
    const steps = keySteps(onlineKey, songKey) ?? 0;
    if (!steps) return `<p class="chord-key-note">${t("The chords are in the song's key, {key}.", { key: strong(songKey) })}</p>`;
    const option = (value: KeyChoice, label: string) =>
      `<button type="button" role="radio" class="${keyChoice === value ? "on" : ""}" aria-checked="${keyChoice === value}" data-key-choice="${value}">${label}</button>`;
    return `<p class="chord-key-note">${t("The song is in {songKey}, these chords are in {chordsKey}.", { songKey: strong(songKey), chordsKey: strong(onlineKey) })}</p>
      <div class="segmented chord-key-choice" role="radiogroup" aria-label="${t("Key to save the song in")}">
        ${option("song", t("Keep {key} (chords {steps})", { key: escapeHtml(songKey), steps: transposeLabel(steps) }))}
        ${option("online", t("Change the song to {key}", { key: escapeHtml(onlineKey) }))}
      </div>`;
  };

  const render = () => {
    if (abort) {
      results.innerHTML = `<div class="empty-state online-state" aria-busy="true">
        <span class="spinner" aria-hidden="true"></span>
        <h2>${t("Searching online…")}</h2>
        <p>${t("Looking through chord sites. This takes a few seconds.")}</p>
      </div>`;
      return;
    }
    if (!candidates) return;
    if (!candidates.length || !candidates.some((c) => c.match.matched)) {
      results.innerHTML = emptyState(
        candidates.length ? t("No chords fit these words") : t("Nothing found online"),
        candidates.length
          ? t("The versions found online have other words. Try the original title, or a line from the song.")
          : t("Try the full title, or a line from the lyrics."),
      );
      return;
    }
    const found = candidates[chosen].song;
    const match = current();
    const notes = match.matched < match.lines ? t("Lines without a match get no chords.") : "";
    results.innerHTML = `
      <h2 class="list-heading">${t("Found online")}</h2>
      <div class="list chord-sources" role="radiogroup" aria-label="${t("Version to take the chords from")}">
        ${candidates.map((candidate, index) => `<button type="button" class="list-row${index === chosen ? " on" : ""}" role="radio" aria-checked="${index === chosen}" data-candidate="${index}"${candidate.match.matched ? "" : " disabled"}>
          <span class="row-main"><strong>${escapeHtml(candidate.song.title)}</strong>
            <small>${escapeHtml([candidate.song.artist, candidate.song.source_name].filter(Boolean).join(" · "))}</small></span>
          <span class="row-key">${tn(candidate.match.lines, "{matched} of {n} line", "{matched} of {n} lines", { matched: candidate.match.matched })}</span>
        </button>`).join("")}
      </div>
      <div class="chord-preview-head">
        <p>${tn(match.lines, "<strong>Chords on {matched} of {n} line</strong>, from {source}.", "<strong>Chords on {matched} of {n} lines</strong>, from {source}.", { matched: match.matched, source: `<a href="${escapeHtml(found.source_url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(found.source_name)}</a>` })} ${notes} ${t("Your words stay as they are.")}</p>
        <button type="button" class="button primary" id="save-chords"${saving ? " disabled" : ""}>${icon("check")}${t("Save chords")}</button>
        <div class="chord-key">${keyPart(match)}</div>
      </div>
      ${renderSongBody(prepareSong(match.chordpro, 0), { chords: true })}`;
  };

  const search = async () => {
    const query = input.value.trim();
    if (query.length < 3) {
      showToast(t("Search for at least 3 characters."), true);
      return;
    }
    abort?.abort();
    const mine = new AbortController();
    abort = mine;
    candidates = null;
    render();
    announce(t("Searching online"));
    try {
      const songs = await ctx.api.searchOnline(query, mine.signal);
      if (abort !== mine) return;
      candidates = songs
        .map((found) => ({ song: found, match: matchChords(song.chordpro, found.chordpro) }))
        .sort((a, b) => b.match.matched - a.match.matched);
      chosen = 0;
      const best = candidates[0]?.match;
      announce(best?.matched ? tn(best.lines, "Chords on {matched} of {n} line", "Chords on {matched} of {n} lines", { matched: best.matched }) : t("No chords found for these words"));
    } catch (error) {
      if (abort !== mine) return;
      if (error instanceof ApiError && error.status === 401) return ctx.signOut();
      candidates = null;
      showToast(errorMessage(error), true);
    } finally {
      if (abort === mine) {
        abort = null;
        keepFocus(results, render);
      }
    }
  };

  const save = async () => {
    if (!candidates || saving) return;
    saving = true;
    keepFocus(results, render);
    try {
      await ctx.api.updateSong(song.id, song.revision_id, current().chordpro);
      showToast(t("Saved the chords."));
      ctx.navigate(back, true);
    } catch (error) {
      saving = false;
      keepFocus(results, render);
      if (error instanceof ApiError && error.status === 401) return ctx.signOut();
      showToast(
        error instanceof ApiError && error.status === 409
          ? t("Someone changed this song after you opened it. Go back and try again.")
          : errorMessage(error),
        true,
      );
    }
  };

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    void search();
  });
  results.addEventListener("click", (event) => {
    const target = event.target as HTMLElement;
    const pick = target.closest<HTMLElement>("[data-candidate]");
    if (pick) {
      chosen = Number(pick.dataset.candidate);
      keepFocus(results, render);
      return;
    }
    const key = target.closest<HTMLElement>("[data-key-choice]");
    if (key) {
      keyChoice = key.dataset.keyChoice as KeyChoice;
      keepFocus(results, render);
      return;
    }
    if (target.closest("#save-chords")) void save();
  });

  // The user asked for chords: start at once with the title.
  void search();
  return () => abort?.abort();
}
