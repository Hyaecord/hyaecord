import { GatewayClient, type GatewayState } from "./gateway";
import { RestClient, DiscordRestError, type RawMessage } from "./rest";
import { getToken, setToken, clearToken } from "./token-store";
import type { DiscordSessionState, DiscordUserSummary } from "@shared/types";

/**
 * Discord session manager: owns the REST client and gateway connection,
 * exposes login/logout to IPC, and forwards state + dispatch events to the
 * renderer through the callbacks given to init().
 */

type Sender = (channel: "state" | "event", ...args: unknown[]) => void;
export type NotifyFn = (title: string, body: string) => void;

let send: Sender = () => {};
let notify: NotifyFn = () => {};
let gateway: GatewayClient | null = null;
let rest: RestClient | null = null;
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

export function initDiscord(sender: Sender, notifier: NotifyFn): void {
  send = sender;
  notify = notifier;
}

interface RawMessagePayload {
  author?: { id?: string; global_name?: string | null; username?: string };
  content?: string;
  guild_id?: string;
  mentions?: Array<{ id?: string }>;
}

/** DMs and direct @-mentions only — never a blanket "new message" notifier. */
function maybeNotify(event: string, data: unknown): void {
  if (event !== "MESSAGE_CREATE" || !user) return;
  const msg = data as RawMessagePayload;
  if (msg.author?.id === user.id) return;
  const isDM = !msg.guild_id;
  const isMentioned = msg.mentions?.some(m => m.id === user!.id) ?? false;
  if (!isDM && !isMentioned) return;

  const authorName = msg.author?.global_name || msg.author?.username || "Someone";
  const title = isDM ? authorName : `${authorName} mentioned you`;
  const body = msg.content?.slice(0, 200) || "Sent an attachment";
  notify(title, body);
}

export function getSessionState(): { state: DiscordSessionState; user: DiscordUserSummary | null } {
  return { state, user };
}

async function startGateway(token: string): Promise<void> {
  rest = new RestClient(token);
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
    onDispatch: (event, data) => {
      send("event", event, data);
      maybeNotify(event, data);
    },
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
  rest = null;
  user = null;
  clearToken();
  setState("logged-out");
}

export async function fetchMessages(channelId: string): Promise<RawMessage[]> {
  if (!rest) return [];
  try {
    const messages = await rest.getMessages(channelId);
    return messages.reverse(); // API returns newest-first; the UI wants oldest-first
  } catch {
    return [];
  }
}

export async function sendMessage(channelId: string, content: string): Promise<boolean> {
  if (!rest || !content.trim()) return false;
  try {
    await rest.createMessage(channelId, content);
    return true;
  } catch {
    return false;
  }
}

/** Used by Moderator View. Caller is responsible for permission gating client-side. */
export async function deleteChannel(channelId: string): Promise<boolean> {
  if (!rest) return false;
  try {
    await rest.deleteChannel(channelId);
    return true;
  } catch {
    return false;
  }
}
