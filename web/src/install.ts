/** Installing the web client as an app (home screen, dock or start menu). */

interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

let deferred: InstallPromptEvent | null = null;

// Chrome and Edge offer installation through this event. Keep it for the
// "Install" row under More instead of the browser's own banner.
window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  deferred = event as InstallPromptEvent;
});
window.addEventListener("appinstalled", () => {
  deferred = null;
});

export function isStandalone(): boolean {
  return matchMedia("(display-mode: standalone)").matches
    || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

function isIos(): boolean {
  return /iPad|iPhone|iPod/.test(navigator.userAgent)
    || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

/**
 * `prompt`: the browser can install it with one tap. `ios`: Safari needs
 * Share → Add to Home Screen. `none`: installed already, or not offered.
 */
export function installOption(): "prompt" | "ios" | "none" {
  if (isStandalone()) return "none";
  if (deferred) return "prompt";
  return isIos() ? "ios" : "none";
}

/** Shows the browser's install dialog; true when the person accepted. */
export async function promptInstall(): Promise<boolean> {
  const event = deferred;
  if (!event) return false;
  deferred = null;
  await event.prompt();
  return (await event.userChoice).outcome === "accepted";
}
