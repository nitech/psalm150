import { describe, expect, it } from "vitest";
import { guessKey, keyLabel, prepareSong, songKey } from "../src/song-render.ts";

describe("keyLabel", () => {
  const written = prepareSong("{key: G}\n[G]Amazing [C]grace", 0);

  it("is the key as written when not transposed", () => {
    expect(keyLabel(written, 0)).toBe("Key G");
    expect(keyLabel(prepareSong("Just words", 0), 0)).toBe("");
  });

  it("is the key now, the original and the steps", () => {
    expect(keyLabel(written, 2)).toBe("A (orig. G, +2)");
    expect(keyLabel(written, -1)).toBe("F# (orig. G, -1)");
    // Guessed from the chords without a {key}.
    expect(keyLabel(prepareSong("[D]Be [G]thou my [A]vi[D]sion", 0), 3)).toBe("F (orig. D, +3)");
  });

  it("says only the steps without a key", () => {
    expect(keyLabel(prepareSong("Just words", 0), -4)).toBe("Transposed -4");
  });
});

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
