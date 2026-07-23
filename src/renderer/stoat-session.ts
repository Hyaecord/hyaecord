import type { StoatSession } from "@shared/types";
import { el, t } from "./ui";
import { applyTwemoji } from "./twemoji";

/**
 * Stoat (formerly Revolt) session — a real, separate integration talking
 * to Stoat's own REST/WebSocket API (see main/stoat/*), not a Discord
 * lookalike. Deliberately parallel to session.ts's Discord logic rather
 * than sharing it: the two platforms have no wire-format overlap, so a
 * shared abstraction here would be indirection without real reuse. They
 * meet only at the render layer (session.ts's merged rail).
 *
 * Scope for this pass: connect, list servers/channels, read and send
 * plain-text messages. Deliberately not built yet: DMs, friends,
 * reactions, voice, file uploads, and anything else Stoat's real API
 * supports beyond that — the same "ship a real vertical slice, flag the
 * rest honestly" approach used throughout this project.
 */

export interface StoatChannelSummary {
  id: string;
  name: string;
  /** True when the channel's `voice` field (Stoat's VoiceInformation) is set — Stoat has no separate voice-channel type, just this flag on an ordinary TextChannel, per its published OpenAPI schema. */
  hasVoice: boolean;
}

export interface StoatGuildSummary {
  id: string;
  name: string;
  icon: string | null;
  channels: StoatChannelSummary[];
}

export interface StoatMessageSummary {
  id: string;
  channelId: string;
  authorId: string;
  authorName: string;
  avatar: string | null;
  content: string;
}

export interface StoatFriendSummary {
  id: string;
  username: string;
  displayName: string | null;
  avatar: string | null;
}

export interface StoatMemberSummary {
  userId: string;
  nickname: string | null;
  avatar: string | null;
  username: string;
  displayName: string | null;
}

let guilds: StoatGuildSummary[] = [];
let activeGuildId: string | null = null;
let activeChannelId: string | null = null;
let selfUserId: string | null = null;
let stateChangeListeners = new Set<() => void>();
let currentState: StoatSession["state"] = "logged-out";
let sessionListeners = new Set<(state: StoatSession["state"]) => void>();
/** CDN base for this session — discovered live from `GET /` on the main process side and forwarded on the Ready payload, see main/stoat/index.ts. Never guessed here. */
let cdnBase = "https://cdn.stoatusercontent.com";

interface CachedStoatUser {
  id: string;
  username: string;
  displayName: string | null;
  avatar: string | null;
  relationship: string;
}

const userCache = new Map<string, CachedStoatUser>();
/** Keyed by server id -> that server's members (from Ready's `members` array, whose composite `_id` is `{server, user}`). */
const membersByServer = new Map<string, StoatMemberSummary[]>();

export function onStoatGuildsChanged(cb: () => void): () => void {
  stateChangeListeners.add(cb);
  return () => stateChangeListeners.delete(cb);
}

export function getStoatGuilds(): StoatGuildSummary[] {
  return guilds;
}

export function isStoatReady(): boolean {
  return currentState === "ready";
}

/** Fires whenever the Stoat connection state changes (login gate logic in session.ts listens for this alongside Discord's own state). */
export function onStoatStateChange(cb: (state: StoatSession["state"]) => void): () => void {
  sessionListeners.add(cb);
  return () => sessionListeners.delete(cb);
}

export function getActiveStoatChannel(): { guildId: string | null; channelId: string | null } {
  return { guildId: activeGuildId, channelId: activeChannelId };
}

interface RawStoatServer {
  _id: string;
  name?: string;
  icon?: { _id: string } | null;
  channels: string[];
}

interface RawStoatChannel {
  _id: string;
  channel_type?: string;
  name?: string;
  server?: string;
  /** VoiceInformation | null — presence (not shape) is all that matters here; see StoatChannelSummary.hasVoice. */
  voice?: unknown | null;
}

interface RawStoatReadyUser {
  _id: string;
  username: string;
  display_name?: string | null;
  avatar?: { _id: string } | null;
  /** RelationshipStatus: None | User | Friend | Outgoing | Incoming | Blocked | BlockedOther — per the OpenAPI User schema. */
  relationship?: string;
}

interface RawStoatMember {
  _id: { server: string; user: string };
  nickname?: string | null;
  avatar?: { _id: string } | null;
}

function onReady(data: unknown): void {
  const payload = data as {
    user?: { _id?: string };
    servers?: RawStoatServer[];
    channels?: RawStoatChannel[];
    users?: RawStoatReadyUser[];
    members?: RawStoatMember[];
    cdnBase?: string;
  };
  selfUserId = payload.user?._id ?? selfUserId;
  if (payload.cdnBase) cdnBase = payload.cdnBase;

  userCache.clear();
  for (const u of payload.users ?? []) {
    userCache.set(u._id, {
      id: u._id,
      username: u.username,
      displayName: u.display_name ?? null,
      avatar: u.avatar ? `${cdnBase}/avatars/${u.avatar._id}` : null,
      relationship: u.relationship ?? "None"
    });
  }

  membersByServer.clear();
  for (const m of payload.members ?? []) {
    const list = membersByServer.get(m._id.server) ?? [];
    const cached = userCache.get(m._id.user);
    list.push({
      userId: m._id.user,
      nickname: m.nickname ?? null,
      avatar: m.avatar ? `${cdnBase}/avatars/${m.avatar._id}` : (cached?.avatar ?? null),
      username: cached?.username ?? "?",
      displayName: cached?.displayName ?? null
    });
    membersByServer.set(m._id.server, list);
  }

  const channelsById = new Map((payload.channels ?? []).map(ch => [ch._id, ch]));
  guilds = (payload.servers ?? []).map(server => ({
    id: server._id,
    name: server.name ?? "?",
    icon: server.icon ? `${cdnBase}/icons/${server.icon._id}` : null,
    channels: server.channels
      .map(id => channelsById.get(id))
      .filter((ch): ch is RawStoatChannel => !!ch && ch.channel_type === "TextChannel")
      .map(ch => ({ id: ch._id, name: ch.name ?? "?", hasVoice: ch.voice != null }))
  }));
  stateChangeListeners.forEach(cb => cb());
}

/** Friends aren't a separate endpoint on Stoat — each `User` embeds the current user's `relationship` with them directly (confirmed in the OpenAPI User schema), so this is just a filter over the Ready-populated user cache. */
export function getStoatFriends(): StoatFriendSummary[] {
  return [...userCache.values()]
    .filter(u => u.relationship === "Friend")
    .map(u => ({ id: u.id, username: u.username, displayName: u.displayName, avatar: u.avatar }));
}

export function getStoatMembers(serverId: string): StoatMemberSummary[] {
  return membersByServer.get(serverId) ?? [];
}

let cachedDms: import("@shared/types").StoatDMSummary[] = [];

/** Stoat's `GET /users/dms` results, resolved to display names via the user cache — recipients on a DM channel are just user IDs, not embedded user objects. */
export async function fetchStoatDMs(): Promise<Array<{ id: string; name: string }>> {
  cachedDms = await window.hyaecord.stoatGetDMs();
  return cachedDms.map(dm => ({
    id: dm.id,
    name:
      dm.name ??
      (dm.recipientIds
        .filter(id => id !== selfUserId)
        .map(id => userCache.get(id)?.displayName || userCache.get(id)?.username || "?")
        .join(", ") ||
        "?")
  }));
}

export function initStoatSession(): void {
  window.hyaecord.onStoatEvent((event, data) => {
    if (event === "READY") onReady(data);
  });
  window.hyaecord.onStoatState(session => {
    currentState = session.state;
    if (session.state !== "ready") {
      guilds = [];
      userCache.clear();
      membersByServer.clear();
      cachedDms = [];
      stateChangeListeners.forEach(cb => cb());
    }
    sessionListeners.forEach(cb => cb(session.state));
  });
  void getStoatSessionState().then(session => {
    currentState = session.state;
    sessionListeners.forEach(cb => cb(session.state));
  });
}

export function selectStoatGuild(id: string): StoatGuildSummary | null {
  activeGuildId = id;
  activeChannelId = null;
  return guilds.find(g => g.id === id) ?? null;
}

export async function selectStoatChannel(channelId: string): Promise<StoatMessageSummary[]> {
  activeChannelId = channelId;
  const raw = await window.hyaecord.stoatFetchMessages(channelId);
  return raw as StoatMessageSummary[];
}

export async function sendStoatMessage(channelId: string, content: string): Promise<boolean> {
  return window.hyaecord.stoatSendMessage(channelId, content);
}

export function getSelfStoatUserId(): string | null {
  return selfUserId;
}

/** A minimal message row for Stoat — deliberately simpler than Discord's messageRow(): no pin/embed-suppress/mention context menu items, since those are Discord-specific REST calls this platform doesn't have. */
export function stoatMessageRow(msg: StoatMessageSummary): HTMLElement {
  const avatar = msg.avatar
    ? el("img", { className: "msg-avatar", src: msg.avatar, alt: "", loading: "lazy" })
    : el("span", { className: "msg-avatar msg-avatar-fallback", "aria-hidden": "true" }, msg.authorName[0] ?? "?");
  const content = el("p", { className: "msg-content" }, msg.content);
  applyTwemoji(content);
  return el(
    "article",
    { className: "msg", "data-message": msg.id },
    avatar,
    el(
      "div",
      { className: "msg-body" },
      el("header", { className: "msg-meta" }, el("span", { className: "msg-author" }, msg.authorName)),
      content
    )
  );
}

export async function loginStoat(): Promise<{ ok: boolean; error?: string }> {
  return window.hyaecord.stoatLoginBrowser();
}

export async function logoutStoat(): Promise<void> {
  guilds = [];
  activeGuildId = null;
  activeChannelId = null;
  await window.hyaecord.stoatLogout();
  stateChangeListeners.forEach(cb => cb());
}

export async function getStoatSessionState(): Promise<StoatSession> {
  return window.hyaecord.getStoatSession();
}
