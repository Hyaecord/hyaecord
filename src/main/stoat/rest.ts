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

  getMessages(channelId: string, limit = 50): Promise<RawStoatMessage[]> {
    return this.request("GET", `/channels/${channelId}/messages?limit=${limit}`);
  }

  createMessage(channelId: string, content: string): Promise<RawStoatMessage> {
    return this.request("POST", `/channels/${channelId}/messages`, { content });
  }
}

export interface RawStoatUser {
  _id: string;
  username: string;
  display_name?: string | null;
  avatar?: { _id: string; tag: string } | null;
}

export interface RawStoatMessage {
  _id: string;
  channel: string;
  author: string;
  content?: string | null;
  user?: RawStoatUser | null;
}
