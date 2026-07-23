const API_BASE = "https://discord.com/api/v10";

export class DiscordRestError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message);
  }
}

/**
 * Minimal REST client. Grows endpoint by endpoint as features need them —
 * no speculative surface.
 */
export class RestClient {
  constructor(private token: string) {}

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(API_BASE + path, {
      method,
      headers: {
        authorization: this.token,
        ...(body !== undefined ? { "content-type": "application/json" } : {})
      },
      body: body !== undefined ? JSON.stringify(body) : undefined
    });
    if (!res.ok) {
      let detail = res.statusText;
      try {
        const data = (await res.json()) as { message?: string };
        if (data.message) detail = data.message;
      } catch {
        // keep statusText
      }
      throw new DiscordRestError(res.status, detail);
    }
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }

  getCurrentUser(): Promise<{
    id: string;
    username: string;
    global_name: string | null;
    avatar: string | null;
  }> {
    return this.request("GET", "/users/@me");
  }

  getGatewayUrl(): Promise<{ url: string }> {
    return this.request("GET", "/gateway");
  }

  getMessages(channelId: string, limit = 50): Promise<RawMessage[]> {
    return this.request("GET", `/channels/${channelId}/messages?limit=${limit}`);
  }

  createMessage(channelId: string, content: string): Promise<RawMessage> {
    return this.request("POST", `/channels/${channelId}/messages`, { content });
  }

  deleteChannel(channelId: string): Promise<void> {
    return this.request("DELETE", `/channels/${channelId}`);
  }

  setGuildMuted(guildId: string, muted: boolean): Promise<void> {
    return this.request("PATCH", `/users/@me/guilds/${guildId}/settings`, { muted });
  }

  /**
   * Mutes/unmutes a single DM or group DM. Per docs.discord.food/resources/user-settings
   * (the community-maintained documentation of Discord's undocumented user
   * API — the same source class as the login endpoints above): DM/private
   * channel settings live under the guild-settings endpoint with guild.id
   * literally set to "@me", and individual channels within it are muted via
   * the same channel_overrides array used for per-channel mutes inside a
   * real guild. Higher-confidence than most of this file since it's backed
   * by fetched documentation rather than memory, but still ⚠ not exercised
   * against a real account this session — see BUILD_PROMPT.md.
   */
  setDmMuted(channelId: string, muted: boolean): Promise<void> {
    return this.request("PATCH", "/users/@me/guilds/@me/settings", {
      channel_overrides: [
        {
          channel_id: channelId,
          muted,
          mute_config: muted ? { end_time: null, selected_time_window: -1 } : null
        }
      ]
    });
  }

  /**
   * The profile popout endpoint — same data/request Discord's own client
   * uses when you click a username. Per docs.discord.food/resources/user:
   * `GET /users/{id}/profile`. Mutual guilds/friends aren't shown by this
   * app yet, so both are turned off rather than fetched and discarded.
   */
  getUserProfile(userId: string): Promise<RawUserProfile> {
    return this.request(
      "GET",
      `/users/${userId}/profile?with_mutual_guilds=false&with_mutual_friends=false&with_mutual_friends_count=false`
    );
  }
}

export interface RawUserProfile {
  user: {
    id: string;
    username: string;
    global_name: string | null;
    avatar: string | null;
    bot?: boolean;
  };
  user_profile?: {
    bio?: string | null;
    pronouns?: string | null;
  };
  badges?: Array<{ id: string; description: string; icon: string; link?: string }>;
  connected_accounts?: Array<{ type: string; id: string; name: string; verified: boolean }>;
  banner?: string | null;
  accent_color?: number | null;
  premium_type?: number | null;
  premium_since?: string | null;
}

/**
 * Unauthenticated login endpoints — used before we have a token at all, so
 * these are free functions rather than RestClient methods (RestClient
 * requires a token to construct). Same shape Discord's own web/desktop
 * client uses for email+password login: POST /auth/login, then if MFA is
 * enabled, POST /auth/mfa/totp with the code and the ticket from the first
 * response.
 *
 * ⚠ Unverified live in this session (no real account was used to test it) —
 * this is one of the most stable, widely-relied-on parts of Discord's
 * unofficial API (every self-bot library uses this exact shape), but if
 * Discord ever changes it, the errors here should surface as a clear
 * "couldn't reach Discord" rather than fail silently.
 */

export interface LoginResponse {
  token?: string;
  mfa?: boolean;
  ticket?: string;
  totp?: boolean;
  sms?: boolean;
  backup?: boolean;
  /** Present when Discord wants an hCaptcha solve — not supported yet, surfaced as a clear error. */
  captcha_key?: string[];
}

async function unauthenticatedRequest<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "user-agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36"
    },
    body: JSON.stringify(body)
  });
  const data = (await res.json().catch(() => ({}))) as T & { message?: string };
  if (!res.ok) {
    throw new DiscordRestError(res.status, (data as { message?: string }).message ?? res.statusText);
  }
  return data;
}

export function loginWithCredentials(login: string, password: string): Promise<LoginResponse> {
  return unauthenticatedRequest("/auth/login", { login, password, undelete: false });
}

/** `totp` also accepts a backup code — Discord's own client uses the same field for both. */
export type MfaMethod = "totp" | "sms" | "backup";

export function submitMfaCode(method: MfaMethod, code: string, ticket: string): Promise<LoginResponse> {
  return unauthenticatedRequest(`/auth/mfa/${method}`, { code, ticket });
}

/** Asks Discord to text a code to the account's phone number, ahead of an `/auth/mfa/sms` submit. */
export function requestMfaSms(ticket: string): Promise<{ phone?: string }> {
  return unauthenticatedRequest("/auth/mfa/sms/send", { ticket });
}

export interface RawMessage {
  id: string;
  channel_id: string;
  content: string;
  timestamp: string;
  author: {
    id: string;
    username: string;
    global_name?: string | null;
    avatar?: string | null;
  };
}
