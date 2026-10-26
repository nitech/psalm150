/**
 * Plays chords and single notes through Web Audio from recordings of the
 * real instruments (`/sounds/`, CC BY 3.0, credited under More → About): a
 * grand piano recorded every three semitones and an acoustic guitar every
 * two, each note played from the nearest recording, a little faster or
 * slower. The guitar strums low to high, the piano strikes together.
 *
 * The recordings load the first time an instrument is wanted (`preloadSound`,
 * when the chord sheet opens) and the service worker keeps them for offline.
 * Until they are there, or if they cannot load, a synthesised plucked string
 * or struck tone plays instead. Starting a chord stops the one before; a
 * single note lets what is sounding ring on.
 */

export type Sound = "guitar" | "piano";

/** The recordings: their folder and the notes recorded, as file names (`Fs3` is F#3). */
const RECORDINGS: Record<Sound, { folder: string; notes: string[] }> = {
  piano: {
    folder: "/sounds/piano/",
    notes: ["C2", "Ds2", "Fs2", "A2", "C3", "Ds3", "Fs3", "A3", "C4", "Ds4", "Fs4", "A4", "C5", "Ds5", "Fs5", "A5", "C6"],
  },
  guitar: {
    folder: "/sounds/guitar/",
    notes: ["E2", "Fs2", "Gs2", "As2", "C3", "D3", "E3", "Fs3", "Gs3", "As3", "C4", "D4", "E4", "Fs4", "Gs4", "As4", "C5", "D5"],
  },
};

const PITCH: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** `Fs3` → 54 (MIDI, middle C = 60). */
export function recordingMidi(name: string): number {
  const match = /^([A-G])(s?)(-?\d)$/.exec(name);
  if (!match) throw new Error(`Not a recording name: ${name}`);
  return (Number(match[3]) + 1) * 12 + PITCH[match[1]] + (match[2] ? 1 : 0);
}

let context: AudioContext | null = null;
let output: GainNode | null = null;
let playing: GainNode | null = null;

function audio(): { context: AudioContext; output: GainNode } {
  if (!context || !output) {
    // iOS keeps Web Audio silent under the ring/silent switch unless the
    // page asks to play like a media app.
    const session = (navigator as Navigator & { audioSession?: { type: string } }).audioSession;
    if (session) session.type = "playback";
    context = new AudioContext();
    const limiter = context.createDynamicsCompressor();
    limiter.threshold.value = -10;
    limiter.connect(context.destination);
    output = context.createGain();
    output.gain.value = 0.9;
    output.connect(limiter);
  }
  return { context, output };
}

/** Each instrument's recordings by MIDI note, loading or loaded. */
const banks = new Map<Sound, Promise<Map<number, AudioBuffer>>>();

function bank(sound: Sound): Promise<Map<number, AudioBuffer>> {
  let loading = banks.get(sound);
  if (!loading) {
    const { context } = audio();
    const { folder, notes } = RECORDINGS[sound];
    loading = Promise.all(notes.map(async (name) => {
      try {
        const response = await fetch(`${folder}${name}.mp3`);
        if (!response.ok) return null;
        return [recordingMidi(name), await context.decodeAudioData(await response.arrayBuffer())] as const;
      } catch {
        return null;
      }
    })).then((loaded) => new Map(loaded.filter((entry) => entry !== null)));
    // A failed load (offline before it was ever saved) is tried again next time.
    void loading.then((loaded) => {
      if (!loaded.size) banks.delete(sound);
    });
    banks.set(sound, loading);
  }
  return loading;
}

/** Starts loading an instrument's recordings, so Play is quick. */
export function preloadSound(sound: Sound): void {
  void bank(sound);
}

/** The recordings when they are there within `wait` ms, else null (play the stand-in). */
async function ready(sound: Sound, wait: number): Promise<Map<number, AudioBuffer> | null> {
  const timeout = new Promise<null>((resolve) => window.setTimeout(() => resolve(null), wait));
  const loaded = await Promise.race([bank(sound), timeout]);
  return loaded?.size ? loaded : null;
}

/** Plays a chord's MIDI notes, low first; it stops the chord before it. */
export function playChord(notes: number[], sound: Sound): void {
  if (!notes.length) return;
  const { context } = audio();
  // Within the tap, so iOS lets the sound start.
  void context.resume();
  void ready(sound, 1200).then((recordings) => {
    const now = context.currentTime + 0.02;
    if (playing) {
      playing.gain.cancelScheduledValues(now);
      playing.gain.setTargetAtTime(0, now, 0.04);
    }
    const bus = newBus(1 / Math.sqrt(notes.length));
    playing = bus;
    notes.forEach((midi, index) => {
      if (sound === "guitar") {
        // A strum: a little uneven, the higher strings a little softer.
        const at = now + index * 0.04 + Math.random() * 0.008;
        play(recordings, sound, bus, midi, at, 1 - index * 0.05);
      } else {
        play(recordings, sound, bus, midi, now, 0.9);
      }
    });
  });
}

/** Plays one note (a string or a key tapped), letting what sounds ring on. */
export function playNote(midi: number, sound: Sound): void {
  const { context } = audio();
  void context.resume();
  void ready(sound, 1200).then((recordings) => {
    play(recordings, sound, newBus(0.9), midi, context.currentTime + 0.01, 1);
  });
}

function newBus(level: number): GainNode {
  const { context, output } = audio();
  const bus = context.createGain();
  bus.gain.value = level;
  bus.connect(output);
  return bus;
}

function play(recordings: Map<number, AudioBuffer> | null, sound: Sound, bus: AudioNode, midi: number, at: number, level: number): void {
  if (!recordings) {
    if (sound === "guitar") pluck(bus, midi, at, level);
    else strike(bus, midi, at, level);
    return;
  }
  let nearest = -1;
  for (const recorded of recordings.keys()) {
    if (nearest < 0 || Math.abs(recorded - midi) < Math.abs(nearest - midi)) nearest = recorded;
  }
  const { context } = audio();
  const source = context.createBufferSource();
  source.buffer = recordings.get(nearest)!;
  source.playbackRate.value = 2 ** ((midi - nearest) / 12);
  const gain = context.createGain();
  gain.gain.value = level;
  source.connect(gain).connect(bus);
  source.start(at);
}

/* ── Stand-ins while the recordings load ──────────────────────────────── */

const frequency = (midi: number) => 440 * 2 ** ((midi - 69) / 12);
const plucks = new Map<number, AudioBuffer>();

/** A plucked string: a burst of noise through a delay line one period long (Karplus–Strong). */
function pluck(bus: AudioNode, midi: number, at: number, level: number): void {
  const { context } = audio();
  let buffer = plucks.get(midi);
  if (!buffer) {
    const rate = context.sampleRate;
    const length = Math.floor(rate * 3);
    buffer = context.createBuffer(1, length, rate);
    const data = buffer.getChannelData(0);
    const period = Math.max(2, Math.round(rate / frequency(midi)));
    // Lower strings ring longer, as on a real guitar.
    const decay = 0.996 + Math.min(0.0035, (64 - midi) * 0.0001);
    for (let i = 0; i < period; i++) data[i] = Math.random() * 2 - 1;
    for (let i = period; i < length; i++) {
      data[i] = decay * 0.5 * (data[i - period] + data[Math.max(0, i - period - 1)]);
    }
    plucks.set(midi, buffer);
  }
  const source = context.createBufferSource();
  source.buffer = buffer;
  const tone = context.createBiquadFilter();
  tone.type = "lowpass";
  tone.frequency.value = 3200;
  const gain = context.createGain();
  gain.gain.setValueAtTime(0.9 * level, at);
  gain.gain.setTargetAtTime(0, at + 2.2, 0.25);
  source.connect(tone).connect(gain).connect(bus);
  source.start(at);
  source.stop(at + 3);
}

/** A piano-like note: a few harmonics that strike and fade. */
function strike(bus: AudioNode, midi: number, at: number, level: number): void {
  const { context } = audio();
  const base = frequency(midi);
  const gain = context.createGain();
  gain.gain.setValueAtTime(0, at);
  gain.gain.linearRampToValueAtTime(0.6 * level, at + 0.008);
  gain.gain.setTargetAtTime(0.25 * level, at + 0.01, 0.25);
  gain.gain.setTargetAtTime(0, at + 1.6, 0.35);
  gain.connect(bus);
  for (const [harmonic, partialLevel] of [[1, 1], [2, 0.35], [3, 0.12], [4, 0.06]] as const) {
    const oscillator = context.createOscillator();
    oscillator.type = harmonic === 1 ? "triangle" : "sine";
    oscillator.frequency.value = base * harmonic;
    const partial = context.createGain();
    partial.gain.value = partialLevel;
    oscillator.connect(partial).connect(gain);
    oscillator.start(at);
    oscillator.stop(at + 3.5);
  }
}
