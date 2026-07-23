import { GatewayClient, type GatewayState } from "./gateway";
import {
  RestClient,
  DiscordRestError,
  type RawMessage,
  type RawUserProfile,
  type RawGif
} from "./rest";
import { getToken, setToken, clearToken } from "./token-store";
import { openBrowserLogin } from "./browser-login";
import type { DiscordSessionState, DiscordUserSummary, UserProfile, GifResult } from "@shared/types";

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
/**
 * True only for a login that just happened this launch via an explicit user
 * action (token/credentials/browser) — false when restored from a stored
 * token on startup. Lets the renderer show a one-time "you just connected,
 * maybe don't fire off a message immediately" caution — see the real
 * incident noted in BUILD_PROMPT.md (a fresh login + an immediate message
 * got an account force-logged-out by Discord's own abuse detection).
 */
let freshLogin = false;

const DEFAULT_GATEWAY = "wss://gateway.discord.gg/";

function setState(next: DiscordSessionState): void {
  state = next;
  send("state", { state, user, freshLogin });
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

/** Powers the member list — see gateway.ts's subscribeMemberList for the actual OP 14 payload. */
export function subscribeMemberList(guildId: string, channelId: string): void {
  gateway?.subscribeMemberList(guildId, channelId);
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

async function completeLogin(
  token: string
): Promise<{ ok: true; persisted?: boolean } | { ok: false; error: string }> {
  setState("connecting");
  try {
    await startGateway(token);
  } catch (err) {
    setState("logged-out");
    if (err instanceof DiscordRestError && err.status === 401) {
      return { ok: false, error: "invalid-token" };
    }
    return { ok: false, error: "network" };
  }
  const persisted = setToken(token);
  return { ok: true, persisted };
}

/**
 * The trustworthy default: opens the real discord.com login page. Discord's
 * own QR-code login toggle lives on that page too, so there's no separate
 * QR implementation here — reimplementing it would just be another surface
 * to keep in sync with Discord's protocol for no benefit over the real page.
 */
export async function loginWithBrowser(): Promise<{ ok: boolean; error?: string; persisted?: boolean }> {
  const token = await openBrowserLogin();
  if (!token) return { ok: false, error: "cancelled" };
  freshLogin = true;
  return completeLogin(token);
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
  freshLogin = false;
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

/** Used by Server Chomper. */
export async function muteGuild(guildId: string, muted: boolean): Promise<boolean> {
  if (!rest) return false;
  try {
    await rest.setGuildMuted(guildId, muted);
    return true;
  } catch {
    return false;
  }
}

/** Used by Server Chomper for individual DMs/group DMs. */
export async function muteDm(channelId: string, muted: boolean): Promise<boolean> {
  if (!rest) return false;
  try {
    await rest.setDmMuted(channelId, muted);
    return true;
  } catch {
    return false;
  }
}

function toUserProfile(raw: RawUserProfile): UserProfile {
  return {
    id: raw.user.id,
    username: raw.user.username,
    globalName: raw.user.global_name,
    avatar: raw.user.avatar,
    bot: raw.user.bot ?? false,
    bio: raw.user_profile?.bio ?? null,
    pronouns: raw.user_profile?.pronouns ?? null,
    banner: raw.banner ?? null,
    accentColor: raw.accent_color ?? null,
    badges: (raw.badges ?? []).map(b => ({ id: b.id, description: b.description, icon: b.icon, link: b.link })),
    connectedAccounts: (raw.connected_accounts ?? []).map(c => ({ type: c.type, name: c.name, verified: c.verified })),
    premiumType: raw.premium_type ?? null
  };
}

/** Powers the profile popout — same endpoint Discord's own client hits when you click a username. */
export async function fetchUserProfile(userId: string): Promise<UserProfile | null> {
  if (!rest) return null;
  try {
    return toUserProfile(await rest.getUserProfile(userId));
  } catch {
    return null;
  }
}

function toGifResult(raw: RawGif): GifResult {
  return { id: raw.id, url: raw.url, videoSrc: raw.gif_src, width: raw.width, height: raw.height, title: raw.title };
}

/** Powers the GIF picker. Empty query means "show trending" — matches how the official picker opens. */
export async function searchGifs(query: string): Promise<GifResult[]> {
  if (!rest) return [];
  try {
    const raw = query.trim() ? await rest.searchGifs(query.trim()) : await rest.trendingGifs();
    return raw.map(toGifResult);
  } catch {
    return [];
  }
}

/** Sets or clears (dataUri === null) the account's avatar, then pushes the updated user out so the UI reflects it immediately. */
export async function updateAvatar(dataUri: string | null): Promise<boolean> {
  if (!rest || !user) return false;
  try {
    const res = await rest.updateAvatar(dataUri);
    user = { ...user, avatar: res.avatar };
    send("state", { state, user, freshLogin });
    return true;
  } catch {
    return false;
  }
}
