import type { SongServerApi } from "./api.ts";

/** A visitor's transposed songs, in this browser: `{songId: semitones}`. */
const LOCAL_KEY = "psa150-transpositions";
/** Steps taken quickly one after another are saved once, the last one. */
const SAVE_DELAY_MS = 600;

/**
 * How far each song is moved for this reader, so a song opens in the key
 * they chose last time. Signed in, they are the person's own on the server
 * (`/transpositions`), the same on every phone and computer; a visitor's
 * are kept in this browser.
 */
export class Transpositions {
  private steps = new Map<string, number>();
  private signedIn = false;
  private loading: Promise<void> = Promise.resolve();
  /** Steps not sent yet, by song. */
  private unsaved = new Map<string, number>();
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(private api: SongServerApi, private storage: Storage | null = safeLocalStorage()) {
    this.readLocal();
  }

  /** Semitones up (positive) or down to read the song in; 0 as written. */
  get(songId: string): number {
    return this.steps.get(songId) ?? 0;
  }

  /** Resolves once the person's are read (at once for a visitor, or if reading failed). */
  ready(): Promise<void> {
    return this.loading.catch(() => undefined);
  }

  /** Signed in: reads the person's from the server. */
  refresh(): Promise<void> {
    this.signedIn = true;
    const loading = this.api.listTranspositions().then(({ transpositions }) => {
      if (!this.signedIn || this.loading !== loading) return;
      this.steps = new Map(transpositions.map((item) => [item.song_id, item.semitones]));
      // A step taken while reading wins over what the server had.
      for (const [songId, semitones] of this.unsaved) this.keep(songId, semitones);
    });
    this.loading = loading;
    return loading;
  }

  /** Remembers how far the song is moved now. */
  set(songId: string, semitones: number): void {
    this.keep(songId, semitones);
    if (!this.signedIn) {
      this.writeLocal();
      return;
    }
    this.unsaved.set(songId, semitones);
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.save(), SAVE_DELAY_MS);
  }

  /** Signed out: back to this browser's own. */
  clear(): void {
    this.signedIn = false;
    this.unsaved.clear();
    clearTimeout(this.timer);
    this.loading = Promise.resolve();
    this.readLocal();
  }

  /** Sends each song's last step; one that fails is kept for this visit only. */
  private async save(): Promise<void> {
    const unsaved = [...this.unsaved];
    this.unsaved.clear();
    await Promise.all(unsaved.map(([songId, semitones]) => this.api.setTransposition(songId, semitones).catch(() => undefined)));
  }

  private keep(songId: string, semitones: number): void {
    if (semitones) this.steps.set(songId, semitones);
    else this.steps.delete(songId);
  }

  private readLocal(): void {
    this.steps = new Map();
    try {
      const stored: unknown = JSON.parse(this.storage?.getItem(LOCAL_KEY) ?? "{}");
      if (!stored || typeof stored !== "object") return;
      for (const [songId, semitones] of Object.entries(stored)) {
        if (typeof semitones === "number" && Number.isInteger(semitones) && semitones !== 0 && Math.abs(semitones) <= 11) this.steps.set(songId, semitones);
      }
    } catch {
      // Nothing usable stored.
    }
  }

  private writeLocal(): void {
    try {
      if (this.steps.size) this.storage?.setItem(LOCAL_KEY, JSON.stringify(Object.fromEntries(this.steps)));
      else this.storage?.removeItem(LOCAL_KEY);
    } catch {
      // Storage full or off: remembered for this visit only.
    }
  }
}

function safeLocalStorage(): Storage | null {
  try {
    return localStorage;
  } catch {
    return null;
  }
}
