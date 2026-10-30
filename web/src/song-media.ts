/**
 * How a song is played, at the top of its page: a pill per recording (who
 * made it, Play/Pause, its length) and a pill to its YouTube video. Everyone
 * signed in plays the recordings; leaders and owners record more (⋮ until
 * there is one, then the + pill) and remove them.
 *
 * The video is song metadata, `{meta: youtube <link>}`, set in the editor's
 * details, so public library visitors see it too.
 *
 * An `<audio>` element cannot send the bearer token, so a recording plays
 * from a play link the server hands out (six hours, no token), streamed:
 * it starts at once and seeks without reading the whole file.
 */
import { announce } from "./a11y.ts";
import type { LibraryContext } from "./context.ts";
import { icon } from "./icons.ts";
import type { SongRecording } from "./types.ts";
import { closeSheet, openSheet } from "./views/songs.ts";
import { clock, errorMessage, escapeHtml, initials, relativeDate, setFormBusy, showToast } from "./ui.ts";
import { holdScreen } from "./wake-lock.ts";
import { songVideo } from "./youtube.ts";

/** A recording stops by itself after this long, well inside the server's 40 MB. */
const MAX_RECORDING_MS = 30 * 60 * 1000;
/** Types to record in, best first: Chrome and Firefox take WebM, Safari MP4. */
const RECORDING_TYPES = ["audio/webm;codecs=opus", "audio/mp4", "audio/ogg;codecs=opus", "audio/webm"];

interface Song {
  id: string;
  title: string;
  chordpro: string;
}

/** Whether this browser can record from a microphone at all (HTTPS only). */
export function canRecord(): boolean {
  return typeof MediaRecorder !== "undefined" && Boolean(navigator.mediaDevices?.getUserMedia);
}

export interface SongMedia {
  /** Opens the recorder (⋮ → Record). */
  record(): void;
  /** Stops playing and lets go of what it holds. */
  cleanup(): void;
}

/**
 * Fills `holder` with the song's pills, and keeps them up to date as leaders
 * record and remove. `changed` hears whether the song now has recordings, so
 * the page can show Record in ⋮ only while it has none.
 */
export function mountSongMedia(
  ctx: LibraryContext,
  song: Song,
  holder: HTMLElement,
  changed: (hasRecordings: boolean) => void,
): SongMedia {
  const video = songVideo(song.chordpro);
  let recordings: SongRecording[] = [];
  /** The recording in the player under the pills, if any. */
  let selected: string | null = null;
  /** Play links asked for this visit, by recording id. */
  const urls = new Map<string, string>();
  let gone = false;

  const audio = document.createElement("audio");
  audio.preload = "metadata";
  audio.controls = true;
  audio.className = "media-audio";
  showLength(audio);

  const who = (recording: SongRecording) => recording.created_by_name ?? "Someone";

  const pillTime = (recording: SongRecording) => {
    if (recording.id === selected && audio.currentTime > 0) return clock(audio.currentTime * 1000);
    return recording.duration_ms !== null ? clock(recording.duration_ms) : "";
  };

  const pillLabel = (recording: SongRecording, playing: boolean) => `${playing ? "Pause" : "Play"} ${recording.title}, by ${who(recording)}`;

  const recordingPill = (recording: SongRecording) => {
    const playing = recording.id === selected && !audio.paused;
    return `<button type="button" class="media-pill${recording.id === selected ? " selected" : ""}" data-pill="${recording.id}" aria-pressed="${playing}" aria-label="${escapeHtml(pillLabel(recording, playing))}" title="${escapeHtml(`${recording.title} · ${who(recording)}`)}">
      <span class="pill-avatar" aria-hidden="true">${escapeHtml(initials(who(recording)) || "?")}</span>
      ${icon(playing ? "pause" : "play")}
      <span class="pill-time">${escapeHtml(pillTime(recording))}</span>
    </button>`;
  };

  /** The player under the pills, for the selected recording. */
  const playerHead = (recording: SongRecording) => {
    const details = [recording.created_by_name ?? "", relativeDate(recording.created_at)].filter(Boolean).map(escapeHtml).join(" · ");
    return `<span class="row-main"><strong>${escapeHtml(recording.title)}</strong><small>${details}</small></span>
      ${ctx.canEdit ? `<button type="button" class="icon-button small ghost" data-media-act="remove" aria-label="${escapeHtml(`Delete ${recording.title}`)}" title="Delete">${icon("trash")}</button>` : ""}
      <button type="button" class="icon-button small ghost" data-media-act="close" aria-label="Close the player" title="Close">${icon("close")}</button>`;
  };

  const draw = () => {
    const current = recordings.find((recording) => recording.id === selected);
    const addPill = ctx.canEdit && canRecord() && recordings.length
      ? `<button type="button" class="media-pill add" data-media-act="record" aria-label="Record another" title="Record another">${icon("plus")}${icon("mic")}</button>`
      : "";
    const videoPill = video
      ? `<a class="media-pill video" href="${escapeHtml(video.url)}" target="_blank" rel="noopener noreferrer" aria-label="Watch on YouTube (opens YouTube)">${icon("video")}<span>YouTube</span></a>`
      : "";
    holder.hidden = !recordings.length && !video;
    const html = `${videoPill}${recordings.map(recordingPill).join("")}${addPill}`;
    const pills = holder.querySelector(".media-pills");
    if (pills) pills.innerHTML = html;
    else holder.innerHTML = `<div class="media-pills" role="group" aria-label="How it is played">${html}</div><div class="media-player" hidden><div class="media-player-head"></div></div>`;
    const player = holder.querySelector<HTMLElement>(".media-player")!;
    player.hidden = !current;
    if (current) {
      player.querySelector(".media-player-head")!.innerHTML = playerHead(current);
      if (audio.parentElement !== player) player.append(audio);
    }
    drawPill();
  };

  /** Only the selected pill's icon, time and progress change while it plays. */
  function drawPill(): void {
    const recording = recordings.find((candidate) => candidate.id === selected);
    const pill = recording && holder.querySelector<HTMLElement>(`[data-pill="${recording.id}"]`);
    if (!recording || !pill) return;
    const playing = !audio.paused;
    pill.setAttribute("aria-pressed", String(playing));
    pill.setAttribute("aria-label", pillLabel(recording, playing));
    pill.querySelector(".icon")!.outerHTML = icon(playing ? "pause" : "play");
    pill.querySelector(".pill-time")!.textContent = pillTime(recording);
    const length = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : (recording.duration_ms ?? 0) / 1000;
    pill.style.setProperty("--progress", length ? `${Math.min(100, (audio.currentTime / length) * 100)}%` : "0%");
  }
  for (const event of ["play", "pause", "timeupdate", "ended", "durationchange"]) audio.addEventListener(event, drawPill);

  const report = () => changed(recordings.length > 0);

  const load = async () => {
    try {
      recordings = await ctx.api.songRecordings(song.id);
    } catch {
      // The song reads well without them; a reader offline just sees none.
      return;
    }
    if (gone) return;
    draw();
    report();
  };

  const play = async (recordingId: string) => {
    if (selected === recordingId) {
      if (audio.paused) void audio.play().catch(() => undefined);
      else audio.pause();
      return;
    }
    audio.pause();
    selected = recordingId;
    draw();
    try {
      let url = urls.get(recordingId);
      if (!url) {
        url = (await ctx.api.recordingLink(song.id, recordingId)).url;
        urls.set(recordingId, url);
      }
      if (gone || selected !== recordingId) return;
      audio.src = url;
      await audio.play().catch(() => undefined);
    } catch (error) {
      showToast(errorMessage(error), true);
    }
  };

  // The link ran out (six hours, or the server restarted): ask once for a new one.
  let renewed = "";
  audio.addEventListener("error", () => {
    const recordingId = selected;
    if (!recordingId || renewed === recordingId || gone || !audio.getAttribute("src")) return;
    renewed = recordingId;
    void ctx.api.recordingLink(song.id, recordingId).then((link) => {
      urls.set(recordingId, link.url);
      if (selected !== recordingId) return;
      audio.src = link.url;
      void audio.play().catch(() => undefined);
    }).catch(() => showToast("The recording could not be played.", true));
  });

  const close = () => {
    audio.pause();
    const was = selected;
    selected = null;
    draw();
    if (was) holder.querySelector<HTMLElement>(`[data-pill="${was}"]`)?.focus();
  };

  const remove = () => {
    const recording = recordings.find((candidate) => candidate.id === selected);
    if (!recording || !confirm(`Delete the recording “${recording.title}”? It cannot be brought back.`)) return;
    void ctx.run(async () => {
      await ctx.api.deleteRecording(song.id, recording.id);
      audio.pause();
      audio.removeAttribute("src");
      selected = null;
      recordings = recordings.filter((candidate) => candidate.id !== recording.id);
      draw();
      report();
      holder.querySelector<HTMLElement>(".media-pill")?.focus();
      showToast("Recording deleted.");
    });
  };

  const record = () => openRecorder(ctx, song, (recording) => {
    recordings.push(recording);
    draw();
    report();
    holder.querySelector<HTMLElement>(`[data-pill="${recording.id}"]`)?.focus();
  });

  const onClick = (event: Event) => {
    const target = event.target as HTMLElement;
    const pill = target.closest<HTMLElement>("[data-pill]");
    if (pill) {
      void play(String(pill.dataset.pill));
      return;
    }
    switch (target.closest<HTMLElement>("[data-media-act]")?.dataset.mediaAct) {
      case "record": record(); break;
      case "remove": remove(); break;
      case "close": close(); break;
    }
  };
  holder.addEventListener("click", onClick);
  draw();
  if (ctx.session) void load();

  return {
    record,
    cleanup() {
      gone = true;
      holder.removeEventListener("click", onClick);
      audio.pause();
      audio.removeAttribute("src");
    },
  };
}

/**
 * Chrome and Firefox record WebM without its length in it, so a player
 * streaming one shows no length and cannot seek. Seeking far past the end
 * makes it read the end and learn the length; then it goes back to the
 * start.
 */
function showLength(audio: HTMLAudioElement): void {
  audio.addEventListener("loadedmetadata", () => {
    if (Number.isFinite(audio.duration)) return;
    const found = () => {
      if (!Number.isFinite(audio.duration)) return;
      audio.removeEventListener("durationchange", found);
      audio.currentTime = 0;
    };
    audio.addEventListener("durationchange", found);
    audio.currentTime = Number.MAX_SAFE_INTEGER;
  });
}

/**
 * The recorder: Start and Stop, then listen to it, name it and save it, or
 * record again. The microphone is let go as soon as the recording stops or
 * the sheet closes.
 */
export function openRecorder(ctx: LibraryContext, song: Pick<Song, "id" | "title">, saved: (recording: SongRecording) => void): void {
  const sheet = openSheet(`<h2>Record how it is played</h2>
    <p class="muted">${escapeHtml(song.title)}. Everyone in the church can listen to it afterwards.</p>
    <div class="recorder stack">
      <p class="recorder-time" id="rec-time" role="timer" aria-label="Recorded time">0:00</p>
      <button type="button" class="button primary wide" id="rec-toggle">${icon("mic")}Start recording</button>
      <audio class="recorder-preview" id="rec-preview" controls hidden></audio>
      <form id="rec-form" class="stack" hidden>
        <label>Title<input name="title" maxlength="120" value="Recording" autocomplete="off" required /></label>
        <p class="form-message" role="status"></p>
        <div class="inline-actions wrap">
          <button class="button primary grow" type="submit">${icon("save")}Save</button>
          <button class="button secondary" type="button" id="rec-again">Record again</button>
        </div>
      </form>
    </div>`);
  const toggle = sheet.querySelector<HTMLButtonElement>("#rec-toggle")!;
  const time = sheet.querySelector<HTMLElement>("#rec-time")!;
  const preview = sheet.querySelector<HTMLAudioElement>("#rec-preview")!;
  const form = sheet.querySelector<HTMLFormElement>("#rec-form")!;

  let stream: MediaStream | null = null;
  let recorder: MediaRecorder | null = null;
  let recording: Blob | null = null;
  let previewUrl = "";
  let startedAt = 0;
  let durationMs = 0;
  let ticker = 0;
  let limit = 0;
  let releaseScreen: (() => void) | null = null;

  const letGo = () => {
    window.clearInterval(ticker);
    window.clearTimeout(limit);
    stream?.getTracks().forEach((track) => track.stop());
    stream = null;
    releaseScreen?.();
    releaseScreen = null;
  };

  const showStart = (label: string) => {
    toggle.innerHTML = `${icon("mic")}${label}`;
    toggle.classList.remove("recording");
  };

  const start = async () => {
    toggle.disabled = true;
    try {
      // Music, not speech: no echo cancelling, noise removal or levelling.
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      });
    } catch (error) {
      toggle.disabled = false;
      const denied = error instanceof DOMException && (error.name === "NotAllowedError" || error.name === "SecurityError");
      showToast(denied ? "The microphone is blocked. Allow it for this site in the browser's settings." : "No microphone was found.", true);
      return;
    }
    const mimeType = RECORDING_TYPES.find((type) => MediaRecorder.isTypeSupported(type));
    recorder = new MediaRecorder(stream, { ...(mimeType ? { mimeType } : {}), audioBitsPerSecond: 128_000 });
    const chunks: Blob[] = [];
    recorder.addEventListener("dataavailable", (event) => { if (event.data.size) chunks.push(event.data); });
    recorder.addEventListener("stop", () => {
      durationMs = Date.now() - startedAt;
      letGo();
      recording = new Blob(chunks, { type: recorder?.mimeType || mimeType || "audio/webm" });
      if (!sheet.open) return;
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      previewUrl = URL.createObjectURL(recording);
      preview.src = previewUrl;
      preview.hidden = false;
      form.hidden = false;
      toggle.hidden = true;
      announce(`Recorded ${clock(durationMs)}. Listen to it, then save it.`);
      form.querySelector<HTMLInputElement>("[name='title']")?.focus();
    });
    recorder.start(1000);
    startedAt = Date.now();
    releaseScreen = holdScreen();
    ticker = window.setInterval(() => { time.textContent = clock(Date.now() - startedAt); }, 250);
    limit = window.setTimeout(() => recorder?.state === "recording" && recorder.stop(), MAX_RECORDING_MS);
    time.textContent = "0:00";
    time.classList.add("live");
    toggle.innerHTML = `${icon("stop")}Stop`;
    toggle.classList.add("recording");
    toggle.disabled = false;
    announce("Recording");
  };

  toggle.addEventListener("click", () => {
    if (recorder?.state === "recording") {
      time.classList.remove("live");
      recorder.stop();
    } else {
      void start();
    }
  });

  sheet.querySelector("#rec-again")?.addEventListener("click", () => {
    preview.pause();
    preview.hidden = true;
    form.hidden = true;
    recording = null;
    toggle.hidden = false;
    showStart("Start recording");
    void start();
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!recording) return;
    const title = String(new FormData(form).get("title")).trim() || "Recording";
    setFormBusy(form, true);
    try {
      const result = await ctx.api.addRecording(song.id, recording, title, durationMs);
      recording = null;
      closeSheet(sheet);
      saved(result);
      showToast("Recording saved.");
    } catch (error) {
      setFormBusy(form, false);
      form.querySelector<HTMLElement>(".form-message")!.textContent = errorMessage(error);
    }
  });

  sheet.addEventListener("close", () => {
    if (recorder?.state === "recording") recorder.stop();
    letGo();
    preview.pause();
    if (previewUrl) URL.revokeObjectURL(previewUrl);
  });
}
