import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SlidePayload } from "../src/api";
import { StanzaNumberInput, STANZA_NUMBER_TIMEOUT_MS } from "../src/stanza-number-input";

function slides(count: number): SlidePayload[] {
  return Array.from({ length: count }, (_, index) => ({
    index, stanza_index: index, section_label: "Verse", lines: [{ text: "Lyrics", chords: [] }], overlay: {},
  }));
}

describe("numbered stanza navigation", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("jumps immediately when no longer number is possible", () => {
    const input = new StanzaNumberInput();
    const jump = vi.fn();
    input.push("3", slides(7), jump);
    expect(jump).toHaveBeenCalledWith(2);
  });

  it("targets the first slide of a stanza, counting a split stanza only once", () => {
    const song = slides(4);
    song[1].stanza_index = 0;
    song[2].stanza_index = 1;
    song[3].stanza_index = 2;
    const jump = vi.fn();
    new StanzaNumberInput().push("2", song, jump);
    expect(jump).toHaveBeenCalledWith(2);
  });

  it.each([10, 11, 12, 100, 123])("accepts stanza %i without flashing earlier stanzas", (number) => {
    const input = new StanzaNumberInput();
    const jump = vi.fn();
    const digits = String(number).split("");
    digits.forEach((digit, index) => {
      input.push(digit, slides(number), jump);
      if (index < digits.length - 1) expect(jump).not.toHaveBeenCalled();
    });
    vi.runAllTimers();
    expect(jump).toHaveBeenCalledExactlyOnceWith(number - 1);
  });

  it("commits a single ambiguous digit after the timeout", () => {
    const input = new StanzaNumberInput();
    const jump = vi.fn();
    input.push("1", slides(12), jump);
    vi.advanceTimersByTime(STANZA_NUMBER_TIMEOUT_MS - 1);
    expect(jump).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(jump).toHaveBeenCalledExactlyOnceWith(0);
  });

  it("treats a digit after the timeout as a new selection", () => {
    const input = new StanzaNumberInput();
    const jump = vi.fn();
    input.push("1", slides(12), jump);
    vi.runAllTimers();
    input.push("2", slides(12), jump);
    expect(jump.mock.calls).toEqual([[0], [1]]);
  });

  it("ignores zero, out-of-range numbers and invalid sequences", () => {
    const input = new StanzaNumberInput();
    const jump = vi.fn();
    input.push("0", slides(12), jump);
    input.push("9", slides(7), jump);
    input.push("1", slides(12), jump);
    input.push("9", slides(12), jump);
    vi.runAllTimers();
    expect(jump).not.toHaveBeenCalled();
  });

  it("cancels pending navigation and clears the prefix on reset", () => {
    const input = new StanzaNumberInput();
    const jump = vi.fn();
    input.push("1", slides(12), jump);
    input.reset();
    vi.runAllTimers();
    expect(jump).not.toHaveBeenCalled();
    input.push("2", slides(12), jump);
    expect(jump).toHaveBeenCalledExactlyOnceWith(1);
  });
});
