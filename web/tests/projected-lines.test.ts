import { describe, expect, it } from "vitest";
import { projectedLines } from "../src/projected-lines.ts";

const song = [
  "Takk, Jesus kjær! Du søkte også meg",
  "Da jeg drev om på syndens brede vei.",
  "",
  "Min synd, min skam og straff Du på Deg tok.",
  "Og jeg ble renset i Ditt dyre blod.",
  "",
  "Jesus, my Lord,",
  "I give my heart to You.",
];
const slide = (...lines: string[]) => ({ label: "", lines });
const verse1 = slide("Takk, Jesus kjær! Du søkte også meg", "Da jeg drev om på Syndens brede vei.");
const verse2 = slide("Min synd, Min skam og straff Du på Deg tok.", "Og jeg ble renset i Ditt dyre  blod.");
const chorus = slide("Jesus, my Lord,", "I give my heart to You.");

describe("projectedLines", () => {
  it("finds a slide's lines, whatever the case and spacing", () => {
    expect(projectedLines(song, [verse1, verse2], 0)).toEqual([0, 1]);
    expect(projectedLines(song, [verse1, verse2], 1)).toEqual([3, 4]);
  });

  it("finds a chorus sung again where it is written once", () => {
    const slides = [verse1, chorus, verse2, chorus];
    expect(projectedLines(song, slides, 1)).toEqual([6, 7]);
    expect(projectedLines(song, slides, 3)).toEqual([6, 7]);
  });

  it("finds a chorus written twice at its own place", () => {
    const twice = [song[0], song[1], "", song[6], song[7], "", song[3], song[4], "", song[6], song[7]];
    const slides = [verse1, chorus, verse2, chorus];
    expect(projectedLines(twice, slides, 1)).toEqual([3, 4]);
    expect(projectedLines(twice, slides, 3)).toEqual([9, 10]);
  });

  it("falls back to the first line when the others changed", () => {
    expect(projectedLines(song, [slide("Takk, Jesus kjær! Du søkte også meg", "Something else")], 0)).toEqual([0]);
  });

  it("finds nothing for words that are not in the song", () => {
    expect(projectedLines(song, [slide("Amazing grace")], 0)).toEqual([]);
    expect(projectedLines(song, [slide()], 0)).toEqual([]);
    expect(projectedLines(song, [verse1], 3)).toEqual([]);
  });
});
