import { StoatGatewayClient, type StoatGatewayState } from "./gateway";
import { StoatRestClient, StoatRestError, type RawStoatMessage } from "./rest";
import { getToken, setToken, clearToken } from "./token-store";
import { openBrowserLogin } from "./browser-login";
import type { StoatSessionState, StoatUserSummary } from "@shared/types";

/**
 * Stoat session manager — deliberately structured like discord/index.ts
 * (same session lifecycle shape) but talking to a completely different
 * backend/protocol. Kept as its own parallel module rather than merged
 * into the Discord one: the two platforms share no REST/gateway wire
 * format, so a shared abstraction right now would just be indirection
 * without real reuse. The renderer is what actually unifies them (see
 * session.ts's merged rail rendering).
 */

type Sender = (channel: "state" | "event", ...args: unknown[]) => void;

let send: Sender = () => {};
let gateway: StoatGatewayClient | null = null;
let rest: StoatRestClient | null = null;
let state: StoatSessionState = "logged-out";
let user: StoatUserSummary | null = null;

function setState(next: StoatSessionState): void {
  state = next;
  send("state", { state, user });
}

function mapGatewayState(gs: StoatGatewayState): StoatSessionState {
  if (gs === "ready") return "ready";
  if (gs === "connecting") return "connecting";
  return "logged-out";
}

export function initStoat(sender: Sender): void {
  send = sender;
}

async function startGateway(token: string): Promise<void> {
  rest = new StoatRestClient(token);
  const me = await rest.getSelf();
  user = {
    id: me._id,
    username: me.username,
    displayName: me.display_name ?? null,
    avatar: me.avatar ? `https://api.stoat.chat/avatars/${me.avatar._id}` : null
  };

  gateway?.destroy();
  gateway = new StoatGatewayClient(token, {
    onReady: data => send("event", "READY", data),
    onDispatch: (type, data) => send("event", type, data),
    onStateChange: gs => setState(mapGatewayState(gs))
  });
  gateway.connect();
}

async function completeLogin(token: string): Promise<{ ok: true; persisted?: boolean } | { ok: false; error: string }> {
  setState("connecting");
  try {
    await startGateway(token);
  } catch (err) {
    setState("logged-out");
    if (err instanceof StoatRestError && err.status === 401) {
      return { ok: false, error: "invalid-token" };
    }
    return { ok: false, error: "network" };
  }
  const persisted = setToken(token);
  return { ok: true, persisted };
}

/** Same trustworthy pattern as Discord: the real stoat.chat login page, token captured at the network layer — see browser-login.ts. */
export async function loginWithBrowser(): Promise<{ ok: boolean; error?: string; persisted?: boolean }> {
  const token = await openBrowserLogin();
  if (!token) return { ok: false, error: "cancelled" };
  return completeLogin(token);
}

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

export function getSessionState(): { state: StoatSessionState; user: StoatUserSummary | null } {
  return { state, user };
}

function toSummary(raw: RawStoatMessage): { id: string; channelId: string; authorId: string; authorName: string; avatar: string | null; content: string } {
  return {
    id: raw._id,
    channelId: raw.channel,
    authorId: raw.author,
    authorName: raw.user?.display_name || raw.user?.username || "?",
    avatar: raw.user?.avatar ? `https://api.stoat.chat/avatars/${raw.user.avatar._id}` : null,
    content: raw.content ?? ""
  };
}

export async function fetchMessages(channelId: string) {
  if (!rest) return [];
  try {
    const messages = await rest.getMessages(channelId);
    return messages.reverse().map(toSummary); // API returns newest-first; the UI wants oldest-first
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
