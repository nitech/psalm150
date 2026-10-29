/**
 * Recordings and videos under a song: how it is played. Everyone signed in
 * lists them and plays the recordings; leaders and owners record one with
 * the phone's microphone and link YouTube videos.
 *
 * Recordings are read with the token and played from a `blob:` URL, since
 * an `<audio>` element cannot send the bearer token itself.
 */
import { announce } from "./a11y.ts";
import type { LibraryContext } from "./context.ts";
import { icon } from "./icons.ts";
import type { SongMedia, SongRecording, SongVideo } from "./types.ts";
import { closeSheet, openSheet } from "./views/songs.ts";
import { errorMessage, escapeHtml, relativeDate, setFormBusy, showToast } from "./ui.ts";
import { holdScreen } from "./wake-lock.ts";

/** A recording stops by itself after this long, well inside the server's 40 MB. */
const MAX_RECORDING_MS = 30 * 60 * 1000;
/** Types to record in, best first: Chrome and Firefox take WebM, Safari MP4. */
const RECORDING_TYPES = ["audio/webm;codecs=opus", "audio/mp4", "audio/ogg;codecs=opus", "audio/webm"];

interface Song {
  id: string;
  title: string;
}

/** `m:ss`, or `h:mm:ss` from an hour. */
export function clock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = String(total % 60).padStart(2, "0");
  return hours ? `${hours}:${String(minutes).padStart(2, "0")}:${seconds}` : `${minutes}:${seconds}`;
}

/** Whether this browser can record from a microphone at all (HTTPS only). */
export function canRecord(): boolean {
  return typeof MediaRecorder !== "undefined" && Boolean(navigator.mediaDevices?.getUserMedia);
}

/**
 * Fills `holder` with the song's recordings and videos, and keeps it up to
 * date as leaders add and remove them. Returns a cleanup that stops playback.
 */
export function mountSongMedia(ctx: LibraryContext, song: Song, holder: HTMLElement): () => void {
  let media: SongMedia = { recordings: [], videos: [] };
  /** Audio read this visit, by recording id. */
  const urls = new Map<string, string>();
  let gone = false;

  const recordingRow = (recording: SongRecording) => {
    const details = [recording.duration_ms !== null ? clock(recording.duration_ms) : "", recording.created_by_name ?? "", relativeDate(recording.created_at)]
      .filter(Boolean).map(escapeHtml).join(" · ");
    return `<li class="media-item" data-recording="${recording.id}">
      <div class="list-row">
        <button type="button" class="icon-button small accent" data-media-act="play" aria-label="${escapeHtml(`Play ${recording.title}`)}">${icon("play")}</button>
        <span class="row-main"><strong>${escapeHtml(recording.title)}</strong><small>${details}</small></span>
        ${ctx.canEdit ? `<button type="button" class="icon-button small ghost" data-media-act="remove" aria-label="${escapeHtml(`Remove ${recording.title}`)}">${icon("trash")}</button>` : ""}
      </div>
    </li>`;
  };

  const videoRow = (video: SongVideo) => {
    const title = video.title || "YouTube video";
    const details = ["YouTube", video.start_seconds ? `from ${clock(video.start_seconds * 1000)}` : "", video.created_by_name ?? ""]
      .filter(Boolean).map(escapeHtml).join(" · ");
    return `<li class="media-item" data-video="${video.id}">
      <div class="list-row">
        <a class="row-link media-link" href="${escapeHtml(video.url)}" target="_blank" rel="noopener noreferrer">
          <span class="media-icon">${icon("video")}</span>
          <span class="row-main"><strong>${escapeHtml(title)}</strong><small>${details}</small></span>
          <span class="sr-only">(opens YouTube)</span>
        </a>
        ${ctx.canEdit ? `<button type="button" class="icon-button small ghost" data-media-act="remove" aria-label="${escapeHtml(`Remove ${title}`)}">${icon("trash")}</button>` : ""}
      </div>
    </li>`;
  };

  const draw = () => {
    const empty = !media.recordings.length && !media.videos.length;
    // Readers see the section only when there is something in it.
    if (empty && !ctx.canEdit) {
      holder.hidden = true;
      holder.innerHTML = "";
      return;
    }
    holder.hidden = false;
    holder.innerHTML = `<h2 class="list-heading" id="song-media-heading">How it is played</h2>
      ${empty ? `<p class="muted">Record how you play it, or link a video of it, for whoever plays it next.</p>` : `<ul class="list">${media.recordings.map(recordingRow).join("")}${media.videos.map(videoRow).join("")}</ul>`}
      ${ctx.canEdit ? `<div class="inline-actions wrap">
        ${canRecord() ? `<button type="button" class="button secondary" data-media-act="record">${icon("mic")}Record</button>` : ""}
        <button type="button" class="button secondary" data-media-act="add-video">${icon("video")}YouTube video</button>
      </div>` : ""}`;
  };

  const load = async () => {
    try {
      media = await ctx.api.songMedia(song.id);
    } catch {
      // The song reads well without it; a reader offline just sees no recordings.
      return;
    }
    if (!gone) draw();
  };

  const play = async (item: HTMLElement, recordingId: string) => {
    const open = item.querySelector("audio");
    if (open) {
      if (open.paused) void open.play();
      else open.pause();
      return;
    }
    const button = item.querySelector<HTMLButtonElement>("[data-media-act='play']")!;
    button.disabled = true;
    try {
      let url = urls.get(recordingId);
      if (!url) {
        url = URL.createObjectURL(await ctx.api.recordingAudio(song.id, recordingId));
        urls.set(recordingId, url);
      }
      if (gone || !item.isConnected) return;
      const audio = document.createElement("audio");
      audio.controls = true;
      audio.preload = "auto";
      audio.src = url;
      audio.className = "media-player";
      // One at a time: starting one pauses the others.
      audio.addEventListener("play", () => {
        holder.querySelectorAll("audio").forEach((other) => { if (other !== audio) other.pause(); });
      });
      item.append(audio);
      await audio.play().catch(() => undefined);
      audio.focus();
    } catch (error) {
      showToast(errorMessage(error), true);
    } finally {
      button.disabled = false;
    }
  };

  const remove = (item: HTMLElement) => {
    const recordingId = item.dataset.recording;
    const videoId = item.dataset.video;
    const title = item.querySelector(".row-main strong")?.textContent ?? "it";
    if (!confirm(recordingId ? `Remove the recording “${title}”? It cannot be brought back.` : `Remove the link to “${title}”?`)) return;
    void ctx.run(async () => {
      if (recordingId) {
        await ctx.api.deleteRecording(song.id, recordingId);
        media.recordings = media.recordings.filter((recording) => recording.id !== recordingId);
      } else if (videoId) {
        await ctx.api.deleteVideo(song.id, videoId);
        media.videos = media.videos.filter((video) => video.id !== videoId);
      }
      draw();
      holder.querySelector<HTMLElement>("#song-media-heading")?.setAttribute("tabindex", "-1");
      holder.querySelector<HTMLElement>("#song-media-heading")?.focus();
      showToast(recordingId ? "Recording removed." : "Video link removed.");
    });
  };

  const onClick = (event: Event) => {
    const button = (event.target as HTMLElement).closest<HTMLElement>("[data-media-act]");
    if (!button) return;
    const item = button.closest<HTMLElement>(".media-item");
    switch (button.dataset.mediaAct) {
      case "play":
        if (item?.dataset.recording) void play(item, item.dataset.recording);
        break;
      case "remove":
        if (item) remove(item);
        break;
      case "record":
        openRecorder(ctx, song, (recording) => {
          media.recordings.push(recording);
          draw();
        });
        break;
      case "add-video":
        openVideoSheet(ctx, song, (video) => {
          media.videos.push(video);
          draw();
        });
        break;
    }
  };
  holder.addEventListener("click", onClick);
  void load();

  return () => {
    gone = true;
    holder.removeEventListener("click", onClick);
    holder.querySelectorAll("audio").forEach((audio) => audio.pause());
    for (const url of urls.values()) URL.revokeObjectURL(url);
  };
}

/**
 * The recorder: Start and Stop, then listen to it, name it and save it, or
 * record again. The microphone is let go as soon as the recording stops or
 * the sheet closes.
 */
export function openRecorder(ctx: LibraryContext, song: Song, saved: (recording: SongRecording) => void): void {
  const sheet = openSheet(`<h2>Record how it is played</h2>
    <p class="muted">${escapeHtml(song.title)}. Everyone in the church can listen to it afterwards.</p>
    <div class="recorder stack">
      <p class="recorder-time" id="rec-time" role="timer" aria-label="Recorded time">0:00</p>
      <button type="button" class="button primary wide" id="rec-toggle">${icon("mic")}Start recording</button>
      <audio class="media-player" id="rec-preview" controls hidden></audio>
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

/** Links a YouTube video: its link and, if wanted, a title. */
export function openVideoSheet(ctx: LibraryContext, song: Song, saved: (video: SongVideo) => void): void {
  const sheet = openSheet(`<h2>Link a YouTube video</h2>
    <p class="muted">${escapeHtml(song.title)}. Paste the link from YouTube's Share button; a start time in it is kept.</p>
    <form id="video-form" class="stack">
      <label>Link<input name="url" type="url" inputmode="url" required placeholder="https://youtu.be/…" autocomplete="off" /></label>
      <label>Title (optional)<input name="title" maxlength="120" placeholder="Such as: Live, in D" autocomplete="off" /></label>
      <p class="form-message" role="status"></p>
      <button class="button primary wide" type="submit">${icon("link")}Add the video</button>
    </form>`);
  const form = sheet.querySelector<HTMLFormElement>("#video-form")!;
  const field = form.querySelector<HTMLInputElement>("[name='url']")!;
  field.focus();
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = new FormData(form);
    setFormBusy(form, true);
    try {
      const video = await ctx.api.addVideo(song.id, String(data.get("url")).trim(), String(data.get("title")).trim());
      closeSheet(sheet);
      saved(video);
      showToast("Video linked.");
    } catch (error) {
      setFormBusy(form, false);
      form.querySelector<HTMLElement>(".form-message")!.textContent = errorMessage(error);
      field.focus();
    }
  });
}
