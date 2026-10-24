import { icon } from "./icons.ts";

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

export function roleName(role: string): string {
  return role === "owner" ? "Owner" : role === "leader" ? "Leader" : "Viewer";
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

/** The day-and-month tile shown beside a set; hidden from screen readers. */
export function dateBadge(value: string | null): string {
  // Decorative: the date is also in words beside it (or in the row's label).
  if (!value) return `<span class="date-badge" aria-hidden="true"><small>No date</small></span>`;
  const [year, month, day] = value.split("-").map(Number);
  const monthName = new Date(year, month - 1, 1).toLocaleDateString(undefined, { month: "short" });
  return `<span class="date-badge" aria-hidden="true"><strong>${day}</strong><small>${escapeHtml(monthName)}</small></span>`;
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
/** The toast is hovered or holds focus, so it stays until that ends. */
let toastHeld = false;
let toastDelay = 0;

export interface ToastOptions {
  error?: boolean;
  /** A button in the toast, such as Undo. The toast then stays a little longer. */
  action?: { label: string; run: () => void };
}

/**
 * How long a toast stays, in ms. Errors stay until closed, since they may be
 * the only place a failure is told (WCAG 2.2.1); a toast with a button stays
 * long enough to reach it. Hovering or focusing a toast holds it.
 */
export function toastDuration(message: string, options: { error?: boolean; action?: boolean }): number | null {
  if (options.error) return null;
  // About a second for every 12 characters, never under five.
  const reading = Math.max(5000, Math.round(message.length / 12) * 1000);
  return options.action ? Math.max(reading, 10_000) : reading;
}

export function showToast(message: string, options: boolean | ToastOptions = false): void {
  const toast = document.querySelector<HTMLElement>("#toast");
  if (!toast) return;
  const { error = false, action } = typeof options === "boolean" ? { error: options } : options;
  bindToast(toast);
  const text = document.createElement("span");
  text.textContent = message;
  toast.replaceChildren(text);
  if (action) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "toast-action";
    button.textContent = action.label;
    button.addEventListener("click", () => {
      hideToast();
      action.run();
    }, { once: true });
    toast.append(button);
  }
  if (error) {
    const close = document.createElement("button");
    close.type = "button";
    close.className = "toast-close";
    close.setAttribute("aria-label", "Dismiss");
    close.innerHTML = icon("close");
    close.addEventListener("click", hideToast, { once: true });
    toast.append(close);
  }
  toast.classList.toggle("error", error);
  toast.classList.toggle("has-action", Boolean(action) || error);
  toast.classList.add("visible");
  window.clearTimeout(toastTimer);
  toastDelay = toastDuration(message, { error, action: Boolean(action) }) ?? 0;
  // Held only while a mouse is over it or focus is in it now, never by an
  // earlier toast's state.
  toastHeld = toastInUse(toast);
  if (toastDelay && !toastHeld) toastTimer = window.setTimeout(hideToast, toastDelay);
}

export function hideToast(): void {
  window.clearTimeout(toastTimer);
  const toast = document.querySelector<HTMLElement>("#toast");
  if (!toast) return;
  // Focus inside the toast would be lost as it goes; return it to the page.
  if (toast.contains(document.activeElement)) document.querySelector<HTMLElement>("#page")?.focus({ preventScroll: true });
  toast.classList.remove("visible");
  toastHeld = false;
}

/**
 * A mouse is over the toast or focus is in it. Touch does not count: on a
 * phone a tap leaves the toast `:hover` until something else is tapped, which
 * kept toasts on screen for good.
 */
function toastInUse(toast: HTMLElement): boolean {
  return (matchMedia("(hover: hover)").matches && toast.matches(":hover")) || toast.contains(document.activeElement);
}

/** A mouse over it and focus hold the toast; Escape closes it. Bound once per toast element. */
function bindToast(toast: HTMLElement): void {
  if (toast.dataset.bound) return;
  toast.dataset.bound = "true";
  const hold = () => {
    toastHeld = true;
    window.clearTimeout(toastTimer);
  };
  const release = () => {
    if (toastInUse(toast)) return;
    toastHeld = false;
    if (toast.classList.contains("visible") && toastDelay) toastTimer = window.setTimeout(hideToast, toastDelay);
  };
  toast.addEventListener("pointerenter", (event) => {
    if (event.pointerType === "mouse") hold();
  });
  toast.addEventListener("focusin", hold);
  toast.addEventListener("pointerleave", (event) => {
    if (event.pointerType === "mouse") release();
  });
  toast.addEventListener("focusout", () => queueMicrotask(release));
  toast.addEventListener("keydown", (event) => {
    if (event.key === "Escape") hideToast();
  });
}

/**
 * Shows an error under a form, read out by screen readers (the message is a
 * live region). With `field`, the field is marked invalid and described by
 * the message until it is changed, and gets focus.
 */
export function showFormError(form: HTMLElement, message: string, field?: HTMLInputElement | HTMLTextAreaElement | null): void {
  const output = form.querySelector<HTMLElement>(".form-message");
  if (!output) return;
  output.textContent = message;
  if (!field) return;
  if (!output.id) output.id = `message-${Math.random().toString(36).slice(2, 8)}`;
  field.setAttribute("aria-invalid", "true");
  const described = (field.getAttribute("aria-describedby") ?? "").split(" ").filter(Boolean);
  if (!described.includes(output.id)) field.setAttribute("aria-describedby", [...described, output.id].join(" "));
  field.addEventListener("input", () => {
    field.removeAttribute("aria-invalid");
    const rest = (field.getAttribute("aria-describedby") ?? "").split(" ").filter((id) => id && id !== output.id);
    if (rest.length) field.setAttribute("aria-describedby", rest.join(" "));
    else field.removeAttribute("aria-describedby");
  }, { once: true });
  field.focus();
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

/**
 * The × at the right of a search field, after its input: shown while the
 * field has text (CSS), and `installSearchClear` empties the field on a tap.
 */
export const searchClear = `<button type="button" class="search-clear" aria-label="Clear search" title="Clear search">${icon("close")}</button>`;

/**
 * Empties the search field whose × was tapped, as if the text had been
 * deleted (an `input` event, so its screen searches again), and keeps
 * focus in it for the next search.
 */
export function installSearchClear(): void {
  document.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest(".search-clear");
    const input = button?.parentElement?.querySelector<HTMLInputElement>("input");
    if (!input) return;
    input.value = "";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.focus();
  });
}
