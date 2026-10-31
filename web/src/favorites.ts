import type { SongServerApi } from "./api.ts";

type Listener = () => void;

/**
 * The signed-in person's favourite songs (`/favorites`), the same ones the
 * desktop app stars. Read once per sign-in; a star changes the set at once
 * and goes back if the server says no.
 */
export class Favorites {
  private ids = new Set<string>();
  private listeners = new Set<Listener>();

  constructor(private api: SongServerApi) {}

  has(songId: string): boolean {
    return this.ids.has(songId);
  }

  get count(): number {
    return this.ids.size;
  }

  async refresh(): Promise<void> {
    this.ids = new Set((await this.api.listFavorites()).song_ids);
    this.emit();
  }

  /** Stars the song, or takes the star away; true when it is now a favourite. */
  async toggle(songId: string): Promise<boolean> {
    const on = !this.ids.has(songId);
    if (on) this.ids.add(songId);
    else this.ids.delete(songId);
    this.emit();
    try {
      if (on) await this.api.addFavorite(songId);
      else await this.api.removeFavorite(songId);
    } catch (error) {
      if (on) this.ids.delete(songId);
      else this.ids.add(songId);
      this.emit();
      throw error;
    }
    return on;
  }

  clear(): void {
    this.ids = new Set();
    this.emit();
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }
}
