import WebSocket from "ws";

/**
 * Stoat's real events (gateway) protocol — verified against
 * developers.stoat.chat/developers/events/protocol/ rather than guessed:
 * connect to wss://events.stoat.chat, send an `Authenticate` message with
 * the session token, wait for `Authenticated` (or `Error`), then a
 * `Ready` dispatch carries the initial servers/channels/users snapshot.
 * Heartbeat is a client-initiated `Ping`/`Pong` exchange, not a
 * server-driven interval like Discord's — there's no `heartbeat_interval`
 * to wait for, so this pings on a fixed, conservative interval instead.
 */

const EVENTS_URL = "wss://events.stoat.chat";
const PING_INTERVAL_MS = 15_000;

export type StoatGatewayState = "idle" | "connecting" | "ready" | "closed";

export interface StoatGatewayHandlers {
  onReady(data: unknown): void;
  onDispatch(type: string, data: unknown): void;
  onStateChange(state: StoatGatewayState): void;
}

export class StoatGatewayClient {
  private ws: WebSocket | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private state: StoatGatewayState = "idle";
  private closedByUser = false;

  constructor(
    private token: string,
    private handlers: StoatGatewayHandlers
  ) {}

  connect(): void {
    this.closedByUser = false;
    this.setState("connecting");
    this.ws = new WebSocket(EVENTS_URL);
    this.ws.on("open", () => {
      this.send({ type: "Authenticate", token: this.token });
    });
    this.ws.on("message", data => this.onMessage(JSON.parse(data.toString())));
    this.ws.on("close", () => {
      this.cleanup();
      if (!this.closedByUser) this.setState("closed");
    });
    this.ws.on("error", () => this.cleanup());
  }

  destroy(): void {
    this.closedByUser = true;
    this.ws?.close();
    this.cleanup();
    this.setState("closed");
  }

  private send(payload: unknown): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(payload));
  }

  private setState(state: StoatGatewayState): void {
    this.state = state;
    this.handlers.onStateChange(state);
  }

  private onMessage(payload: { type?: string; [key: string]: unknown }): void {
    switch (payload.type) {
      case "Authenticated":
        // Ready follows automatically once authenticated, per the protocol docs.
        this.pingTimer = setInterval(() => this.send({ type: "Ping", data: Date.now() }), PING_INTERVAL_MS);
        break;
      case "Ready":
        this.setState("ready");
        this.handlers.onReady(payload);
        break;
      case "Pong":
        break;
      case "Error":
        this.cleanup();
        this.setState("closed");
        break;
      default:
        if (payload.type) this.handlers.onDispatch(payload.type, payload);
        break;
    }
  }

  private cleanup(): void {
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = null;
  }
}
