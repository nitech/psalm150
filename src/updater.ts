import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { ask } from "@tauri-apps/plugin-dialog";

/** Check GitHub Releases for a newer build and prompt to install. */
export async function checkForUpdates(): Promise<void> {
  try {
    const update = await check();
    if (!update) return;

    const install = await ask(
      `Version ${update.version} is available. Install now?`,
      { title: "Update Available", kind: "info" },
    );
    if (!install) return;

    await update.downloadAndInstall();
    await relaunch();
  } catch (error) {
    console.warn("Update check failed:", error);
  }
}
