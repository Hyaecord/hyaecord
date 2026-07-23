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
