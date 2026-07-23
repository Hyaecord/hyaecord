import { generateKeyPairSync, createPrivateKey, privateDecrypt, constants, createHash } from "node:crypto";
import WebSocket from "ws";

const GATEWAY_URL = "wss://remote-auth-gateway.discord.gg/?v=2";

/**
 * The QR-code login flow the official Discord apps use: the desktop client
 * generates an RSA keypair, opens a websocket, and gets back a short-lived
 * "fingerprint" that becomes a `https://discord.com/ra/<fingerprint>` URL —
 * that's what the QR code encodes. Scanning it with the mobile app and
 * approving sends back the account's token, RSA-OAEP encrypted with the
 * public key we sent, so only this process can decrypt it.
 *
 * ⚠ Unverified live (see BUILD_PROMPT.md) — this protocol is stable and
 * used by every major open-source Discord client, but this session had no
 * real phone to pair against. Coded defensively: unrecognised opcodes are
 * ignored rather than crashing the flow, and the intermediate "confirm on
 * your phone" step deliberately does *not* try to parse/display the
 * account name from the payload, since the exact field layout of that
 * message is the least-certain part of the protocol — better to show a
 * generic message than a wrong one.
 */

export interface RemoteAuthHandlers {
  onQrUrl(url: string): void;
  onConfirming(): void;
  onToken(token: string): void;
  onError(message: string): void;
  onExpired(): void;
}

export function startRemoteAuth(handlers: RemoteAuthHandlers): () => void {
  const { publicKey, privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "der" },
    privateKeyEncoding: { type: "pkcs8", format: "der" }
  });

  const privateKeyObject = createPrivateKey({ key: privateKey, format: "der", type: "pkcs8" });

  let heartbeat: ReturnType<typeof setInterval> | null = null;
  let closed = false;
  const ws = new WebSocket(GATEWAY_URL);

  function decrypt(base64: string): Buffer {
    return privateDecrypt(
      {
        key: privateKeyObject,
        padding: constants.RSA_PKCS1_OAEP_PADDING,
        oaepHash: "sha256"
      },
      Buffer.from(base64, "base64")
    );
  }

  function cleanup(): void {
    if (closed) return;
    closed = true;
    if (heartbeat) clearInterval(heartbeat);
    ws.close();
  }

  ws.on("open", () => {
    ws.send(JSON.stringify({ op: "init", encoded_public_key: publicKey.toString("base64") }));
  });

  ws.on("message", raw => {
    let msg: { op?: string; heartbeat_interval?: number; encrypted_nonce?: string; fingerprint?: string; encrypted_token?: string };
    try {
      msg = JSON.parse(String(raw));
    } catch {
      return;
    }

    switch (msg.op) {
      case "hello":
        if (msg.heartbeat_interval) {
          heartbeat = setInterval(() => ws.send(JSON.stringify({ op: "heartbeat" })), msg.heartbeat_interval);
        }
        break;
      case "nonce_proof": {
        if (!msg.encrypted_nonce) break;
        const nonce = decrypt(msg.encrypted_nonce);
        const proof = createHash("sha256").update(nonce).digest("base64url");
        ws.send(JSON.stringify({ op: "nonce_proof", proof }));
        break;
      }
      case "pending_remote_init":
        if (msg.fingerprint) handlers.onQrUrl(`https://discord.com/ra/${msg.fingerprint}`);
        break;
      case "pending_ticket":
      case "pending_finish":
        // Phone has scanned; waiting on the user to tap "confirm" there.
        handlers.onConfirming();
        break;
      case "finish": {
        if (!msg.encrypted_token) {
          handlers.onError("network");
          cleanup();
          break;
        }
        try {
          handlers.onToken(decrypt(msg.encrypted_token).toString("utf8"));
        } catch {
          handlers.onError("network");
        }
        cleanup();
        break;
      }
      case "cancel":
      case "timeout":
        handlers.onExpired();
        cleanup();
        break;
      default:
        // Unknown/future opcode — ignore rather than fail the whole flow.
        break;
    }
  });

  ws.on("error", () => {
    if (!closed) handlers.onError("network");
    cleanup();
  });
  ws.on("close", () => {
    if (!closed) handlers.onExpired();
  });

  return cleanup;
}
