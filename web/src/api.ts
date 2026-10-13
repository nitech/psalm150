import type {
  ApiToken,
  ApiTokenSummary,
  ChurchSettings,
  DesktopAuthCode,
  DesktopRoom,
  DesktopTokenResponse,
  DeviceToken,
  DeviceTokenSummary,
  Member,
  RemoteCommand,
  RemoteCommandRequest,
  RemoteDesktop,
  Role,
  RoomView,
  ServerInfo,
  SetDetail,
  SetItemInput,
  SetLive,
  SetShare,
  SetSummary,
  SharedSet,
  Session,
  SessionInfo,
  SetupStatus,
  SongDetail,
  SongSort,
  SongSummary,
  SortDirection,
} from "./types.ts";
import type { OpenApiDocument } from "./views/api-docs.ts";

const API_ROOT = "/api/v1";

/** `fetch`, with a readable error when the phone has no connection. */
async function send(url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch {
    throw new ApiError(
      navigator.onLine ? "The song server did not answer. Try again." : "You are offline. Try again when you are connected.",
      0,
    );
  }
}

/**
 * Reads a server-sent event stream with `fetch` (which, unlike
 * `EventSource`, can send the bearer token), reconnecting with a growing
 * pause after a dropped connection until `signal` aborts. An error answer
 * (401, 403) ends it through `onError`.
 */
async function readEvents(
  url: string,
  headers: () => Record<string, string>,
  signal: AbortSignal,
  onEvent: (event: string, data: string) => void,
  onError: (error: ApiError) => void,
): Promise<void> {
  let pause = 1000;
  while (!signal.aborted) {
    try {
      const response = await fetch(url, { headers: { Accept: "text/event-stream", ...headers() }, cache: "no-store", signal });
      if (response.status >= 400 && response.status < 500) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        onError(new ApiError(body?.error ?? `Request failed (${response.status})`, response.status));
        return;
      }
      if (!response.ok || !response.body) throw new Error(`Request failed (${response.status})`);
      pause = 1000;
      const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
      let buffer = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += value.replace(/\r\n?/g, "\n");
        let end: number;
        while ((end = buffer.indexOf("\n\n")) >= 0) {
          const block = buffer.slice(0, end);
          buffer = buffer.slice(end + 2);
          let event = "message";
          const data: string[] = [];
          for (const line of block.split("\n")) {
            if (line.startsWith("event:")) event = line.slice(6).trim();
            else if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
          }
          if (data.length) onEvent(event, data.join("\n"));
        }
      }
    } catch {
      if (signal.aborted) return;
    }
    await new Promise((resolve) => window.setTimeout(resolve, pause));
    pause = Math.min(pause * 2, 15000);
  }
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/** Reads of one song or set that may be answered from memory for a short while. */
const REMEMBERED = [
  /^\/(?:public\/)?songs\/[0-9a-f-]{36}$/i,
  /^\/sets\/[0-9a-f-]{36}$/i,
  /^\/public\/sets\/[^/]+\/songs\/[0-9a-f-]{36}$/i,
];
/** How long such a read is reused. Any change made from this app forgets them all. */
const REMEMBER_MS = 30_000;

export class SongServerApi {
  constructor(private readonly token: () => string | null) {}

  /**
   * Recent reads of single songs and sets, so a link touched a moment ago
   * (read as the finger landed) or an item swiped back to opens at once.
   */
  private readonly remembered = new Map<string, { at: number; value: Promise<unknown> }>();

  info(): Promise<ServerInfo> {
    return this.request("/info");
  }

  /** The server's OpenAPI document (outside `/api/v1`), for the API reference. */
  async openApi(): Promise<OpenApiDocument> {
    const response = await send("/api/openapi.json", {});
    if (!response.ok) throw await this.error(response);
    return response.json() as Promise<OpenApiDocument>;
  }

  setupStatus(): Promise<SetupStatus> {
    return this.request("/setup");
  }

  setup(input: {
    church_name: string;
    owner_name: string;
    username: string;
    password: string;
  }): Promise<Session> {
    return this.request("/setup", { method: "POST", body: JSON.stringify(input) });
  }

  login(username: string, password: string): Promise<Session> {
    return this.request("/session", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    });
  }

  /** Who the token belongs to and its role now, which an owner may have changed. */
  currentSession(): Promise<SessionInfo> {
    return this.request("/session");
  }

  /** Signs out on the server too: `token` stops working. */
  async endSession(token: string): Promise<void> {
    await this.requestEmpty("/session", {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
  }

  /** Your other sessions end; this one and your API tokens keep working. */
  async changePassword(currentPassword: string, newPassword: string): Promise<void> {
    await this.requestEmpty("/account/password", {
      method: "PUT",
      body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }),
    });
  }

  /** Owners only, like the rest of `/members`. */
  listMembers(): Promise<Member[]> {
    return this.request("/members");
  }

  createMember(input: { username: string; display_name: string; password: string; role: Role }): Promise<Member> {
    return this.request("/members", { method: "POST", body: JSON.stringify(input) });
  }

  /** Fields left out stay as they are. */
  updateMember(
    userId: string,
    input: { role?: Role; display_name?: string; username?: string; password?: string; disabled?: boolean },
  ): Promise<Member> {
    return this.request(`/members/${userId}`, { method: "PATCH", body: JSON.stringify(input) });
  }

  async removeMember(userId: string): Promise<void> {
    await this.requestEmpty(`/members/${userId}`, { method: "DELETE" });
  }

  getChurch(): Promise<ChurchSettings> {
    return this.request("/church");
  }

  /**
   * Owners only: rename the church, open the library to anyone (read only)
   * or close it, or open or close the desktops' rooms.
   */
  updateChurch(input: { name?: string; public_library?: boolean; public_rooms?: boolean }): Promise<ChurchSettings> {
    return this.request("/church", { method: "PUT", body: JSON.stringify(input) });
  }

  /** Your API tokens; an owner gets everyone's. */
  listApiTokens(): Promise<ApiTokenSummary[]> {
    return this.request("/api-tokens");
  }

  /** A token that acts as you, with at most `role`; shown once. */
  createApiToken(input: { name: string; role?: Role; expires_at?: string }): Promise<ApiToken> {
    return this.request("/api-tokens", { method: "POST", body: JSON.stringify(input) });
  }

  async revokeApiToken(id: string): Promise<void> {
    await this.requestEmpty(`/api-tokens/${id}`, { method: "DELETE" });
  }

  /**
   * One page of songs in title order; a short page means there are no more.
   * Signed out, this reads the public library.
   */
  listSongs(
    search = "",
    page: { limit?: number; offset?: number; sort?: SongSort; direction?: SortDirection } = {},
  ): Promise<SongSummary[]> {
    const query = new URLSearchParams();
    if (search) query.set("q", search);
    if (page.limit) query.set("limit", String(page.limit));
    if (page.offset) query.set("offset", String(page.offset));
    if (page.sort && page.sort !== "title") query.set("sort", page.sort);
    if (page.direction === "desc") query.set("direction", "desc");
    const text = query.toString();
    return this.request(`${this.songsRoot()}${text ? `?${text}` : ""}`);
  }

  /** Signed out, this reads the public library. */
  getSong(id: string): Promise<SongDetail> {
    return this.request(`${this.songsRoot()}/${id}`);
  }

  private songsRoot(): string {
    return this.token() ? "/songs" : "/public/songs";
  }

  createSong(chordpro: string): Promise<SongSummary> {
    return this.request("/songs", {
      method: "POST",
      body: JSON.stringify({ chordpro }),
    });
  }

  updateSong(id: string, baseRevisionId: string, chordpro: string): Promise<SongDetail> {
    return this.request(`/songs/${id}`, {
      method: "PUT",
      body: JSON.stringify({ base_revision_id: baseRevisionId, chordpro }),
    });
  }

  listSets(): Promise<SetSummary[]> {
    return this.request("/sets");
  }

  /** `fresh` skips the offline copy: use it for a read that an edit builds on. */
  getSet(id: string, options: { fresh?: boolean } = {}): Promise<SetDetail> {
    return this.request(`/sets/${id}`, options.fresh ? { cache: "no-store" } : {});
  }

  createSet(input: { name: string; service_date: string | null; items: SetItemInput[] }): Promise<SetDetail> {
    return this.request("/sets", { method: "POST", body: JSON.stringify(input) });
  }

  /** 409 when someone else changed the set since `baseVersion`. */
  updateSet(
    id: string,
    baseVersion: number,
    input: { name: string; service_date: string | null; items: SetItemInput[] },
  ): Promise<SetDetail> {
    return this.request(`/sets/${id}`, {
      method: "PUT",
      body: JSON.stringify({ base_version: baseVersion, ...input }),
    });
  }

  async deleteSet(id: string, baseVersion: number): Promise<void> {
    await this.requestEmpty(`/sets/${id}?base_version=${baseVersion}`, { method: "DELETE" });
  }

  /** Leaders: the set's share link; 404 when it is not shared. */
  getSetShare(id: string): Promise<SetShare> {
    return this.request(`/sets/${id}/share`, { cache: "no-store" });
  }

  /** Leaders: shares the set on a link (keeping a link it has), or changes whether the link may edit it. */
  shareSet(id: string, editable: boolean): Promise<SetShare> {
    return this.request(`/sets/${id}/share`, { method: "PUT", body: JSON.stringify({ editable }) });
  }

  /** Leaders: the link stops working; sharing again makes a new one. */
  async stopSharingSet(id: string): Promise<void> {
    await this.requestEmpty(`/sets/${id}/share`, { method: "DELETE" });
  }

  /** Who leads the set live and how many shared-link pages have it open. */
  getSetLive(id: string): Promise<SetLive> {
    return this.request(`/sets/${id}/live`, { cache: "no-store" });
  }

  /** Leaders: everyone with the shared link moves to this item. Send on every move and every 30 s. */
  leadSet(id: string, itemId: string): Promise<SetLive> {
    return this.request(`/sets/${id}/live`, { method: "PUT", body: JSON.stringify({ item_id: itemId }) });
  }

  /** Leaders: stop leading; shared-link pages stay where they are. */
  async stopLeadingSet(id: string): Promise<void> {
    await this.requestEmpty(`/sets/${id}/live`, { method: "DELETE" });
  }

  /** Anyone with the link: the shared set. 404 when the link was stopped. */
  getSharedSet(key: string): Promise<SharedSet> {
    return this.request(`/public/sets/${encodeURIComponent(key)}`, { cache: "no-store" });
  }

  /** Anyone with the link: a song of the set (any song of the library through an editable link). */
  getSharedSong(key: string, songId: string): Promise<SongDetail> {
    return this.request(`/public/sets/${encodeURIComponent(key)}/songs/${songId}`);
  }

  /** Anyone with an editable link: searches the church's songs. */
  searchSharedSongs(key: string, search: string): Promise<SongSummary[]> {
    const query = search ? `?q=${encodeURIComponent(search)}` : "";
    return this.request(`/public/sets/${encodeURIComponent(key)}/songs${query}`);
  }

  /** Anyone with an editable link: adds a song at `position`, or at the end. */
  addSharedSong(key: string, songId: string, position?: number): Promise<SharedSet> {
    return this.request(`/public/sets/${encodeURIComponent(key)}/items`, {
      method: "POST",
      body: JSON.stringify({ song_id: songId, position }),
    });
  }

  /** Anyone with an editable link: removes a song from the set. */
  removeSharedSong(key: string, itemId: string): Promise<SharedSet> {
    return this.request(`/public/sets/${encodeURIComponent(key)}/items/${itemId}`, { method: "DELETE" });
  }

  listDesktops(): Promise<RemoteDesktop[]> {
    return this.request("/remote/desktops");
  }

  /**
   * The desktop list as it changes, pushed by the server. Reconnects after
   * a dropped connection; stops when `signal` aborts. A 401 is passed to
   * `onError` and ends it.
   */
  watchDesktops(
    onList: (desktops: RemoteDesktop[]) => void,
    onError: (error: ApiError) => void,
    signal: AbortSignal,
  ): void {
    void readEvents(`${API_ROOT}/remote/desktops/events`, () => this.headers(false), signal, (event, data) => {
      if (event === "desktops") onList(JSON.parse(data) as RemoteDesktop[]);
    }, onError);
  }

  /** A leader renames a desktop's room; `null` picks a new random flower. */
  renameDesktopRoom(deviceId: string, roomName: string | null): Promise<DesktopRoom> {
    return this.request(`/device-tokens/${deviceId}/room`, {
      method: "PUT",
      body: JSON.stringify({ room_name: roomName }),
    });
  }

  /** Anyone: what a room shows now. 404 when there is no such room. */
  getRoom(roomName: string): Promise<RoomView> {
    return this.request(`/public/rooms/${encodeURIComponent(roomName)}`, { cache: "no-store" });
  }

  sendRemoteCommand(deviceId: string, command: RemoteCommandRequest): Promise<RemoteCommand> {
    return this.request(`/remote/desktops/${deviceId}/commands`, {
      method: "POST",
      body: JSON.stringify(command),
    });
  }

  importSongs(songs: Array<{ filename: string; chordpro: string }>): Promise<{ songs: SongSummary[]; skipped_existing: number }> {
    return this.request("/songs/import", {
      method: "POST",
      body: JSON.stringify({ songs }),
    });
  }

  createDeviceToken(name: string): Promise<DeviceToken> {
    return this.request("/device-tokens", {
      method: "POST",
      body: JSON.stringify({ name }),
    });
  }

  listDeviceTokens(): Promise<DeviceTokenSummary[]> {
    return this.request("/device-tokens");
  }

  async revokeDeviceToken(id: string): Promise<void> {
    await this.requestEmpty(`/device-tokens/${id}`, { method: "DELETE" });
  }

  /** Approve a desktop: a one-time code for its loopback redirect. */
  createDesktopAuthCode(deviceName: string, codeChallenge: string): Promise<DesktopAuthCode> {
    return this.request("/desktop-auth/codes", {
      method: "POST",
      body: JSON.stringify({ device_name: deviceName, code_challenge: codeChallenge }),
    });
  }

  /** Used by desktops, not by this client; listed so the contract stays public. */
  exchangeDesktopAuthCode(code: string, codeVerifier: string): Promise<DesktopTokenResponse> {
    return this.request("/desktop-auth/token", {
      method: "POST",
      body: JSON.stringify({ code, code_verifier: codeVerifier }),
    });
  }

  async exportSongs(): Promise<Blob> {
    const response = await send(`${API_ROOT}/songs/export`, {
      headers: this.headers(false),
    });
    if (!response.ok) {
      throw await this.error(response);
    }
    return response.blob();
  }

  private request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const method = (init.method ?? "GET").toUpperCase();
    if (method !== "GET") {
      this.remembered.clear();
      return this.fetchJson<T>(path, init);
    }
    if (init.cache || !REMEMBERED.some((pattern) => pattern.test(path))) return this.fetchJson<T>(path, init);
    const key = `${this.token() ?? ""} ${path}`;
    const hit = this.remembered.get(key);
    if (hit && Date.now() - hit.at < REMEMBER_MS) return hit.value as Promise<T>;
    const value = this.fetchJson<T>(path, init);
    this.remembered.set(key, { at: Date.now(), value });
    value.catch(() => {
      if (this.remembered.get(key)?.value === value) this.remembered.delete(key);
    });
    return value;
  }

  private async fetchJson<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await send(`${API_ROOT}${path}`, {
      ...init,
      headers: { ...this.headers(Boolean(init.body)), ...init.headers },
    });
    if (!response.ok) {
      throw await this.error(response);
    }
    return response.json() as Promise<T>;
  }

  private async requestEmpty(path: string, init: RequestInit): Promise<void> {
    this.remembered.clear();
    const response = await send(`${API_ROOT}${path}`, {
      ...init,
      headers: { ...this.headers(Boolean(init.body)), ...init.headers },
    });
    if (!response.ok) {
      throw await this.error(response);
    }
  }

  private headers(json: boolean): Record<string, string> {
    const headers: Record<string, string> = {};
    const token = this.token();
    if (token) headers.Authorization = `Bearer ${token}`;
    if (json) headers["Content-Type"] = "application/json";
    return headers;
  }

  private async error(response: Response): Promise<ApiError> {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    return new ApiError(body?.error ?? `Request failed (${response.status})`, response.status);
  }
}
