import { GatewayClient, type GatewayState } from "./gateway";
import { VoiceGatewayClient } from "../voice/voice-gateway";
import {
  RestClient,
  DiscordRestError,
  type RawMessage,
  type RawUserProfile,
  type RawGif,
  type RawSearchResponse,
  type RawRelationship,
  type RawStickerPack
} from "./rest";
import { getToken, setToken, clearToken } from "./token-store";
import { openBrowserLogin } from "./browser-login";
import { runMessageSendHooks, runMessageCreateHooks } from "../plugins/manager";
import type {
  DiscordSessionState,
  DiscordUserSummary,
  UserProfile,
  GifResult,
  MessageSearchResult,
  RelationshipSummary
} from "@shared/types";

/**
 * Discord session manager: owns the REST client and gateway connection,
 * exposes login/logout to IPC, and forwards state + dispatch events to the
 * renderer through the callbacks given to init().
 */

type Sender = (channel: "state" | "event" | "voice", ...args: unknown[]) => void;
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

/**
 * Voice join/leave state machine. Joining sends Op 4 Voice State Update
 * over the *main* gateway, then waits for both VOICE_STATE_UPDATE (gives
 * a session_id) and VOICE_SERVER_UPDATE (gives a token + endpoint) —
 * Discord sends these as two separate dispatch events per
 * docs.discord.food, and both are required before the voice WebSocket
 * handshake can start. `pendingVoiceJoin` tracks a join that's still
 * waiting on one or both.
 */
let voiceGateway: VoiceGatewayClient | null = null;
let pendingVoiceJoin: { guildId: string | null; channelId: string; sessionId?: string; token?: string; endpoint?: string } | null = null;
let voiceMembers = new Set<string>();
let voiceSpeaking = new Set<string>();

export interface VoiceState {
  status: "idle" | "connecting" | "connected";
  guildId: string | null;
  channelId: string | null;
  members: string[];
  speaking: string[];
}

function sendVoiceState(status: VoiceState["status"]): void {
  send("voice", {
    status,
    guildId: pendingVoiceJoin?.guildId ?? null,
    channelId: pendingVoiceJoin?.channelId ?? null,
    members: [...voiceMembers],
    speaking: [...voiceSpeaking]
  } satisfies VoiceState);
}

function maybeStartVoiceGateway(): void {
  const p = pendingVoiceJoin;
  if (!p?.sessionId || !p.token || !p.endpoint || !user) return;
  voiceGateway?.destroy();
  voiceMembers = new Set();
  voiceSpeaking = new Set();
  voiceGateway = new VoiceGatewayClient(p.endpoint, p.guildId ?? p.channelId, p.channelId, user.id, p.sessionId, p.token, {
    onReady: () => sendVoiceState("connected"),
    onClientsConnect: userIds => {
      for (const id of userIds) voiceMembers.add(id);
      sendVoiceState("connected");
    },
    onClientDisconnect: userId => {
      voiceMembers.delete(userId);
      voiceSpeaking.delete(userId);
      sendVoiceState("connected");
    },
    onSpeaking: (userId, speaking) => {
      if (speaking) voiceSpeaking.add(userId);
      else voiceSpeaking.delete(userId);
      sendVoiceState("connected");
    },
    onClose: () => {
      voiceGateway = null;
    }
  });
  voiceGateway.connect();
}

function handleVoiceDispatch(event: string, data: unknown): void {
  if (!pendingVoiceJoin) return;
  if (event === "VOICE_STATE_UPDATE") {
    const d = data as { user_id?: string; session_id?: string; channel_id?: string | null };
    if (d.user_id !== user?.id || !d.session_id) return;
    if (d.channel_id !== pendingVoiceJoin.channelId) return;
    pendingVoiceJoin.sessionId = d.session_id;
    maybeStartVoiceGateway();
  } else if (event === "VOICE_SERVER_UPDATE") {
    const d = data as { token?: string; endpoint?: string | null; guild_id?: string | null };
    if (!d.token || !d.endpoint) return;
    pendingVoiceJoin.token = d.token;
    pendingVoiceJoin.endpoint = d.endpoint;
    maybeStartVoiceGateway();
  }
}

/** Joins/moves to a voice channel. `guildId` is null for a DM/group-DM call. Real Op 4 Voice State Update — see gateway.ts. */
export function joinVoiceChannel(guildId: string | null, channelId: string): void {
  if (!gateway) return;
  pendingVoiceJoin = { guildId, channelId };
  sendVoiceState("connecting");
  gateway.updateVoiceState(guildId, channelId, false, false);
}

export function leaveVoiceChannel(): void {
  if (!gateway) return;
  const guildId = pendingVoiceJoin?.guildId ?? null;
  voiceGateway?.destroy();
  voiceGateway = null;
  pendingVoiceJoin = null;
  voiceMembers = new Set();
  voiceSpeaking = new Set();
  gateway.updateVoiceState(guildId, null, false, false);
  sendVoiceState("idle");
}

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

/** Powers the RPC Bridge. Only meaningful when actually connected — silently a no-op otherwise, since there's nothing to attach the presence to. */
export function setActivity(activities: unknown[]): boolean {
  if (!gateway || state !== "ready") return false;
  gateway.updatePresence(activities);
  return true;
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
      if (event === "MESSAGE_CREATE") runMessageCreateHooks(data);
      handleVoiceDispatch(event, data);
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
  voiceGateway?.destroy();
  voiceGateway = null;
  pendingVoiceJoin = null;
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

const SUPPRESS_NOTIFICATIONS_FLAG = 1 << 12;

export async function sendMessage(channelId: string, content: string, silent = false): Promise<boolean> {
  if (!rest || !content.trim()) return false;
  const transformed = await runMessageSendHooks(content, channelId);
  if (transformed === null) return false; // a plugin cancelled the send
  if (!transformed.trim()) return false;
  try {
    await rest.createMessage(channelId, transformed, silent ? SUPPRESS_NOTIFICATIONS_FLAG : undefined);
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

const SUPPRESS_EMBEDS_FLAG = 1 << 2;

/**
 * Powers the native "Suppress/Unsuppress Embeds" context-menu item
 * (reimplementation of Equicord's UnsuppressEmbeds). `currentFlags` must
 * be the message's full current flags bitfield — Discord's edit endpoint
 * requires every previously-set flag to be included, not just the one
 * being toggled (per docs.discord.food). Caller is responsible for the
 * MANAGE_MESSAGES-or-own-message permission check.
 */
export async function toggleEmbedSuppression(channelId: string, messageId: string, currentFlags: number): Promise<boolean> {
  if (!rest) return false;
  const next = currentFlags & SUPPRESS_EMBEDS_FLAG ? currentFlags & ~SUPPRESS_EMBEDS_FLAG : currentFlags | SUPPRESS_EMBEDS_FLAG;
  try {
    await rest.editMessageFlags(channelId, messageId, next);
    return true;
  } catch {
    return false;
  }
}

export interface PinSummary {
  id: string;
  channelId: string;
  authorName: string;
  authorId: string;
  avatar: string | null;
  content: string;
  timestamp: string;
  pinnedAt: string;
}

/** Powers the pinned-messages panel. */
export async function listMessagePins(channelId: string): Promise<PinSummary[]> {
  if (!rest) return [];
  try {
    const res = await rest.listMessagePins(channelId);
    return res.items.map(item => ({
      id: item.message.id,
      channelId: item.message.channel_id,
      authorName: item.message.author.global_name || item.message.author.username,
      authorId: item.message.author.id,
      avatar: item.message.author.avatar ?? null,
      content: item.message.content,
      timestamp: item.message.timestamp,
      pinnedAt: item.pinned_at
    }));
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

export interface StickerSummary {
  id: string;
  name: string;
  formatType: number;
}

export interface StickerPackSummary {
  id: string;
  name: string;
  stickers: StickerSummary[];
}

let stickerPacksCache: StickerPackSummary[] | null = null;

/** Standard sticker packs only — cached for the process lifetime since Discord's own official pack list changes rarely, same reasoning GlobalBadges' 30-minute cache uses for a slower-moving feed. */
export async function listStickerPacks(): Promise<StickerPackSummary[]> {
  if (stickerPacksCache) return stickerPacksCache;
  if (!rest) return [];
  try {
    const res = await rest.listStickerPacks();
    stickerPacksCache = res.sticker_packs.map(pack => ({
      id: pack.id,
      name: pack.name,
      stickers: pack.stickers.map(s => ({ id: s.id, name: s.name, formatType: s.format_type }))
    }));
    return stickerPacksCache;
  } catch {
    return [];
  }
}

export async function sendSticker(channelId: string, stickerId: string): Promise<boolean> {
  if (!rest) return false;
  try {
    await rest.sendSticker(channelId, stickerId);
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
    themeColors: raw.user_profile?.theme_colors ?? null,
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
  // `raw.src` is the real playable .mp4 despite the generic name; `gif_src`
  // is actually a static/animated .webp preview, not a <video>-decodable
  // source — confirmed live against the real (currently Klipy-backed, per
  // discord.com/api/v9/gifs/trending-gifs) response shape, since the naming
  // reads backwards from what it actually holds and had the picker showing
  // an endless grid of blank tiles (DEMUXER_ERROR_COULD_NOT_OPEN on webp).
  return { id: raw.id, url: raw.url, videoSrc: raw.src, width: raw.width, height: raw.height, title: raw.title };
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

function toSearchResult(raw: RawSearchResponse): MessageSearchResult {
  if (!raw.messages) {
    // Guild/channel isn't indexed yet — see the docs.discord.food note on rest.ts's searchGuildMessages.
    return { indexing: true, totalResults: 0, messages: [] };
  }
  return {
    indexing: false,
    totalResults: raw.total_results ?? 0,
    messages: raw.messages.flat().map(m => ({
      id: m.id,
      channelId: m.channel_id,
      content: m.content,
      timestamp: m.timestamp,
      authorId: m.author.id,
      authorName: m.author.global_name || m.author.username
    }))
  };
}

/** Powers message search. `guildId` searches every channel in that guild; `channelId` alone (DMs, which have no guild) searches just that one channel. */
export async function searchMessages(query: string, guildId: string | null, channelId: string | null): Promise<MessageSearchResult> {
  if (!rest || !query.trim()) return { indexing: false, totalResults: 0, messages: [] };
  try {
    const raw = guildId
      ? await rest.searchGuildMessages(guildId, query.trim())
      : channelId
        ? await rest.searchChannelMessages(channelId, query.trim())
        : null;
    return raw ? toSearchResult(raw) : { indexing: false, totalResults: 0, messages: [] };
  } catch {
    return { indexing: false, totalResults: 0, messages: [] };
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

function toRelationship(raw: RawRelationship): RelationshipSummary {
  return {
    id: raw.id,
    type: raw.type,
    username: raw.user.username,
    globalName: raw.user.global_name ?? null,
    avatar: raw.user.avatar ?? null
  };
}

/** Powers the Friends list — friends, pending in/out, and blocked users all come back in one list, split by `type` in the renderer. */
export async function listRelationships(): Promise<RelationshipSummary[]> {
  if (!rest) return [];
  try {
    return (await rest.listRelationships()).map(toRelationship);
  } catch {
    return [];
  }
}

export async function sendFriendRequest(username: string): Promise<{ ok: boolean; error?: string }> {
  if (!rest) return { ok: false, error: "network" };
  try {
    await rest.sendFriendRequest(username);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof DiscordRestError ? err.message : "network" };
  }
}

/** Accepts an incoming request, or completes a mutual add. */
export async function acceptFriendRequest(userId: string): Promise<boolean> {
  if (!rest) return false;
  try {
    await rest.acceptRelationship(userId);
    return true;
  } catch {
    return false;
  }
}

export async function blockUser(userId: string): Promise<boolean> {
  if (!rest) return false;
  try {
    await rest.blockUser(userId);
    return true;
  } catch {
    return false;
  }
}

/** Also used to decline an incoming request, cancel an outgoing one, or unblock — all the same "remove the relationship" call. */
export async function removeRelationship(userId: string): Promise<boolean> {
  if (!rest) return false;
  try {
    await rest.removeRelationship(userId);
    return true;
  } catch {
    return false;
  }
}
