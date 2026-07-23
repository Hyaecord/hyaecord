import type { StoatSession, StoatMemberSummary } from "@shared/types";
import { el, t } from "./ui";
import { applyTwemoji } from "./twemoji";
import { ulidTimestampMs } from "./ulid";
import { openContextMenu } from "./context-menu";

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
  banner: string | null;
  channels: StoatChannelSummary[];
}

export interface StoatMessageSummary {
  id: string;
  channelId: string;
  authorId: string;
  authorName: string;
  avatar: string | null;
  content: string;
  pinned: boolean;
  /** Decoded from the message's own ULID — see ulid.ts; Stoat's Message schema has no separate timestamp field. */
  timestamp: number | null;
}

export interface StoatFriendSummary {
  id: string;
  username: string;
  displayName: string | null;
  avatar: string | null;
  online: boolean;
  presence: string | null;
}

/** Discord-style status-dot class ("online"|"idle"|"dnd"|"offline") from Stoat's real `online`/`status.presence` fields. Focus and Busy both read as restrictive/"don't disturb" states, closest existing dot color to what they mean — an approximation, not a documented 1:1 mapping, since Stoat has no "dnd" concept of its own. */
export function stoatPresenceStatus(user: { online: boolean; presence: string | null }): string {
  if (!user.online) return "offline";
  switch (user.presence) {
    case "Idle":
      return "idle";
    case "Busy":
    case "Focus":
      return "dnd";
    case "Invisible":
      return "offline";
    default:
      return "online";
  }
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
  online: boolean;
  presence: string | null;
}

const userCache = new Map<string, CachedStoatUser>();
/** Keyed by server id -> that server's real member list, fetched via `GET /servers/{id}/members` when the server is opened (see fetchStoatMembers) — Ready's own `members` array only ever carries the current user's own membership, not the full roster. */
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
  banner?: { _id: string } | null;
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
  /** RelationshipStatus: None | User | Friend | Outgoing | Incoming | Blocked | BlockedOther — per the OpenAPI User schema. "User" marks the entry that IS the currently authenticated account, since Ready has no separate top-level `user` field to identify self from. */
  relationship?: string;
  online?: boolean;
  status?: { presence?: string | null } | null;
}

function onReady(data: unknown): void {
  const payload = data as {
    servers?: RawStoatServer[];
    channels?: RawStoatChannel[];
    users?: RawStoatReadyUser[];
    cdnBase?: string;
  };
  if (payload.cdnBase) cdnBase = payload.cdnBase;

  userCache.clear();
  for (const u of payload.users ?? []) {
    if (u.relationship === "User") selfUserId = u._id;
    userCache.set(u._id, {
      id: u._id,
      username: u.username,
      displayName: u.display_name ?? null,
      avatar: u.avatar ? `${cdnBase}/avatars/${u.avatar._id}` : null,
      relationship: u.relationship ?? "None",
      online: u.online ?? false,
      presence: u.status?.presence ?? null
    });
  }

  membersByServer.clear();

  const channelsById = new Map((payload.channels ?? []).map(ch => [ch._id, ch]));
  guilds = (payload.servers ?? []).map(server => ({
    id: server._id,
    name: server.name ?? "?",
    icon: server.icon ? `${cdnBase}/icons/${server.icon._id}` : null,
    banner: server.banner ? `${cdnBase}/banners/${server.banner._id}` : null,
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
    .map(u => ({ id: u.id, username: u.username, displayName: u.displayName, avatar: u.avatar, online: u.online, presence: u.presence }));
}

export function getStoatMembers(serverId: string): StoatMemberSummary[] {
  return membersByServer.get(serverId) ?? [];
}

/** Real per-server member list via `GET /servers/{id}/members` — Ready's own payload doesn't carry one (see membersByServer's comment above). Caches per server; call again (e.g. on re-selecting the server) to refresh. */
export async function fetchStoatMembers(serverId: string): Promise<StoatMemberSummary[]> {
  const members = await window.hyaecord.stoatGetServerMembers(serverId);
  membersByServer.set(serverId, members);
  return members;
}

export interface StoatDmDisplay {
  id: string;
  name: string;
  icon: string | null;
}

let cachedDms: import("@shared/types").StoatDMSummary[] = [];

/**
 * Stoat's `GET /users/dms` results, resolved to display names/avatars via
 * the user cache. Two real-schema facts drive this: a `DirectMessage`
 * channel has no icon of its own (per the OpenAPI `Channel` schema, only
 * `Group` does) — Discord's own client shows the *other recipient's*
 * avatar as the DM's icon, and this does the same; and `recipients`
 * genuinely includes the current user too (it's a full participant list,
 * not "everyone but you"), so filtering it by `selfUserId` is required,
 * not optional, to avoid your own name/avatar showing up in your own DM
 * list.
 */
export async function fetchStoatDMs(): Promise<StoatDmDisplay[]> {
  cachedDms = await window.hyaecord.stoatGetDMs();
  return cachedDms.map(dm => {
    if (dm.channelType === "SavedMessages") {
      return { id: dm.id, name: t("shell.stoatSavedMessages"), icon: null };
    }
    const others = dm.recipientIds.filter(id => id !== selfUserId);
    if (dm.name) return { id: dm.id, name: dm.name, icon: dm.icon };
    const otherUsers = others.map(id => userCache.get(id));
    const name = otherUsers.map(u => u?.displayName || u?.username || "?").join(", ") || "?";
    const icon = dm.icon ?? (otherUsers.length === 1 ? (otherUsers[0]?.avatar ?? null) : null);
    return { id: dm.id, name, icon };
  });
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

interface RawStoatMessageSummary {
  id: string;
  channelId: string;
  authorId: string;
  authorName: string;
  avatar: string | null;
  content: string;
  pinned: boolean;
}

export async function selectStoatChannel(channelId: string): Promise<StoatMessageSummary[]> {
  activeChannelId = channelId;
  const raw = (await window.hyaecord.stoatFetchMessages(channelId)) as RawStoatMessageSummary[];
  return raw.map(m => ({ ...m, timestamp: ulidTimestampMs(m.id) }));
}

export async function sendStoatMessage(channelId: string, content: string): Promise<boolean> {
  return window.hyaecord.stoatSendMessage(channelId, content);
}

/** Stoat has no dedicated "list pins" endpoint (confirmed absent from its OpenAPI paths) — only pin/unpin actions and a `pinned` flag on each message. Real, honest scope: this surfaces pins found within the channel's most recently fetched messages, not the channel's full history. */
export async function fetchStoatPins(channelId: string): Promise<StoatMessageSummary[]> {
  const messages = await selectStoatChannel(channelId);
  return messages.filter(m => m.pinned);
}

export async function pinStoatMessage(channelId: string, messageId: string): Promise<boolean> {
  return window.hyaecord.stoatPinMessage(channelId, messageId);
}

export async function unpinStoatMessage(channelId: string, messageId: string): Promise<boolean> {
  return window.hyaecord.stoatUnpinMessage(channelId, messageId);
}

export function getSelfStoatUserId(): string | null {
  return selfUserId;
}

/** For the minimal profile popout (stoat-profile-popout.ts) and anywhere else that needs a cached user's presence/name/avatar without a fresh fetch. */
export function getStoatUser(id: string): { username: string; displayName: string | null; avatar: string | null; online: boolean; presence: string | null } | null {
  const u = userCache.get(id);
  if (!u) return null;
  return { username: u.username, displayName: u.displayName, avatar: u.avatar, online: u.online, presence: u.presence };
}

/** A minimal message row for Stoat — deliberately simpler than Discord's messageRow(): no embed-suppress/mention context menu items (Discord-specific REST calls this platform doesn't have), but pin/unpin is real (see rest.ts) and offered unconditionally, matching Discord's own pin item's author-independent permission rule for DMs — Stoat has no per-channel permission model this app computes yet, so this doesn't attempt to gate it further. */
export function stoatMessageRow(msg: StoatMessageSummary): HTMLElement {
  const avatar = msg.avatar
    ? el("img", { className: "msg-avatar", src: msg.avatar, alt: "", loading: "lazy" })
    : el("span", { className: "msg-avatar msg-avatar-fallback", "aria-hidden": "true" }, msg.authorName[0] ?? "?");
  const content = el("p", { className: "msg-content" }, msg.content);
  applyTwemoji(content);
  const time = msg.timestamp
    ? new Date(msg.timestamp).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })
    : "";
  const row = el(
    "article",
    { className: "msg", "data-message": msg.id },
    avatar,
    el(
      "div",
      { className: "msg-body" },
      el(
        "header",
        { className: "msg-meta" },
        el("span", { className: "msg-author" }, msg.authorName),
        el("time", { className: "msg-time" }, time)
      ),
      content
    )
  );
  row.addEventListener("contextmenu", ev => {
    ev.preventDefault();
    openContextMenu(ev.clientX, ev.clientY, [
      {
        label: msg.pinned ? t("pins.unpin") : t("pins.pin"),
        onClick: () => void (msg.pinned ? unpinStoatMessage(msg.channelId, msg.id) : pinStoatMessage(msg.channelId, msg.id))
      }
    ]);
  });
  return row;
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
