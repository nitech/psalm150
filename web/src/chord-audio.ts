/**
 * Plays a chord through Web Audio, with no sound files: a plucked string
 * (Karplus–Strong) strummed low to high for the guitar, and a struck,
 * fading tone for the piano. Starting a chord stops the one before.
 */

export type Sound = "guitar" | "piano";

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
    output.gain.value = 0.8;
    output.connect(limiter);
  }
  return { context, output };
}

const frequency = (midi: number) => 440 * 2 ** ((midi - 69) / 12);

/** Plays MIDI notes, low first; the guitar strums them, the piano strikes them together. */
export function playChord(notes: number[], sound: Sound): void {
  if (!notes.length) return;
  const { context, output } = audio();
  void context.resume();
  const now = context.currentTime + 0.02;
  if (playing) {
    playing.gain.cancelScheduledValues(now);
    playing.gain.setTargetAtTime(0, now, 0.03);
  }
  const bus = context.createGain();
  bus.gain.value = 1 / Math.sqrt(notes.length);
  bus.connect(output);
  playing = bus;
  notes.forEach((midi, index) => {
    if (sound === "guitar") pluck(context, bus, midi, now + index * 0.035);
    else strike(context, bus, midi, now);
  });
}

const plucks = new Map<number, AudioBuffer>();

/** A plucked string: a burst of noise through a delay line one period long. */
function pluck(context: AudioContext, bus: AudioNode, midi: number, at: number): void {
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
  gain.gain.setValueAtTime(0.9, at);
  gain.gain.setTargetAtTime(0, at + 2.2, 0.25);
  source.connect(tone).connect(gain).connect(bus);
  source.start(at);
  source.stop(at + 3);
}

/** A piano-like note: a few harmonics that strike and fade. */
function strike(context: AudioContext, bus: AudioNode, midi: number, at: number): void {
  const base = frequency(midi);
  const gain = context.createGain();
  gain.gain.setValueAtTime(0, at);
  gain.gain.linearRampToValueAtTime(0.6, at + 0.008);
  gain.gain.setTargetAtTime(0.25, at + 0.01, 0.25);
  gain.gain.setTargetAtTime(0, at + 1.6, 0.35);
  gain.connect(bus);
  for (const [harmonic, level] of [[1, 1], [2, 0.35], [3, 0.12], [4, 0.06]] as const) {
    const oscillator = context.createOscillator();
    oscillator.type = harmonic === 1 ? "triangle" : "sine";
    oscillator.frequency.value = base * harmonic;
    const partial = context.createGain();
    partial.gain.value = level;
    oscillator.connect(partial).connect(gain);
    oscillator.start(at);
    oscillator.stop(at + 3.5);
  }
}
