/**
 * Keeps the phone's screen on while someone reads a song: the song page and
 * the service views hold it while they are open, as long as the reader's
 * "Keep screen on" switch is on (it is, until switched off). The browser
 * drops the lock whenever the page is hidden, so it is taken again when the
 * page shows.
 */
import { readPreference, writePreference } from "./ui.ts";

type Lock = { release(): Promise<void>; released?: boolean };
type WakeLockNavigator = Navigator & { wakeLock?: { request(type: "screen"): Promise<Lock> } };

/** The reader's switch, saved on this device. */
export function keepScreenOn(): boolean {
  return readPreference("keep-awake") !== "off";
}

/** Whether this browser can keep the screen on at all. */
export function canKeepScreenOn(): boolean {
  return "wakeLock" in navigator;
}

let holders = 0;
let lock: Lock | null = null;

async function sync(): Promise<void> {
  const want = holders > 0 && keepScreenOn() && document.visibilityState === "visible";
  if (!want) {
    const held = lock;
    lock = null;
    await held?.release().catch(() => undefined);
    return;
  }
  if (lock && !lock.released) return;
  lock = (await (navigator as WakeLockNavigator).wakeLock?.request("screen").catch(() => null)) ?? null;
  // Let go while the request was out.
  if (holders === 0 || !keepScreenOn()) void sync();
}

document.addEventListener("visibilitychange", () => void sync());

/** Flips the switch and takes or lets go of the lock at once. */
export function setKeepScreenOn(on: boolean): void {
  writePreference("keep-awake", on ? null : "off");
  void sync();
}

/** Holds the screen on (when the switch is on) until the returned call. */
export function holdScreen(): () => void {
  holders += 1;
  void sync();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    holders -= 1;
    void sync();
  };
}
