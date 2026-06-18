import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { ProjectionState, SlidePayload, SlideTheme } from "./api";

export async function listenAudienceSlide(handler: (slide: SlidePayload) => void) {
  return listen<SlidePayload>("audience-slide", (event) => handler(event.payload));
}

export function getProjectionState() {
  return invoke<ProjectionState>("get_projection_state");
}

export function getTheme() {
  return invoke<SlideTheme>("get_theme");
}

export function closeProjectionWindows() {
  return invoke<void>("close_projection_windows");
}
