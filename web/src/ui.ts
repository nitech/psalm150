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

/** The day-and-month tile shown beside a set. */
export function dateBadge(value: string | null): string {
  if (!value) return `<span class="date-badge"><small>No date</small></span>`;
  const [year, month, day] = value.split("-").map(Number);
  const monthName = new Date(year, month - 1, 1).toLocaleDateString(undefined, { month: "short" });
  return `<span class="date-badge"><strong>${day}</strong><small>${escapeHtml(monthName)}</small></span>`;
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

let toastTimer = 0;

export interface ToastOptions {
  error?: boolean;
  /** A button in the toast, such as Undo. The toast then stays a little longer. */
  action?: { label: string; run: () => void };
}

export function showToast(message: string, options: boolean | ToastOptions = false): void {
  const toast = document.querySelector<HTMLElement>("#toast");
  if (!toast) return;
  const { error = false, action } = typeof options === "boolean" ? { error: options } : options;
  const text = document.createElement("span");
  text.textContent = message;
  toast.replaceChildren(text);
  if (action) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "toast-action";
    button.textContent = action.label;
    button.addEventListener("click", () => {
      toast.classList.remove("visible");
      action.run();
    }, { once: true });
    toast.append(button);
  }
  toast.classList.toggle("error", error);
  toast.classList.toggle("has-action", Boolean(action));
  toast.classList.add("visible");
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast.classList.remove("visible"), action ? 6000 : 3200);
}

export interface Poller {
  /** Resolves after the first tick. */
  first: Promise<void>;
  /** Tick again after `delay` ms instead of the usual interval. */
  soon(delay: number): void;
  stop(): void;
}

/**
 * Runs `tick` now and then every `interval()` ms, but only while the page is
 * visible: a locked phone or a background tab does not keep asking the server.
 * Coming back to the page ticks at once.
 */
export function startPolling(tick: () => Promise<void>, interval: () => number): Poller {
  let timer = 0;
  let stopped = false;
  let running = false;
  const schedule = (delay: number) => {
    window.clearTimeout(timer);
    if (!stopped && !document.hidden) timer = window.setTimeout(run, delay);
  };
  const run = async (): Promise<void> => {
    if (stopped || running) return;
    running = true;
    try {
      await tick();
    } finally {
      running = false;
      schedule(interval());
    }
  };
  const visibility = () => {
    if (document.hidden) window.clearTimeout(timer);
    else void run();
  };
  document.addEventListener("visibilitychange", visibility);
  return {
    first: run(),
    soon: (delay) => schedule(delay),
    stop() {
      stopped = true;
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", visibility);
    },
  };
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
