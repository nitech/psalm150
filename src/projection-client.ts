import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { ProjectionSnapshot } from "./api";

export async function listenProjectionUpdated(handler: (snapshot: ProjectionSnapshot) => void) {
  return listen<ProjectionSnapshot>("projection-updated", (event) => handler(event.payload));
}

export function getProjectionSnapshot() {
  return invoke<ProjectionSnapshot>("get_projection_snapshot");
}

export function closeProjectionWindows() {
  return invoke<void>("close_projection_windows");
}
