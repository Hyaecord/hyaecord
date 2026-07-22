import { GatewayClient, type GatewayState } from "./gateway";
import { RestClient, DiscordRestError } from "./rest";
import { getToken, setToken, clearToken } from "./token-store";
import type { DiscordSessionState, DiscordUserSummary } from "@shared/types";

/**
 * Discord session manager: owns the REST client and gateway connection,
 * exposes login/logout to IPC, and forwards state + dispatch events to the
 * renderer through the callbacks given to init().
 */

type Sender = (channel: "state" | "event", ...args: unknown[]) => void;

let send: Sender = () => {};
let gateway: GatewayClient | null = null;
let state: DiscordSessionState = "logged-out";
let user: DiscordUserSummary | null = null;

const DEFAULT_GATEWAY = "wss://gateway.discord.gg/";

function setState(next: DiscordSessionState): void {
  state = next;
  send("state", { state, user });
}

function mapGatewayState(gs: GatewayState): DiscordSessionState {
  switch (gs) {
    case "ready":
      return "ready";
    case "reconnecting":
      return "reconnecting";
    case "closed":
      return "logged-out";
    default:
      return "connecting";
  }
}

export function initDiscord(sender: Sender): void {
  send = sender;
}

export function getSessionState(): { state: DiscordSessionState; user: DiscordUserSummary | null } {
  return { state, user };
}

async function startGateway(token: string): Promise<void> {
  const rest = new RestClient(token);
  const me = await rest.getCurrentUser();
  user = {
    id: me.id,
    username: me.username,
    globalName: me.global_name,
    avatar: me.avatar
  };

  let url = DEFAULT_GATEWAY;
  try {
    url = (await rest.getGatewayUrl()).url + "/";
  } catch {
    // default is fine
  }

  gateway?.destroy();
  gateway = new GatewayClient(token, url, {
    onDispatch: (event, data) => send("event", event, data),
    onStateChange: gs => setState(mapGatewayState(gs))
  });
  gateway.connect();
}

export async function login(
  token: string
): Promise<{ ok: boolean; error?: string; persisted?: boolean }> {
  const trimmed = token.trim();
  if (!trimmed) return { ok: false, error: "empty" };
  setState("connecting");
  try {
    await startGateway(trimmed);
  } catch (err) {
    setState("logged-out");
    if (err instanceof DiscordRestError && err.status === 401) {
      return { ok: false, error: "invalid-token" };
    }
    return { ok: false, error: "network" };
  }
  const persisted = setToken(trimmed);
  return { ok: true, persisted };
}

/** Try the stored token on startup; quietly stays logged-out if there is none. */
export async function autoLogin(): Promise<void> {
  const token = getToken();
  if (!token) return;
  setState("connecting");
  try {
    await startGateway(token);
  } catch {
    setState("logged-out");
  }
}

export function logout(): void {
  gateway?.destroy();
  gateway = null;
  user = null;
  clearToken();
  setState("logged-out");
}
