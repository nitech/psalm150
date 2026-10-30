/**
 * A song's YouTube video: song metadata, `{meta: youtube <link>}`, shown
 * as a link only when it really is a YouTube video.
 */

/** `90`, `90s`, `1m30s` or `1h2m3s` as seconds; 0 when it is none of them. */
function seconds(text: string): number {
  if (/^\d+$/.test(text)) return Number(text);
  const match = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(text);
  if (!match || !text) return 0;
  return Number(match[1] ?? 0) * 3600 + Number(match[2] ?? 0) * 60 + Number(match[3] ?? 0);
}

/**
 * A YouTube link in any usual form (`watch?v=`, `youtu.be/`, `/shorts/`,
 * `/live/`, `/embed/`), as a plain `watch?v=` link with its start time.
 * Null for anything else, so only YouTube links are ever shown as one.
 */
export function youtubeLink(text: string): { url: string; start: number } | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  let url: URL;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  const parts = url.pathname.split("/").filter(Boolean);
  let id: string | undefined;
  if (host === "youtu.be") id = parts[0];
  else if (["youtube.com", "m.youtube.com", "music.youtube.com", "youtube-nocookie.com"].includes(host)) {
    if (parts[0] === "watch") id = url.searchParams.get("v") ?? undefined;
    else if (["shorts", "embed", "live", "v"].includes(parts[0] ?? "")) id = parts[1];
  }
  if (!id || !/^[A-Za-z0-9_-]{11}$/.test(id)) return null;
  const start = seconds(url.searchParams.get("t") ?? url.searchParams.get("start") ?? "");
  return { url: `https://www.youtube.com/watch?v=${id}${start ? `&t=${start}s` : ""}`, start };
}

/** The song's `{meta: youtube <link>}`, when it is a YouTube link. */
export function songVideo(chordpro: string): { url: string; start: number } | null {
  const match = /^\s*\{\s*meta\s*:\s*youtube\s*[=\s]\s*([^}]*?)\s*\}\s*$/im.exec(chordpro);
  return match ? youtubeLink(match[1]) : null;
}
