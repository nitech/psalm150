import { confirm } from "@tauri-apps/plugin-dialog";
import { api } from "./api";
import { installChordViewer } from "./shared/songs/chord-viewer.ts";
import { setSongHost, type ToastOptions } from "./shared/songs/host.ts";
import { installLyricsCopy } from "./shared/songs/song-preview.ts";
import type { Recordings } from "./shared/songs/song-media.ts";

/**
 * Sets up the song modules shared with the song server's web client
 * (src/shared/songs/): their toasts go to the console's toast, confirming
 * uses the app's own dialog, a tapped chord opens how to play it, and web
 * links open in the browser instead of inside the app.
 */
export function installSongModules(toast: (message: string, options: ToastOptions) => void): void {
  setSongHost({
    toast,
    confirm: (message) => confirm(message, { title: "Psalm150", kind: "warning" }),
  });
  installChordViewer();
  installLyricsCopy();
  document.addEventListener("click", (event) => {
    const link = (event.target as Element).closest?.<HTMLAnchorElement>("a[href]");
    if (!link || !/^https?:/i.test(link.href) || link.target !== "_blank") return;
    event.preventDefault();
    void api.openLink(link.href).catch((error) => toast(String(error), { error: true }));
  });
}

/** Recordings on the song server, through the desktop's device token. */
export function desktopRecordings(canEdit: boolean): Recordings {
  return {
    canEdit,
    list: (songId) => api.listSongRecordings(songId),
    add: (songId, audio, durationMs) => api.addSongRecording(songId, audio, durationMs),
    link: (songId, recordingId) => api.songRecordingLink(songId, recordingId),
    remove: (songId, recordingId) => api.deleteSongRecording(songId, recordingId),
  };
}
