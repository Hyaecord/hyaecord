import { StoatGatewayClient, type StoatGatewayState } from "./gateway";
import { StoatRestClient, StoatRestError, type RawStoatMessage, type RawStoatUser } from "./rest";
import { getToken, setToken, clearToken } from "./token-store";
import { openBrowserLogin } from "./browser-login";
import type { StoatSessionState, StoatUserSummary, StoatDMSummary, StoatMemberSummary } from "@shared/types";

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
// Discovered fresh from `GET /` on every login/auto-login rather than
// hardcoded — the real Autumn CDN host (confirmed live: `cdn.stoatusercontent.com`
// today), since a hardcoded guess is exactly what broke icons/avatars before.
let cdnBase = "https://cdn.stoatusercontent.com";

export function stoatFileUrl(bucket: string, id: string): string {
  return `${cdnBase}/${bucket}/${id}`;
}

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

  try {
    const config = await rest.getConfig();
    if (config.features?.autumn?.url) cdnBase = config.features.autumn.url;
  } catch {
    // Keep the last-known/default CDN base — better than blocking login on it.
  }

  const me = await rest.getSelf();
  user = {
    id: me._id,
    username: me.username,
    displayName: me.display_name ?? null,
    avatar: me.avatar ? stoatFileUrl("avatars", me.avatar._id) : null
  };

  gateway?.destroy();
  gateway = new StoatGatewayClient(token, {
    // The renderer parses icon/avatar IDs out of the raw Ready payload
    // itself, so it needs the discovered CDN base alongside it rather
    // than guessing one.
    onReady: data => send("event", "READY", { ...(data as object), cdnBase }),
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

function toSummary(
  raw: RawStoatMessage,
  users: Map<string, RawStoatUser>
): { id: string; channelId: string; authorId: string; authorName: string; avatar: string | null; content: string; pinned: boolean } {
  const author = raw.user ?? users.get(raw.author);
  return {
    id: raw._id,
    channelId: raw.channel,
    authorId: raw.author,
    authorName: author?.display_name || author?.username || "?",
    avatar: author?.avatar ? stoatFileUrl("avatars", author.avatar._id) : null,
    content: raw.content ?? "",
    pinned: raw.pinned ?? false
  };
}

export async function fetchMessages(channelId: string) {
  if (!rest) return [];
  try {
    // include_users=true (baked into getMessages) returns the authors
    // alongside the messages, so real names/avatars resolve instead of "?".
    const { messages, users } = await rest.getMessages(channelId);
    const userMap = new Map(users.map(u => [u._id, u]));
    return messages.reverse().map(m => toSummary(m, userMap)); // API returns newest-first; the UI wants oldest-first
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

export async function getServerMembers(serverId: string): Promise<StoatMemberSummary[]> {
  if (!rest) return [];
  try {
    const { members, users } = await rest.getServerMembers(serverId);
    const userMap = new Map(users.map(u => [u._id, u]));
    return members.map(m => {
      const u = userMap.get(m._id.user);
      return {
        userId: m._id.user,
        nickname: m.nickname ?? null,
        avatar: m.avatar ? stoatFileUrl("avatars", m.avatar._id) : u?.avatar ? stoatFileUrl("avatars", u.avatar._id) : null,
        username: u?.username ?? "?",
        displayName: u?.display_name ?? null,
        online: u?.online ?? false,
        presence: u?.status?.presence ?? null
      };
    });
  } catch {
    return [];
  }
}

export async function pinMessage(channelId: string, messageId: string): Promise<boolean> {
  if (!rest) return false;
  try {
    await rest.pinMessage(channelId, messageId);
    return true;
  } catch {
    return false;
  }
}

export async function unpinMessage(channelId: string, messageId: string): Promise<boolean> {
  if (!rest) return false;
  try {
    await rest.unpinMessage(channelId, messageId);
    return true;
  } catch {
    return false;
  }
}

export async function getDMs(): Promise<StoatDMSummary[]> {
  if (!rest) return [];
  try {
    const channels = await rest.getDMs();
    return channels.map(c => ({
      id: c._id,
      channelType: c.channel_type,
      name: c.name ?? null,
      icon: c.icon ? stoatFileUrl("icons", c.icon._id) : null,
      recipientIds: c.recipients ?? []
    }));
  } catch {
    return [];
  }
}
