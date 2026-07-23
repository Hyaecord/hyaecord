import WebSocket from "ws";

/**
 * Discord's real voice WebSocket — a separate connection per voice
 * session, distinct from the main gateway, per docs.discord.food's
 * voice-connections topic (opcodes verified there, not guessed):
 * Op 0 Identify (send) → Op 8 Hello (receive, heartbeat_interval) →
 * Op 2 Ready (receive: ssrc/ip/port/encryption modes) → heartbeat
 * (Op 3 send / Op 6 ack receive) to stay connected, plus Op 11/13
 * Clients Connect/Disconnect for who else is in the channel and Op 5
 * Speaking for live speaking indicators.
 *
 * ⚠ Deliberately scoped, not an oversight: this reaches a real, verified
 * Ready handshake and tracks channel membership/speaking state, but does
 * NOT negotiate a protocol (Op 1 Select Protocol) or open the actual
 * UDP/WebRTC media transport (Op 4 Session Description onward) — that
 * half needs exact SDP-fragment/codec-payload handling matched against a
 * live Discord voice server to get right, which this sandbox has no way
 * to test against. See BUILD_PROMPT.md for the full reasoning. No audio
 * or video is sent or received by this module.
 */

const enum VoiceOp {
  Identify = 0,
  Ready = 2,
  Heartbeat = 3,
  Speaking = 5,
  HeartbeatAck = 6,
  Hello = 8,
  ClientsConnect = 11,
  ClientDisconnect = 13
}

export interface VoiceReadyInfo {
  ssrc: number;
  ip: string;
  port: number;
  modes: string[];
}

export interface VoiceGatewayHandlers {
  onReady(info: VoiceReadyInfo): void;
  onClientsConnect(userIds: string[]): void;
  onClientDisconnect(userId: string): void;
  onSpeaking(userId: string, speaking: boolean): void;
  onClose(): void;
}

interface VoicePayload {
  op: VoiceOp;
  d?: unknown;
}

export class VoiceGatewayClient {
  private ws: WebSocket | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private endpoint: string,
    private guildOrChannelId: string,
    private channelId: string,
    private userId: string,
    private sessionId: string,
    private token: string,
    private handlers: VoiceGatewayHandlers
  ) {}

  connect(): void {
    const url = `wss://${this.endpoint.replace(/:\d+$/, "")}?v=9`;
    this.ws = new WebSocket(url);
    this.ws.on("open", () => this.identify());
    this.ws.on("message", data => this.onMessage(JSON.parse(data.toString())));
    this.ws.on("close", () => this.cleanup());
    this.ws.on("error", () => this.cleanup());
  }

  destroy(): void {
    this.ws?.close();
    this.cleanup();
  }

  private send(payload: VoicePayload): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(payload));
  }

  private identify(): void {
    this.send({
      op: VoiceOp.Identify,
      d: {
        server_id: this.guildOrChannelId,
        channel_id: this.channelId,
        user_id: this.userId,
        session_id: this.sessionId,
        token: this.token,
        video: false
      }
    });
  }

  private onMessage(payload: VoicePayload): void {
    switch (payload.op) {
      case VoiceOp.Hello: {
        const { heartbeat_interval } = payload.d as { heartbeat_interval: number };
        this.heartbeatTimer = setInterval(() => this.send({ op: VoiceOp.Heartbeat, d: Date.now() }), heartbeat_interval);
        break;
      }
      case VoiceOp.Ready: {
        const d = payload.d as { ssrc: number; ip: string; port: number; modes: string[] };
        this.handlers.onReady({ ssrc: d.ssrc, ip: d.ip, port: d.port, modes: d.modes });
        break;
      }
      case VoiceOp.ClientsConnect: {
        const { user_ids } = payload.d as { user_ids: string[] };
        this.handlers.onClientsConnect(user_ids);
        break;
      }
      case VoiceOp.ClientDisconnect: {
        const { user_id } = payload.d as { user_id: string };
        this.handlers.onClientDisconnect(user_id);
        break;
      }
      case VoiceOp.Speaking: {
        const d = payload.d as { user_id?: string; speaking?: number };
        if (d.user_id) this.handlers.onSpeaking(d.user_id, (d.speaking ?? 0) !== 0);
        break;
      }
      default:
        break;
    }
  }

  private cleanup(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
    this.handlers.onClose();
  }
}
