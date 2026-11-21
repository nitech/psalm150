import { describe, expect, it } from "vitest";
import { guessKey, keyLabel, prepareSong, songKey } from "../src/song-render.ts";

describe("keyLabel", () => {
  const written = prepareSong("{key: G}\n[G]Amazing [C]grace", 0);

  it("is the key as written when not transposed", () => {
    expect(keyLabel(written, 0)).toBe("Key G");
    expect(keyLabel(prepareSong("Just words", 0), 0)).toBe("");
  });

  it("is the key now, the original and which way it moved", () => {
    expect(keyLabel(written, 2)).toBe("Key A (original G) · Transposed up 2 semitones");
    expect(keyLabel(written, -1)).toBe("Key F# (original G) · Transposed down 1 semitone");
    // Guessed from the chords without a {key}.
    expect(keyLabel(prepareSong("[D]Be [G]thou my [A]vi[D]sion", 0), 3)).toBe("Key F (original D) · Transposed up 3 semitones");
  });

  it("says only how far without a key", () => {
    expect(keyLabel(prepareSong("Just words", 0), -4)).toBe("Transposed down 4 semitones");
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
