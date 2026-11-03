/**
 * Small text and page helpers used by the song modules in both apps (the
 * song server's web client and the Psalm150 desktop app).
 *
 * Both the web client and the desktop use this folder as it is.
 */
import { locale, t, tn } from "./i18n.ts";

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
  return error instanceof Error ? error.message : t("Something went wrong.");
}

/** `m:ss`, or `h:mm:ss` from an hour. */
export function clock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = String(total % 60).padStart(2, "0");
  return hours ? `${hours}:${String(minutes).padStart(2, "0")}:${seconds}` : `${minutes}:${seconds}`;
}

/** Whole days since `value`: 0 today (or in the future), 1 yesterday. */
export function daysSince(value: string): number {
  return Math.floor((Date.now() - new Date(value).getTime()) / 86_400_000);
}

export function relativeDate(value: string): string {
  const date = new Date(value);
  const days = daysSince(value);
  if (days <= 0) return t("Today");
  if (days === 1) return t("Yesterday");
  if (days < 14) return tn(days, "{n} day ago", "{n} days ago");
  return date.toLocaleDateString(locale(), { month: "short", day: "numeric" });
}

/**
 * `relativeDate` inside a sentence ("last used yesterday"): only its first
 * letter lowered, so nouns keep their capitals ("vor 3 Tagen").
 */
export function relativeDateInline(value: string): string {
  const text = relativeDate(value);
  return text.charAt(0).toLocaleLowerCase(locale()) + text.slice(1);
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
