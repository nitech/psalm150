import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SongServerApi } from "../src/api.ts";
import { Transpositions } from "../src/transpositions.ts";

/** A Storage kept in memory. */
function memoryStorage(initial: Record<string, string> = {}): Storage {
  const items = new Map(Object.entries(initial));
  return {
    get length() { return items.size; },
    clear: () => items.clear(),
    getItem: (key) => items.get(key) ?? null,
    key: (index) => [...items.keys()][index] ?? null,
    removeItem: (key) => void items.delete(key),
    setItem: (key, value) => void items.set(key, value),
  };
}

function serverApi(stored: { song_id: string; semitones: number }[] = []) {
  const saved: [string, number][] = [];
  const api = {
    listTranspositions: vi.fn(async () => ({ transpositions: stored })),
    setTransposition: vi.fn(async (songId: string, semitones: number) => void saved.push([songId, semitones])),
  };
  return { api: api as unknown as SongServerApi, calls: api, saved };
}

describe("Transpositions", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("keeps a visitor's in this browser", () => {
    const storage = memoryStorage();
    const { api, calls } = serverApi();
    const first = new Transpositions(api, storage);
    expect(first.get("a")).toBe(0);
    first.set("a", -2);
    first.set("b", 3);
    first.set("b", 0);
    expect(calls.setTransposition).not.toHaveBeenCalled();
    // The next visit finds them.
    const again = new Transpositions(api, storage);
    expect(again.get("a")).toBe(-2);
    expect(again.get("b")).toBe(0);
  });

  it("ignores what does not fit in storage", () => {
    const storage = memoryStorage({ "psa150-transpositions": JSON.stringify({ a: 2, b: 12, c: "1", d: 0, e: -11 }) });
    const store = new Transpositions(serverApi().api, storage);
    expect(["a", "b", "c", "d", "e"].map((id) => store.get(id))).toEqual([2, 0, 0, 0, -11]);
  });

  it("reads a signed-in person's from the server and saves each song's last step", async () => {
    const storage = memoryStorage({ "psa150-transpositions": JSON.stringify({ a: 5 }) });
    const { api, saved } = serverApi([{ song_id: "a", semitones: 1 }]);
    const store = new Transpositions(api, storage);
    void store.refresh();
    await store.ready();
    expect(store.get("a")).toBe(1);

    store.set("a", 2);
    store.set("a", 3);
    store.set("b", -1);
    expect(saved).toEqual([]);
    await vi.runAllTimersAsync();
    expect(saved).toEqual([["a", 3], ["b", -1]]);
    // The browser's own stay as they were.
    expect(JSON.parse(storage.getItem("psa150-transpositions")!)).toEqual({ a: 5 });

    // Signed out: back to the browser's.
    store.clear();
    expect(store.get("a")).toBe(5);
    expect(store.get("b")).toBe(0);
  });

  it("is ready even when the server cannot be read", async () => {
    const { api, calls } = serverApi();
    calls.listTranspositions.mockRejectedValueOnce(new Error("offline"));
    const store = new Transpositions(api, memoryStorage());
    void store.refresh().catch(() => undefined);
    await expect(store.ready()).resolves.toBeUndefined();
    expect(store.get("a")).toBe(0);
  });
});
