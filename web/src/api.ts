import type {
  DesktopAuthCode,
  DesktopTokenResponse,
  DeviceToken,
  DeviceTokenSummary,
  RemoteCommand,
  RemoteCommandRequest,
  RemoteDesktop,
  ServerInfo,
  SetDetail,
  SetItemInput,
  SetSummary,
  Session,
  SetupStatus,
  SongDetail,
  SongSummary,
} from "./types.ts";

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

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export class SongServerApi {
  constructor(private readonly token: () => string | null) {}

  info(): Promise<ServerInfo> {
    return this.request("/info");
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

  /** One page of songs in title order; a short page means there are no more. */
  listSongs(search = "", page: { limit?: number; offset?: number } = {}): Promise<SongSummary[]> {
    const query = new URLSearchParams();
    if (search) query.set("q", search);
    if (page.limit) query.set("limit", String(page.limit));
    if (page.offset) query.set("offset", String(page.offset));
    const text = query.toString();
    return this.request(`/songs${text ? `?${text}` : ""}`);
  }

  getSong(id: string): Promise<SongDetail> {
    return this.request(`/songs/${id}`);
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

  listDesktops(): Promise<RemoteDesktop[]> {
    return this.request("/remote/desktops");
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

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
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
