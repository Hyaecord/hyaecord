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

  /**
   * `flags` is real Discord API surface — per docs.discord.food/resources/message,
   * the message-create body accepts `flags`, and only SUPPRESS_EMBEDS,
   * SUPPRESS_NOTIFICATIONS (1 << 12 = 4096, "send silently"), and
   * VOICE_MESSAGE may be set this way. This is the actual REST-level
   * mechanism — not the "@silent " content prefix some client mods use,
   * which only works because it's parsed and stripped by Discord's own
   * official composer before the request is built; a client that talks to
   * the REST API directly (like this one) has to set the real flag.
   */
  createMessage(channelId: string, content: string, flags?: number): Promise<RawMessage> {
    return this.request("POST", `/channels/${channelId}/messages`, flags ? { content, flags } : { content });
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

  /**
   * GIF search/trending, proxied through Discord's own API — per
   * docs.discord.food/resources/integration: `GET /gifs/search` and
   * `GET /gifs/trending-gifs`, both sourced from Tenor but authenticated
   * with the user's own Discord token rather than a separate Tenor API key.
   */
  searchGifs(query: string): Promise<RawGif[]> {
    return this.request("GET", `/gifs/search?q=${encodeURIComponent(query)}&media_format=mp4`);
  }

  trendingGifs(): Promise<RawGif[]> {
    return this.request("GET", "/gifs/trending-gifs?media_format=mp4");
  }

  /**
   * Per docs.discord.food/resources/user: `PATCH /users/@me` with `avatar`
   * as a data URI (`data:image/png;base64,...`), or `null` to reset to the
   * default avatar.
   */
  updateAvatar(dataUri: string | null): Promise<{ avatar: string | null }> {
    return this.request("PATCH", "/users/@me", { avatar: dataUri });
  }

  /**
   * Per docs.discord.food/resources/message: `GET /guilds/{guild.id}/messages/search`
   * (guild-wide) and `GET /channels/{channel.id}/messages/search` (a single
   * private channel — used for DMs, which have no guild). Both share the
   * same query params and response shape; only `content` is used here, the
   * documented surface is much larger (author/channel/attachment filters,
   * sort mode, pagination) but nothing in the UI needs it yet. A 202 with a
   * `documents_indexed`/`retry_after` body (not an error — still `res.ok`)
   * means the guild/channel hasn't finished being indexed yet; callers must
   * check for that shape rather than assume `messages` is always present.
   */
  searchGuildMessages(guildId: string, content: string): Promise<RawSearchResponse> {
    return this.request("GET", `/guilds/${guildId}/messages/search?content=${encodeURIComponent(content)}`);
  }

  searchChannelMessages(channelId: string, content: string): Promise<RawSearchResponse> {
    return this.request("GET", `/channels/${channelId}/messages/search?content=${encodeURIComponent(content)}`);
  }
}

export interface RawSearchResponse {
  total_results?: number;
  messages?: RawMessage[][];
  documents_indexed?: number;
  retry_after?: number;
}

export interface RawGif {
  id: string;
  url: string;
  src: string;
  gif_src: string;
  width: number;
  height: number;
  title: string;
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
    /** The user's two theme colours (premium-only gradient), per docs.discord.food/resources/user's Profile Metadata Object. */
    theme_colors?: [number, number] | null;
  };
  badges?: Array<{ id: string; description: string; icon: string; link?: string }>;
  connected_accounts?: Array<{ type: string; id: string; name: string; verified: boolean }>;
  banner?: string | null;
  accent_color?: number | null;
  premium_type?: number | null;
  premium_since?: string | null;
}

export interface RawMessage {
  id: string;
  channel_id: string;
  content: string;
  timestamp: string;
  /** Message type — 0 is a normal message, 6 is the "X pinned a message" system notice. Full enum: docs.discord.com/developers/resources/message. */
  type: number;
  author: {
    id: string;
    username: string;
    global_name?: string | null;
    avatar?: string | null;
  };
}
