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
import { setRecording } from "./chord-audio.ts";
import { clock, errorMessage, escapeHtml, initials, relativeDate, setFormBusy } from "./format.ts";
import { confirmAction, holdScreen, showToast } from "./host.ts";
import { icon } from "./icon.ts";
import { closeSheet, openSheet } from "./sheet.ts";
import { songVideo } from "./youtube.ts";

/** A recording of how a song is played; its audio is read on its own. */
export interface SongRecording {
  id: string;
  song_id: string;
  title: string;
  /** As the browser recorded it, such as `audio/webm;codecs=opus`. */
  content_type: string;
  duration_ms: number | null;
  byte_size: number;
  /** The person, or the desktop, that recorded it. */
  created_by_name: string | null;
  created_at: string;
}

/** A token-free URL that plays one recording for a while. */
export interface RecordingLink {
  url: string;
  expires_at: string;
}

/**
 * A song's recordings on the song server, reached the app's own way (the
 * web client with its session, the desktop through its device token).
 */
export interface Recordings {
  /** Whether this viewer may record and delete. */
  canEdit: boolean;
  /** Oldest first; empty when this viewer cannot list them. */
  list(songId: string): Promise<SongRecording[]>;
  add(songId: string, audio: Blob, durationMs: number | null): Promise<SongRecording>;
  /** A URL the page's `<audio>` can play without a token. */
  link(songId: string, recordingId: string): Promise<RecordingLink>;
  remove(songId: string, recordingId: string): Promise<void>;
}

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
  store: Recordings,
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
      ${store.canEdit ? `<button type="button" class="icon-button small ghost" data-media-act="remove" aria-label="${escapeHtml(`Delete ${recording.title}`)}" title="Delete">${icon("trash")}</button>` : ""}
      <button type="button" class="icon-button small ghost" data-media-act="close" aria-label="Close the player" title="Close">${icon("close")}</button>`;
  };

  const draw = () => {
    const current = recordings.find((recording) => recording.id === selected);
    const addPill = store.canEdit && canRecord() && recordings.length
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
      recordings = await store.list(song.id);
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
        url = (await store.link(song.id, recordingId)).url;
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
    void store.link(song.id, recordingId).then((link) => {
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

  const remove = async () => {
    const recording = recordings.find((candidate) => candidate.id === selected);
    if (!recording || !(await confirmAction(`Delete the recording “${recording.title}”? It cannot be brought back.`))) return;
    try {
      await store.remove(song.id, recording.id);
      audio.pause();
      audio.removeAttribute("src");
      selected = null;
      recordings = recordings.filter((candidate) => candidate.id !== recording.id);
      draw();
      report();
      holder.querySelector<HTMLElement>(".media-pill")?.focus();
      showToast("Recording deleted.");
    } catch (error) {
      showToast(errorMessage(error), true);
    }
  };

  const record = () => openRecorder(store, song, (recording) => {
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
      case "remove": void remove(); break;
      case "close": close(); break;
    }
  };
  holder.addEventListener("click", onClick);
  draw();
  void load();

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

/** Bars in the recorder's waveform, newest on the right. */
const WAVE_BARS = 40;
/** How often a new bar comes in. */
const WAVE_STEP_MS = 70;
/** The count before recording starts: 3, 2, 1, this long each. */
const COUNT_FROM = 3;
const COUNT_STEP_MS = 800;

/**
 * The microphone's loudness as a scrolling row of bars, so whoever records
 * sees that it hears them, during the count and while recording. Returns a
 * stop function that lets go of the audio context.
 */
function showWave(stream: MediaStream, wave: HTMLElement): () => void {
  const bars = [...wave.children] as HTMLElement[];
  const AudioContextType = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextType) return () => undefined;
  const context = new AudioContextType();
  void context.resume().catch(() => undefined);
  const analyser = context.createAnalyser();
  analyser.fftSize = 1024;
  context.createMediaStreamSource(stream).connect(analyser);
  const samples = new Uint8Array(analyser.fftSize);
  const levels: number[] = Array(bars.length).fill(0);
  let frame = 0;
  let last = 0;
  const tick = (now: number) => {
    frame = requestAnimationFrame(tick);
    if (now - last < WAVE_STEP_MS) return;
    last = now;
    analyser.getByteTimeDomainData(samples);
    let sum = 0;
    for (const sample of samples) sum += ((sample - 128) / 128) ** 2;
    // Loudness, lifted so quiet playing still shows, at most 1.
    levels.push(Math.min(1, Math.sqrt(Math.sqrt(sum / samples.length)) * 1.6));
    levels.shift();
    bars.forEach((bar, index) => { bar.style.transform = `scaleY(${Math.max(0.12, levels[index])})`; });
  };
  frame = requestAnimationFrame(tick);
  return () => {
    cancelAnimationFrame(frame);
    bars.forEach((bar) => { bar.style.transform = ""; });
    void context.close().catch(() => undefined);
  };
}

/**
 * The recorder: Start, a count of 3, 2, 1 with the microphone already
 * showing in the waveform, then recording with the waveform and a clock
 * until Stop; then listen to it and Save, or Record again. The microphone is
 * let go as soon as the recording stops or the sheet closes.
 */
export function openRecorder(store: Pick<Recordings, "add">, song: Pick<Song, "id" | "title">, saved: (recording: SongRecording) => void): void {
  const sheet = openSheet(`<h2>Record how it is played</h2>
    <p class="muted">${escapeHtml(song.title)}. Everyone in the church can listen to it afterwards.</p>
    <div class="recorder stack">
      <div class="recorder-stage">
        <p class="recorder-count" id="rec-count" aria-hidden="true" hidden></p>
        <div class="recorder-wave" id="rec-wave" aria-hidden="true">${"<span></span>".repeat(WAVE_BARS)}</div>
        <p class="recorder-time" id="rec-time" role="timer" aria-label="Recorded time">0:00</p>
      </div>
      <button type="button" class="button primary wide" id="rec-toggle">${icon("mic")}Start recording</button>
      <audio class="recorder-preview" id="rec-preview" controls hidden></audio>
      <form id="rec-form" class="stack" hidden>
        <p class="form-message" role="status"></p>
        <div class="inline-actions wrap">
          <button class="button primary grow" type="submit">${icon("save")}Save</button>
          <button class="button secondary" type="button" id="rec-again">Record again</button>
        </div>
      </form>
    </div>`);
  const toggle = sheet.querySelector<HTMLButtonElement>("#rec-toggle")!;
  const stage = sheet.querySelector<HTMLElement>(".recorder-stage")!;
  const count = sheet.querySelector<HTMLElement>("#rec-count")!;
  const wave = sheet.querySelector<HTMLElement>("#rec-wave")!;
  const time = sheet.querySelector<HTMLElement>("#rec-time")!;
  const preview = sheet.querySelector<HTMLAudioElement>("#rec-preview")!;
  const form = sheet.querySelector<HTMLFormElement>("#rec-form")!;

  let state: "idle" | "counting" | "recording" | "done" = "idle";
  let stream: MediaStream | null = null;
  let recorder: MediaRecorder | null = null;
  let recording: Blob | null = null;
  let previewUrl = "";
  let startedAt = 0;
  let durationMs = 0;
  let ticker = 0;
  let limit = 0;
  let counting = 0;
  let stopWave: (() => void) | null = null;
  let releaseScreen: (() => void) | null = null;
  /** While recording, the sheet is a small card at the bottom instead. */
  let card: HTMLElement | null = null;
  const recorderEl = sheet.querySelector<HTMLElement>(".recorder")!;

  /**
   * Recording: the sheet gives way to a card at the bottom (in the web
   * client's dock, above the current set) with the clock, the waveform and
   * Stop, so the song can be read and scrolled while it records. Closing the
   * sheet while recording does the same.
   */
  const collapse = (closing = false) => {
    if (card || state !== "recording") return;
    card = document.createElement("div");
    card.className = "recorder-card";
    card.setAttribute("role", "group");
    card.setAttribute("aria-label", `Recording ${song.title}`);
    const open = document.createElement("button");
    open.type = "button";
    open.className = "icon-button small ghost recorder-card-open";
    open.setAttribute("aria-label", "Open the recorder");
    open.title = "Open the recorder";
    open.innerHTML = icon("up");
    open.addEventListener("click", expand);
    card.append(stage, toggle, open);
    const dock = document.querySelector<HTMLElement>("#dock");
    if (dock) dock.prepend(card);
    else {
      card.classList.add("floating");
      document.body.append(card);
    }
    if (!closing) closeSheet(sheet);
    toggle.focus({ preventScroll: true });
    announce("Still recording. Stop it from the card at the bottom.");
  };

  /** The card opens into the sheet again (to stop and listen, or by its ⌃). */
  function expand(): void {
    if (!card) return;
    // Wait for the sheet to finish closing before it opens again.
    if (sheet.open) {
      sheet.addEventListener("close", expand, { once: true });
      return;
    }
    recorderEl.prepend(stage);
    stage.after(toggle);
    card.remove();
    card = null;
    sheet.classList.remove("leaving");
    sheet.style.transform = "";
    document.body.append(sheet);
    sheet.showModal();
  }
  stage.addEventListener("click", () => { if (card) expand(); });

  const setStage = (next: typeof state) => {
    state = next;
    stage.dataset.state = next;
    count.hidden = next !== "counting";
    time.hidden = next === "counting";
    time.classList.toggle("live", next === "recording");
  };

  const letGo = () => {
    window.clearInterval(ticker);
    window.clearTimeout(limit);
    window.clearTimeout(counting);
    stopWave?.();
    stopWave = null;
    stream?.getTracks().forEach((track) => track.stop());
    stream = null;
    setRecording(false);
    releaseScreen?.();
    releaseScreen = null;
  };

  const showStart = () => {
    toggle.innerHTML = `${icon("mic")}Start recording`;
    toggle.classList.remove("recording");
    toggle.disabled = false;
  };

  /** Records from the microphone already open. */
  const record = () => {
    if (!stream) return;
    const mimeType = RECORDING_TYPES.find((type) => MediaRecorder.isTypeSupported(type));
    recorder = new MediaRecorder(stream, { ...(mimeType ? { mimeType } : {}), audioBitsPerSecond: 128_000 });
    const chunks: Blob[] = [];
    recorder.addEventListener("dataavailable", (event) => { if (event.data.size) chunks.push(event.data); });
    recorder.addEventListener("stop", () => {
      durationMs = Date.now() - startedAt;
      letGo();
      recording = new Blob(chunks, { type: recorder?.mimeType || mimeType || "audio/webm" });
      // Stopped from the card: the sheet comes back to listen and save.
      setStage("done");
      expand();
      if (!sheet.open) return;
      setStage("done");
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      previewUrl = URL.createObjectURL(recording);
      preview.src = previewUrl;
      preview.hidden = false;
      form.hidden = false;
      toggle.hidden = true;
      announce(`Recorded ${clock(durationMs)}. Listen to it, then save it.`);
      form.querySelector<HTMLButtonElement>("[type='submit']")?.focus();
    });
    recorder.start(1000);
    startedAt = Date.now();
    ticker = window.setInterval(() => { time.textContent = clock(Date.now() - startedAt); }, 250);
    limit = window.setTimeout(() => recorder?.state === "recording" && recorder.stop(), MAX_RECORDING_MS);
    time.textContent = "0:00";
    setStage("recording");
    toggle.innerHTML = `${icon("stop")}Stop`;
    toggle.classList.add("recording");
    announce("Recording");
    collapse();
  };

  /** Opens the microphone, shows it in the waveform, and counts 3, 2, 1. */
  const start = async () => {
    toggle.disabled = true;
    // After a chord has played, iOS is set for playback only, which keeps the microphone off.
    setRecording(true);
    try {
      // Music, not speech: no echo cancelling, noise removal or levelling.
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      });
    } catch (error) {
      setRecording(false);
      showStart();
      const name = error instanceof DOMException ? error.name : "";
      showToast(
        name === "NotAllowedError" || name === "SecurityError"
          ? "The microphone is blocked. Allow it for this site in the browser's settings."
          : name === "NotFoundError" || name === "OverconstrainedError"
            ? "No microphone was found."
            : "The microphone could not be started. Close other apps that use it and try again.",
        true,
      );
      return;
    }
    if (!sheet.open) {
      letGo();
      return;
    }
    stopWave = showWave(stream, wave);
    releaseScreen = holdScreen();
    toggle.innerHTML = `${icon("close")}Cancel`;
    toggle.disabled = false;
    setStage("counting");
    let left = COUNT_FROM;
    const step = () => {
      if (state !== "counting") return;
      if (left === 0) {
        record();
        return;
      }
      count.textContent = String(left);
      // Restart the number's pop each time.
      count.classList.remove("pop");
      void count.offsetWidth;
      count.classList.add("pop");
      announce(String(left));
      left -= 1;
      counting = window.setTimeout(step, COUNT_STEP_MS);
    };
    step();
  };

  toggle.addEventListener("click", () => {
    if (state === "recording") recorder?.stop();
    else if (state === "counting") {
      letGo();
      setStage("idle");
      showStart();
    } else void start();
  });

  sheet.querySelector("#rec-again")?.addEventListener("click", () => {
    preview.pause();
    preview.hidden = true;
    form.hidden = true;
    recording = null;
    toggle.hidden = false;
    time.textContent = "0:00";
    void start();
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!recording) return;
    setFormBusy(form, true);
    try {
      const result = await store.add(song.id, recording, durationMs);
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
    // Closed while recording (or collapsing to the card): it goes on in the card.
    if (state === "recording") {
      collapse(true);
      return;
    }
    // Stopped from the card while the sheet was still closing: it opens again.
    if (card) return;
    if (recorder?.state === "recording") recorder.stop();
    letGo();
    preview.pause();
    if (previewUrl) URL.revokeObjectURL(previewUrl);
  });
  setStage("idle");
}
