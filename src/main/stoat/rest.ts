const API_BASE = "https://api.stoat.chat";

export class StoatRestError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message);
  }
}

/**
 * Minimal Stoat REST client — verified against Stoat's own published
 * OpenAPI spec (stoat.chat/api/openapi.json, fetched and inspected
 * directly rather than guessed), grown endpoint by endpoint the same way
 * discord/rest.ts is. Auth is a plain `x-session-token` header (an API
 * key, not a bearer token — confirmed in the spec's securitySchemes).
 */
export class StoatRestClient {
  constructor(private token: string) {}

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(API_BASE + path, {
      method,
      headers: {
        "x-session-token": this.token,
        ...(body !== undefined ? { "content-type": "application/json" } : {})
      },
      body: body !== undefined ? JSON.stringify(body) : undefined
    });
    if (!res.ok) {
      let detail = res.statusText;
      try {
        const data = (await res.json()) as { type?: string };
        if (data.type) detail = data.type;
      } catch {
        // keep statusText
      }
      throw new StoatRestError(res.status, detail);
    }
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }

  getSelf(): Promise<RawStoatUser> {
    return this.request("GET", "/users/@me");
  }

  /**
   * `include_users=true` switches the response from a bare message array
   * to `{ messages, users, members? }` — confirmed via the OpenAPI spec's
   * `BulkMessageResponse` schema, not assumed. Without this, `message.user`
   * is usually absent (only `author`, a bare user ID), which is exactly
   * why messages were rendering with "?" for every name/avatar before.
   */
  getMessages(channelId: string, limit = 50): Promise<RawStoatBulkMessages> {
    return this.request("GET", `/channels/${channelId}/messages?limit=${limit}&include_users=true`);
  }

  createMessage(channelId: string, content: string): Promise<RawStoatMessage> {
    return this.request("POST", `/channels/${channelId}/messages`, { content });
  }

  /** Per the OpenAPI spec's `GET /users/dms` — returns every open DM and group-DM channel. */
  getDMs(): Promise<RawStoatChannel[]> {
    return this.request("GET", "/users/dms");
  }

  /**
   * The unauthenticated "Query Node" root endpoint — returns real, live
   * server configuration including the actual file/CDN service ("autumn")
   * base URL. Confirmed live: `curl https://api.stoat.chat/` returns
   * `features.autumn.url = "https://cdn.stoatusercontent.com"` today —
   * fetched dynamically here rather than hardcoded, since guessing this
   * URL (or trusting a stale third-party doc that still said the old
   * `autumn.revolt.chat` host) is exactly what broke every icon/avatar
   * before this fix.
   */
  getConfig(): Promise<RawStoatConfig> {
    return this.request("GET", "/");
  }
}

export interface RawStoatUser {
  _id: string;
  username: string;
  display_name?: string | null;
  avatar?: { _id: string; tag: string } | null;
  /** Only present on users returned via READY/bulk-message-response's `users` array — per docs, describes the *current user's* relationship with this user. */
  relationship?: string;
}

export interface RawStoatMessage {
  _id: string;
  channel: string;
  author: string;
  content?: string | null;
  user?: RawStoatUser | null;
}

export interface RawStoatBulkMessages {
  messages: RawStoatMessage[];
  users: RawStoatUser[];
}

export interface RawStoatChannel {
  _id: string;
  channel_type: string;
  name?: string;
  server?: string;
  recipients?: string[];
  icon?: { _id: string } | null;
}

export interface RawStoatConfig {
  features: {
    autumn: { enabled: boolean; url: string };
  };
}
