import { describe, expect, it } from "vitest";
import { clock } from "../src/ui.ts";
import { songVideo, youtubeLink } from "../../shared/songs/youtube.ts";

describe("YouTube links", () => {
  it("read every usual form of link as the same video", () => {
    for (const link of [
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      "https://youtube.com/watch?feature=share&v=dQw4w9WgXcQ",
      "youtube.com/watch?v=dQw4w9WgXcQ",
      "https://m.youtube.com/watch?v=dQw4w9WgXcQ",
      "https://music.youtube.com/watch?v=dQw4w9WgXcQ&list=x",
      "https://youtu.be/dQw4w9WgXcQ?si=abc",
      "https://www.youtube.com/shorts/dQw4w9WgXcQ",
      "https://www.youtube.com/live/dQw4w9WgXcQ",
      "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ",
    ]) {
      expect(youtubeLink(link), link).toEqual({ url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", start: 0 });
    }
  });

  it("keep a start time", () => {
    expect(youtubeLink("https://youtu.be/dQw4w9WgXcQ?t=90")?.url).toBe("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=90s");
    expect(youtubeLink("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=1m5s")?.start).toBe(65);
  });

  it("refuse anything that is not a YouTube video", () => {
    for (const link of [
      "https://vimeo.com/123456",
      "https://www.youtube.com/watch?v=short",
      "https://www.youtube.com/channel/UCabcdefghijk",
      "https://youtube.com.evil.example/watch?v=dQw4w9WgXcQ",
      "javascript:alert(1)",
      "",
    ]) {
      expect(youtubeLink(link), link).toBeNull();
    }
  });

  it("come from the song's {meta: youtube}", () => {
    expect(songVideo("{title: X}\n{meta: youtube https://youtu.be/dQw4w9WgXcQ}\n\nHi")?.url).toBe("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    expect(songVideo("{title: X}\n{meta: youtube=https://youtu.be/dQw4w9WgXcQ}")).not.toBeNull();
    expect(songVideo("{title: X}\n{meta: youtube https://example.com/x}")).toBeNull();
    expect(songVideo("{title: X}\n\nyoutube")).toBeNull();
  });
});

describe("clock", () => {
  it("shows minutes and seconds, and hours when there are any", () => {
    expect(clock(4200)).toBe("0:04");
    expect(clock(65_000)).toBe("1:05");
    expect(clock(3_725_000)).toBe("1:02:05");
  });
});
