/**
 * What the song modules need from the app they run in, set once at start
 * with `setSongHost`: the song server's web client and the Psalm150 desktop
 * app each show toasts, ask to confirm and keep the screen on in their own
 * way. Until it is set, toasts go to the console and confirming uses the
 * browser's own dialog.
 *
 * Canonical copy: PSA150-server/shared/songs/. The desktop repo mirrors this
 * folder at src/shared/songs/ with `bun run sync:shared`; edit it here, never
 * in the mirror.
 */

export interface ToastOptions {
  error?: boolean;
  /** A button in the toast, such as Undo. */
  action?: { label: string; run: () => void };
}

export interface SongHost {
  toast(message: string, options: ToastOptions): void;
  confirm(message: string): Promise<boolean>;
  /** Keeps the screen on until the returned call (a recording in progress). */
  holdScreen(): () => void;
}

let current: SongHost = {
  toast: (message, options) => (options.error ? console.error : console.info)(message),
  confirm: async (message) => window.confirm(message),
  holdScreen: () => () => undefined,
};

export function setSongHost(host: Partial<SongHost>): void {
  current = { ...current, ...host };
}

/** `true` (or `{ error: true }`) for an error, which stays until closed. */
export function showToast(message: string, options: boolean | ToastOptions = false): void {
  current.toast(message, typeof options === "boolean" ? { error: options } : options);
}

export function confirmAction(message: string): Promise<boolean> {
  return current.confirm(message);
}

export function holdScreen(): () => void {
  return current.holdScreen();
}
