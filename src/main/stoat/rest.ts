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

  /** Per `GET /users/{target}` — used to lazily resolve an author id the client hasn't seen before (e.g. a live message from someone outside Ready's initial user snapshot). */
  getUser(userId: string): Promise<RawStoatUser> {
    return this.request("GET", `/users/${userId}`);
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
   * `GET /servers/{target}/members` — confirmed real via the OpenAPI spec
   * (`AllMemberResponse`: `{ members: Member[], users: User[] }`). The
   * gateway's own Ready payload does NOT include every server's full
   * member list (only ever carried the current user's own membership in
   * practice), so a real member list needs this REST call per server,
   * fetched when a server is actually opened rather than upfront for all
   * of them.
   */
  getServerMembers(serverId: string): Promise<RawStoatBulkMembers> {
    return this.request("GET", `/servers/${serverId}/members`);
  }

  pinMessage(channelId: string, messageId: string): Promise<void> {
    return this.request("POST", `/channels/${channelId}/messages/${messageId}/pin`);
  }

  /** `PUT/DELETE .../reactions/{emoji}` — confirmed real via the OpenAPI spec. `emoji` is the raw unicode character itself for a standard emoji reaction (custom server emoji aren't supported by this pass), matching the `Message.reactions` hashmap's own "emoji ID" keys. */
  addReaction(channelId: string, messageId: string, emoji: string): Promise<void> {
    return this.request("PUT", `/channels/${channelId}/messages/${messageId}/reactions/${encodeURIComponent(emoji)}`);
  }

  removeReaction(channelId: string, messageId: string, emoji: string): Promise<void> {
    return this.request("DELETE", `/channels/${channelId}/messages/${messageId}/reactions/${encodeURIComponent(emoji)}`);
  }

  unpinMessage(channelId: string, messageId: string): Promise<void> {
    return this.request("DELETE", `/channels/${channelId}/messages/${messageId}/pin`);
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
  /** Required on the real `User` schema — whether the user is currently online at all. */
  online?: boolean;
  /** `status.presence`: "Online" | "Idle" | "Focus" | "Busy" | "Invisible" — confirmed real via the OpenAPI `Presence` schema. */
  status?: { text?: string | null; presence?: string | null } | null;
}

export interface RawStoatFile {
  _id: string;
  filename: string;
  content_type: string;
  metadata: { type: string; width?: number; height?: number };
}

export interface RawStoatMessage {
  _id: string;
  channel: string;
  author: string;
  content?: string | null;
  user?: RawStoatUser | null;
  /** Real field on the Message schema — confirmed via the OpenAPI spec, not derived. */
  pinned?: boolean;
  attachments?: RawStoatFile[] | null;
  edited?: string | null;
  /** Hashmap of emoji "id" (the raw unicode character, for a standard reaction) to the array of user ids who reacted with it — confirmed real via the OpenAPI Message schema. */
  reactions?: Record<string, string[]>;
}

export interface RawStoatBulkMessages {
  messages: RawStoatMessage[];
  users: RawStoatUser[];
}

export interface RawStoatMember {
  _id: { server: string; user: string };
  nickname?: string | null;
  avatar?: { _id: string } | null;
}

export interface RawStoatBulkMembers {
  members: RawStoatMember[];
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
