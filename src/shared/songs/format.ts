/**
 * Small text and page helpers used by the song modules in both apps (the
 * song server's web client and the Psalm150 desktop app).
 *
 * Canonical copy: PSA150-server/shared/songs/. The desktop repo mirrors this
 * folder at src/shared/songs/ with `bun run sync:shared`; edit it here, never
 * in the mirror.
 */

export function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    '"': "&quot;",
  })[character] ?? character);
}

/** Up to two capital letters for an avatar: "Pat Owner" → "PO". */
export function initials(name: string): string {
  return name.split(/\s+/).map((part) => part[0] ?? "").join("").slice(0, 2).toUpperCase();
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong.";
}

/** `m:ss`, or `h:mm:ss` from an hour. */
export function clock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = String(total % 60).padStart(2, "0");
  return hours ? `${hours}:${String(minutes).padStart(2, "0")}:${seconds}` : `${minutes}:${seconds}`;
}

export function relativeDate(value: string): string {
  const date = new Date(value);
  const days = Math.floor((Date.now() - date.getTime()) / 86_400_000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 14) return `${days} days ago`;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function setFormBusy(form: HTMLElement, value: boolean): void {
  form.querySelectorAll<HTMLInputElement | HTMLButtonElement | HTMLTextAreaElement>("input,button,textarea,select")
    .forEach((control) => { control.disabled = value; });
  form.classList.toggle("busy", value);
}

/**
 * Puts text on the clipboard. The Clipboard API exists only on HTTPS (and
 * localhost), so a server reached by its LAN address falls back to the older
 * copy command. False when neither works.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const field = document.createElement("textarea");
    field.value = text;
    field.setAttribute("readonly", "");
    field.style.position = "fixed";
    field.style.opacity = "0";
    document.body.append(field);
    field.select();
    try {
      return document.execCommand("copy");
    } catch {
      return false;
    } finally {
      field.remove();
    }
  }
}

export function transposeLabel(semitones: number): string {
  return semitones > 0 ? `+${semitones}` : String(semitones);
}

/** Per-viewer display preferences; storage may be unavailable. */
export function readPreference(key: string): string | null {
  try {
    return localStorage.getItem(`psa150-${key}`);
  } catch {
    return null;
  }
}

export function writePreference(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(`psa150-${key}`);
    else localStorage.setItem(`psa150-${key}`, value);
  } catch {
    // Preferences are a convenience; ignore blocked storage.
  }
}
