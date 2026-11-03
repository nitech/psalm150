import { describe, expect, it } from "vitest";
import { prepareSong, songText } from "../src/song-render.ts";

describe("songText", () => {
  it("keeps only the words, with a blank line between sections", () => {
    const song = prepareSong(
      [
        "{title: Amazing Grace}",
        "{key: G}",
        "",
        "{start_of_verse: Verse 1}",
        "[G]Amazing [D/F#]grace, how [C]sweet the [G]sound",
        "That saved a wretch like me",
        "{end_of_verse}",
        "",
        "{comment: Repeat}",
        "{start_of_chorus}",
        "[C] [G]",
        "My chains are gone",
        "{end_of_chorus}",
      ].join("\n"),
      0,
    );
    expect(songText(song)).toBe(
      "Amazing grace, how sweet the sound\nThat saved a wretch like me\n\nMy chains are gone",
    );
  });

  it("is empty for a song without words", () => {
    expect(songText(prepareSong("{title: Instrumental}", 0))).toBe("");
  });
});
