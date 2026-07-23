import net from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { unlinkSync } from "node:fs";

/**
 * RPC Bridge: a local Discord-RPC-compatible IPC server, so games and apps
 * that already know how to talk to the *official* Discord client's Rich
 * Presence socket can set your activity through Hyaecord instead — without
 * needing the official client running at all.
 *
 * This is the same feature Vencord/Equicord/Vesktop ship as "arRPC" — the
 * protocol here (socket path convention, 8-byte frame header, opcodes,
 * handshake/READY shape, SET_ACTIVITY request/ack shape) was verified
 * against arRPC's real, widely-used open-source implementation
 * (github.com/OpenAsar/arrpc) rather than guessed at, since Discord itself
 * has never published this protocol.
 */

const enum OpCode {
  Handshake = 0,
  Frame = 1,
  Close = 2,
  Ping = 3,
  Pong = 4
}

function socketPath(index: number): string {
  const base = process.env.XDG_RUNTIME_DIR || process.env.TMPDIR || process.env.TMP || process.env.TEMP || tmpdir();
  return process.platform === "win32" ? `\\\\?\\pipe\\discord-ipc-${index}` : join(base, `discord-ipc-${index}`);
}

function readyPayload(): unknown {
  return {
    cmd: "DISPATCH",
    evt: "READY",
    nonce: null,
    data: {
      v: 1,
      config: { cdn_host: "cdn.discordapp.com", api_endpoint: "//discord.com/api", environment: "production" },
      // A plausible-shaped placeholder identity, not a real Discord application —
      // real RPC clients only check that this object exists with these fields,
      // they don't validate it against Discord's servers.
      user: {
        id: "0",
        username: "hyaecord",
        discriminator: "0",
        global_name: "Hyaecord RPC Bridge",
        avatar: null,
        bot: false,
        flags: 0,
        premium_type: 0
      }
    }
  };
}

function writeFrame(socket: net.Socket, op: OpCode, data: unknown): void {
  const json = Buffer.from(JSON.stringify(data), "utf8");
  const header = Buffer.alloc(8);
  header.writeInt32LE(op, 0);
  header.writeInt32LE(json.length, 4);
  socket.write(Buffer.concat([header, json]));
}

interface ActivityArgs {
  pid?: number;
  activity?: Record<string, unknown> | null;
}

function toGatewayActivity(clientId: string, activity: Record<string, unknown>): unknown {
  // The RPC activity shape and the gateway presence activity shape agree on
  // nearly every field name (name/state/details/timestamps/assets/party) —
  // verified against docs.discord.food's gateway-events reference. The one
  // real difference: RPC's implicit application_id is the handshake's
  // client_id, which the gateway payload needs explicitly.
  return { type: 0, ...activity, application_id: clientId };
}

class RpcConnection {
  private buffer = Buffer.alloc(0);
  private clientId: string | null = null;

  constructor(
    private socket: net.Socket,
    private onSetActivity: (clientId: string, activity: Record<string, unknown> | null) => void
  ) {
    socket.on("data", chunk => this.onData(chunk as Buffer));
    socket.on("error", () => socket.destroy());
  }

  private onData(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (this.buffer.length >= 8) {
      const op = this.buffer.readInt32LE(0);
      const len = this.buffer.readInt32LE(4);
      if (this.buffer.length < 8 + len) return; // wait for the rest of this frame
      const body = this.buffer.subarray(8, 8 + len);
      this.buffer = this.buffer.subarray(8 + len);
      this.handleFrame(op, body);
    }
  }

  private handleFrame(op: number, body: Buffer): void {
    if (op === OpCode.Ping) {
      writeFrame(this.socket, OpCode.Pong, JSON.parse(body.toString("utf8") || "{}"));
      return;
    }
    if (op === OpCode.Close) {
      this.socket.end();
      return;
    }
    if (op !== OpCode.Handshake && op !== OpCode.Frame) return;

    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(body.toString("utf8"));
    } catch {
      return;
    }

    if (op === OpCode.Handshake) {
      const clientId = payload.client_id;
      if (payload.v !== 1 || typeof clientId !== "string" || !clientId) {
        this.socket.destroy();
        return;
      }
      this.clientId = clientId;
      writeFrame(this.socket, OpCode.Frame, readyPayload());
      return;
    }

    // op === Frame, post-handshake: the only command this bridge actually
    // implements is SET_ACTIVITY — enough to cover "a game sets Rich
    // Presence," which is the entire point of this integration. Anything
    // else (SUBSCRIBE, GET_GUILDS, etc.) is silently ignored rather than
    // half-implemented.
    if (payload.cmd === "SET_ACTIVITY" && this.clientId) {
      const args = (payload.args ?? {}) as ActivityArgs;
      this.onSetActivity(this.clientId, args.activity ?? null);
      writeFrame(this.socket, OpCode.Frame, {
        cmd: "SET_ACTIVITY",
        data: args.activity ?? null,
        evt: null,
        nonce: payload.nonce ?? null
      });
    }
  }
}

let server: net.Server | null = null;
let boundPath: string | null = null;

/**
 * Starts listening on the first free `discord-ipc-N` slot (0–9, same range
 * arRPC and the official client use) so this doesn't fight a real Discord
 * client or another RPC bridge already running on the same machine.
 */
export function startRpcBridge(onSetActivity: (activities: unknown[]) => void): void {
  stopRpcBridge();
  const s = net.createServer(socket => {
    new RpcConnection(socket, (clientId, activity) => {
      onSetActivity(activity ? [toGatewayActivity(clientId, activity)] : []);
    });
  });
  server = s;

  const tryListen = async (index: number, retriedStale = false): Promise<void> => {
    if (index > 9 || server !== s) return;
    const path = socketPath(index);
    const onBindError = async (err: NodeJS.ErrnoException) => {
      s.removeListener("error", onBindError);
      // A Unix socket file left behind by a hard kill (SIGKILL, crash) —
      // not a graceful quit — blocks rebinding with EADDRINUSE even though
      // nothing is actually listening. Confirm it's genuinely dead (a real
      // listener would accept the probe connection) before removing it, so
      // this never unlinks a socket a real running Discord client or
      // another RPC bridge is actually using.
      if (err.code === "EADDRINUSE" && !retriedStale && process.platform !== "win32" && (await isStale(path))) {
        try {
          unlinkSync(path);
        } catch {
          // ignore — race with something else cleaning it up
        }
        void tryListen(index, true);
        return;
      }
      void tryListen(index + 1);
    };
    s.once("error", onBindError);
    s.listen(path, () => {
      s.removeListener("error", onBindError);
      // Fail quiet on any *later* server-level error (e.g. a malformed
      // frame from a misbehaving client) rather than crash the app over
      // an optional integration.
      s.on("error", () => {});
      boundPath = path;
    });
  };
  void tryListen(0);
}

function isStale(path: string): Promise<boolean> {
  return new Promise(resolve => {
    const probe = net.connect(path);
    const finish = (stale: boolean) => {
      probe.destroy();
      resolve(stale);
    };
    probe.once("connect", () => finish(false));
    probe.once("error", () => finish(true));
    setTimeout(() => finish(true), 300);
  });
}

export function stopRpcBridge(): void {
  server?.close();
  server = null;
  if (boundPath && process.platform !== "win32") {
    try {
      unlinkSync(boundPath);
    } catch {
      // already gone
    }
  }
  boundPath = null;
}
