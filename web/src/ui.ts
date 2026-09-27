export function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    '"': "&quot;",
  })[character] ?? character);
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong.";
}

export function relativeDate(value: string): string {
  const date = new Date(value);
  const days = Math.floor((Date.now() - date.getTime()) / 86_400_000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 14) return `${days} days ago`;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** `2026-10-04` → "Sun 4 Oct" (in the reader's locale); local, not UTC. */
export function serviceDate(value: string | null, long = false): string {
  if (!value) return "No date";
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  return date.toLocaleDateString(undefined, long
    ? { weekday: "long", day: "numeric", month: "long", year: "numeric" }
    : { weekday: "short", day: "numeric", month: "short" });
}

/** Today as `YYYY-MM-DD` in local time. */
export function today(): string {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export function setFormBusy(form: HTMLElement, value: boolean): void {
  form.querySelectorAll<HTMLInputElement | HTMLButtonElement | HTMLTextAreaElement>("input,button,textarea,select")
    .forEach((control) => { control.disabled = value; });
  form.classList.toggle("busy", value);
}

let toastTimer = 0;

export function showToast(message: string, error = false): void {
  const toast = document.querySelector<HTMLElement>("#toast");
  if (!toast) return;
  toast.textContent = message;
  toast.classList.toggle("error", error);
  toast.classList.add("visible");
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast.classList.remove("visible"), 3200);
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
