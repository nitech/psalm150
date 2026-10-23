import { describe, expect, it } from "vitest";
import { guessKey, prepareSong, songKey } from "../src/song-render.ts";

describe("songKey", () => {
  it("is the song's key, moved with the transpose", () => {
    expect(songKey(prepareSong("{key: D}\n[D]Hello", 0))).toBe("D");
    expect(songKey(prepareSong("{key: D}\n[D]Hello", 2))).toBe("E");
  });

  it("guesses from the chords without a key", () => {
    // At the Cross: opens on Em, but in G.
    expect(guessKey(["Em", "D", "G", "C", "Em", "D", "G", "C", "D", "C", "C", "G", "D", "Am", "C", "G"])).toBe("G");
    // A minor song that ends at home.
    expect(guessKey(["Am", "F", "C", "G", "Am", "F", "G", "Am"])).toBe("Am");
    expect(guessKey(["D", "A", "Bm", "G", "D"])).toBe("D");
    expect(songKey(prepareSong("[Gmaj7/B]Hello [C]there [D]my [G]friend", 0))).toBe("G");
    expect(songKey(prepareSong("Just words", 0))).toBeNull();
  });
});
