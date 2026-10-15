import { ApiError, type SongServerApi } from "./api.ts";
import type { SetDetail, SetItem, SetItemInput, SetSummary } from "./types.ts";
import { readPreference, today, writePreference } from "./ui.ts";

const CHOSEN_KEY = "current-set";
/** Stored instead of a set id when the person put the current set away. */
export const NO_SET = "none";

/**
 * The set this phone adds songs to. A set chosen on this phone wins while it
 * exists and its service is not over; otherwise it is the next dated service
 * (today counts). Undated sets are only current when chosen. After the person
 * puts the current set away there is none until they choose one again.
 */
export function resolveCurrentSet(sets: SetSummary[], chosen: string | null, now: string): SetSummary | null {
  if (chosen === NO_SET) return null;
  const pick = chosen ? sets.find((set) => set.id === chosen) : undefined;
  if (pick && (!pick.service_date || pick.service_date >= now)) return pick;
  const upcoming = sets
    .filter((set) => set.service_date && set.service_date >= now)
    .sort((a, b) => a.service_date!.localeCompare(b.service_date!) || b.updated_at.localeCompare(a.updated_at));
  return upcoming[0] ?? null;
}

/** The input form of a set's items, for a `PUT /sets/{id}`. */
export function itemInputs(items: SetItem[]): SetItemInput[] {
  return items.map((item) => ({
    id: item.id,
    kind: item.kind,
    song_id: item.song_id,
    transpose: item.transpose,
    note: item.note,
  }));
}

type Listener = (set: SetDetail | null) => void;

/**
 * Holds the current set for the signed-in shell: the mini bar, the song
 * list's add buttons and the song page all read it and hear about changes.
 * Edits run one at a time and start from the server's latest version, so two
 * quick taps never overwrite each other; a conflict with someone else's edit
 * is retried once.
 */
export class CurrentSet {
  private set: SetDetail | null = null;
  private readonly listeners = new Set<Listener>();
  private queue: Promise<unknown> = Promise.resolve();
  private offlineKey = "";

  constructor(private readonly api: SongServerApi) {}

  get value(): SetDetail | null {
    return this.set;
  }

  /** True when this phone picked the set rather than following the calendar. */
  get chosen(): boolean {
    return Boolean(this.set && readPreference(CHOSEN_KEY) === this.set.id);
  }

  /** How many times the song is in the current set. */
  count(songId: string): number {
    return this.set?.items.filter((item) => item.song_id === songId).length ?? 0;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Reloads from the server. Offline, the last known set stays. */
  refresh(): Promise<SetDetail | null> {
    return this.enqueue(async () => {
      const sets = await this.api.listSets();
      const summary = resolveCurrentSet(sets, readPreference(CHOSEN_KEY), today());
      this.update(summary ? await this.api.getSet(summary.id) : null);
      return this.set;
    });
  }

  /** Makes a set current on this phone; `null` goes back to the calendar. */
  choose(setId: string | null): Promise<SetDetail | null> {
    writePreference(CHOSEN_KEY, setId);
    return this.refresh();
  }

  /**
   * No current set on this phone, until one is chosen again. Resolves with
   * the earlier choice (`null` for the calendar), which `choose` puts back.
   */
  dismiss(): Promise<string | null> {
    return this.enqueue(async () => {
      const previous = readPreference(CHOSEN_KEY);
      writePreference(CHOSEN_KEY, NO_SET);
      this.update(null);
      return previous === NO_SET ? null : previous;
    });
  }

  /** Appends a song. Resolves with the new item's id, for Undo. */
  async addSong(songId: string, transpose = 0): Promise<string> {
    const id = crypto.randomUUID();
    await this.change((items) => [...items, { id, kind: "song", song_id: songId, transpose, note: "" }]);
    return id;
  }

  /** Puts an item back where it was, after an Undo of a removal. */
  restoreItem(item: SetItemInput & { id: string }, index: number): Promise<void> {
    return this.change((items) => {
      const next = items.filter((entry) => entry.id !== item.id);
      next.splice(Math.min(index, next.length), 0, item);
      return next;
    });
  }

  removeItem(itemId: string): Promise<void> {
    return this.change((items) => items.filter((item) => item.id !== itemId));
  }

  /** Removes the song's last entry. Resolves with it and its index, for Undo. */
  async removeSong(songId: string): Promise<{ item: SetItemInput & { id: string }; index: number } | null> {
    let removed: { item: SetItemInput & { id: string }; index: number } | null = null;
    await this.change((items) => {
      const index = items.map((item) => item.song_id).lastIndexOf(songId);
      if (index < 0) return items;
      removed = { item: items[index] as SetItemInput & { id: string }, index };
      return items.filter((_, position) => position !== index);
    });
    return removed;
  }

  /** Forgets the set, for sign-out. */
  clear(): void {
    this.offlineKey = "";
    this.update(null);
  }

  private change(edit: (items: SetItemInput[]) => SetItemInput[]): Promise<void> {
    return this.enqueue(async () => {
      if (!this.set) throw new Error("There is no current set.");
      for (let attempt = 0; ; attempt++) {
        const latest = await this.api.getSet(this.set.id, { fresh: true });
        try {
          const saved = await this.api.updateSet(latest.id, latest.version, {
            name: latest.name,
            service_date: latest.service_date,
            items: edit(itemInputs(latest.items)),
          });
          this.update(saved);
          return;
        } catch (error) {
          if (attempt === 0 && error instanceof ApiError && error.status === 409) continue;
          if (error instanceof ApiError && error.status === 404) void this.refresh();
          throw error;
        }
      }
    });
  }

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const result = this.queue.then(task, task);
    this.queue = result.catch(() => undefined);
    return result;
  }

  private update(set: SetDetail | null): void {
    this.set = set;
    for (const listener of this.listeners) listener(set);
    if (set) void this.keepOffline(set);
  }

  /**
   * Loads every song in the set once, so the service worker has them cached
   * and the service view works when the church Wi-Fi does not.
   */
  private async keepOffline(set: SetDetail): Promise<void> {
    const ids = [...new Set(set.items.flatMap((item) => (item.song_id && item.song ? [item.song_id] : [])))];
    const key = `${set.id}:${set.version}:${ids.join(",")}`;
    if (!navigator.serviceWorker?.controller || key === this.offlineKey) return;
    this.offlineKey = key;
    for (const id of ids) {
      try {
        await this.api.getSong(id);
      } catch {
        // Offline or deleted: the next change tries again.
        this.offlineKey = "";
        return;
      }
    }
  }
}

/** Sets grouped for lists: the next services first, then undated, then past (newest first). */
export function groupSets(sets: SetSummary[], now: string): { upcoming: SetSummary[]; undated: SetSummary[]; past: SetSummary[] } {
  const byDate = (a: SetSummary, b: SetSummary) => a.service_date!.localeCompare(b.service_date!);
  return {
    upcoming: sets.filter((set) => set.service_date && set.service_date >= now).sort(byDate),
    undated: sets.filter((set) => !set.service_date).sort((a, b) => b.updated_at.localeCompare(a.updated_at)),
    past: sets.filter((set) => set.service_date && set.service_date < now).sort((a, b) => byDate(b, a)),
  };
}
