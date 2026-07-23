import WebSocket from "ws";

/**
 * Discord gateway (v10, JSON encoding) connection with heartbeat, resume,
 * and exponential reconnect backoff. Event-driven throughout — no polling
 * (BUILD_PROMPT performance core requirement).
 */

const GATEWAY_VERSION = "?v=10&encoding=json";

const enum Op {
  Dispatch = 0,
  Heartbeat = 1,
  Identify = 2,
  PresenceUpdate = 3,
  Resume = 6,
  Reconnect = 7,
  InvalidSession = 9,
  Hello = 10,
  HeartbeatAck = 11,
  /** Unofficially "Lazy Request" — subscribes to a member-list range for a channel. Per docs.discord.food / community lazy-guilds docs, not Discord's own official docs. */
  GuildSubscriptions = 14
}

interface GatewayPayload {
  op: Op;
  d?: unknown;
  s?: number | null;
  t?: string | null;
}

export type GatewayState = "idle" | "connecting" | "ready" | "reconnecting" | "closed";

export interface GatewayHandlers {
  onDispatch(event: string, data: unknown): void;
  onStateChange(state: GatewayState): void;
}

export class GatewayClient {
  private ws: WebSocket | null = null;
  private seq: number | null = null;
  private sessionId: string | null = null;
  private resumeUrl: string | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private heartbeatAcked = true;
  private reconnectAttempts = 0;
  private closedByUser = false;
  private state: GatewayState = "idle";

  constructor(
    private token: string,
    private gatewayUrl: string,
    private handlers: GatewayHandlers
  ) {}

  connect(): void {
    this.closedByUser = false;
    const resuming = this.sessionId !== null && this.resumeUrl !== null;
    this.setState(resuming ? "reconnecting" : "connecting");
    const url = (resuming ? this.resumeUrl! : this.gatewayUrl) + GATEWAY_VERSION;
    this.ws = new WebSocket(url);
    this.ws.on("message", raw => this.onMessage(JSON.parse(String(raw)) as GatewayPayload));
    this.ws.on("close", code => this.onClose(code));
    this.ws.on("error", () => {
      // close follows an error; reconnect is handled there
    });
  }

  destroy(): void {
    this.closedByUser = true;
    this.stopHeartbeat();
    this.ws?.close(1000);
    this.ws = null;
    this.setState("closed");
  }

  private setState(state: GatewayState): void {
    if (this.state === state) return;
    this.state = state;
    this.handlers.onStateChange(state);
  }

  private send(payload: GatewayPayload): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(payload));
  }

  /**
   * Requests the member-list sidebar for one channel, first 100 members
   * only (range [0, 99] — same window the official client preloads).
   * Powers the GUILD_MEMBER_LIST_UPDATE dispatches the member list renders
   * from. Undocumented officially; verified against the community lazy-guild
   * write-up rather than guessed.
   */
  subscribeMemberList(guildId: string, channelId: string): void {
    this.send({
      op: Op.GuildSubscriptions,
      d: { guild_id: guildId, channels: { [channelId]: [[0, 99]] } }
    });
  }

  /**
   * Sets or clears (`activities: []`) Rich Presence — per docs.discord.food's
   * gateway-events reference: `{ since, activities, status, afk }`. Powers
   * the RPC Bridge integration (an external app sets an activity over the
   * local RPC socket; that gets forwarded here as a real presence update).
   */
  updatePresence(activities: unknown[]): void {
    this.send({
      op: Op.PresenceUpdate,
      d: { since: null, activities, status: "online", afk: false }
    });
  }

  private onMessage(payload: GatewayPayload): void {
    if (payload.s != null) this.seq = payload.s;

    switch (payload.op) {
      case Op.Hello: {
        const { heartbeat_interval } = payload.d as { heartbeat_interval: number };
        this.startHeartbeat(heartbeat_interval);
        if (this.sessionId) {
          this.send({
            op: Op.Resume,
            d: { token: this.token, session_id: this.sessionId, seq: this.seq }
          });
        } else {
          this.identify();
        }
        break;
      }
      case Op.HeartbeatAck:
        this.heartbeatAcked = true;
        break;
      case Op.Heartbeat:
        this.send({ op: Op.Heartbeat, d: this.seq });
        break;
      case Op.Reconnect:
        this.ws?.close(4000);
        break;
      case Op.InvalidSession: {
        const resumable = payload.d === true;
        if (!resumable) {
          this.sessionId = null;
          this.resumeUrl = null;
        }
        // Discord asks for a randomized wait before re-identifying
        setTimeout(() => this.ws?.close(4000), 1000 + Math.random() * 4000);
        break;
      }
      case Op.Dispatch: {
        const event = payload.t as string;
        if (event === "READY") {
          const d = payload.d as { session_id: string; resume_gateway_url: string };
          this.sessionId = d.session_id;
          this.resumeUrl = d.resume_gateway_url;
          this.reconnectAttempts = 0;
          this.setState("ready");
        } else if (event === "RESUMED") {
          this.reconnectAttempts = 0;
          this.setState("ready");
        }
        this.handlers.onDispatch(event, payload.d);
        break;
      }
    }
  }

  private identify(): void {
    this.send({
      op: Op.Identify,
      d: {
        token: this.token,
        properties: { os: process.platform, browser: "Hyaecord", device: "Hyaecord" }
      }
    });
  }

  private startHeartbeat(intervalMs: number): void {
    this.stopHeartbeat();
    this.heartbeatAcked = true;
    // First beat after interval * jitter, per gateway docs
    const first = setTimeout(() => {
      this.beat();
      this.heartbeatTimer = setInterval(() => this.beat(), intervalMs);
    }, intervalMs * Math.random());
    this.heartbeatTimer = first;
  }

  private beat(): void {
    if (!this.heartbeatAcked) {
      // Zombied connection: close and resume
      this.ws?.close(4000);
      return;
    }
    this.heartbeatAcked = false;
    this.send({ op: Op.Heartbeat, d: this.seq });
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) clearTimeout(this.heartbeatTimer);
    this.heartbeatTimer = null;
  }

  private onClose(code: number): void {
    this.stopHeartbeat();
    if (this.closedByUser) return;
    // 4004 = auth failed: don't loop on a bad token
    if (code === 4004) {
      this.setState("closed");
      return;
    }
    const delay = Math.min(30_000, 1000 * 2 ** this.reconnectAttempts) * (0.5 + Math.random());
    this.reconnectAttempts++;
    this.setState("reconnecting");
    setTimeout(() => {
      if (!this.closedByUser) this.connect();
    }, delay);
  }
}
