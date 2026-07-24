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

export interface StoatAttachment {
  url: string;
  filename: string;
  contentType: string;
  isImage: boolean;
  width: number | null;
  height: number | null;
}

export interface StoatMessageSummary {
  id: string;
  channelId: string;
  authorId: string;
  authorName: string;
  avatar: string | null;
  content: string;
  pinned: boolean;
  edited: boolean;
  attachments: StoatAttachment[];
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

interface RawLiveMessage {
  _id: string;
  channel: string;
  author: string;
  content?: string | null;
  pinned?: boolean;
  edited?: string | null;
  attachments?: Array<{ _id: string; filename: string; content_type: string; metadata: { type: string; width?: number; height?: number } }> | null;
}

function attachmentsFromRaw(files: RawLiveMessage["attachments"]): StoatAttachment[] {
  return (files ?? []).map(f => ({
    url: `${cdnBase}/attachments/${f._id}`,
    filename: f.filename,
    contentType: f.content_type,
    isImage: f.metadata.type === "Image",
    width: f.metadata.width ?? null,
    height: f.metadata.height ?? null
  }));
}

/** Resolves an author for a live message, lazily fetching+caching via `GET /users/{id}` if this session hasn't seen them before (e.g. someone Ready's snapshot didn't include). */
async function resolveAuthor(authorId: string): Promise<CachedStoatUser | null> {
  const cached = userCache.get(authorId);
  if (cached) return cached;
  const fetched = await window.hyaecord.stoatGetUser(authorId);
  if (!fetched) return null;
  const entry: CachedStoatUser = {
    id: fetched.id,
    username: fetched.username,
    displayName: fetched.displayName,
    avatar: fetched.avatar,
    relationship: "None",
    online: false,
    presence: null
  };
  userCache.set(authorId, entry);
  return entry;
}

type StoatMessageListener = (msg: StoatMessageSummary) => void;
type StoatMessageUpdateListener = (messageId: string, patch: { content?: string; edited?: boolean }) => void;
type StoatMessageDeleteListener = (messageId: string) => void;

const messageCreateListeners = new Set<StoatMessageListener>();
const messageUpdateListeners = new Set<StoatMessageUpdateListener>();
const messageDeleteListeners = new Set<StoatMessageDeleteListener>();

/** Live "a new message arrived" — session.ts's chat pane subscribes to append it when the affected channel is the one currently open, same role Discord's MESSAGE_CREATE dispatch plays for onMessageCreate(). */
export function onStoatMessageCreate(cb: StoatMessageListener): () => void {
  messageCreateListeners.add(cb);
  return () => messageCreateListeners.delete(cb);
}

export function onStoatMessageUpdate(cb: StoatMessageUpdateListener): () => void {
  messageUpdateListeners.add(cb);
  return () => messageUpdateListeners.delete(cb);
}

export function onStoatMessageDelete(cb: StoatMessageDeleteListener): () => void {
  messageDeleteListeners.add(cb);
  return () => messageDeleteListeners.delete(cb);
}

/**
 * Live message dispatch handling — event names ("Message", "MessageUpdate",
 * "MessageDelete") and shapes follow the Revolt gateway protocol Stoat
 * forked from (a long-stable, publicly documented convention: the
 * dispatch payload for a create event IS the Message object itself with a
 * `type` field added; update events carry `{id, channel, data: <changed
 * fields>}`; delete events carry `{id, channel}`) — not verified against a
 * live Stoat gateway session this pass (none was reachable from this
 * sandbox), so this parses leniently and simply does nothing on a shape
 * mismatch rather than throwing.
 */
async function onLiveMessage(data: unknown): Promise<void> {
  const raw = data as RawLiveMessage;
  if (!raw._id || !raw.channel || !raw.author) return;
  const author = await resolveAuthor(raw.author);
  const msg: StoatMessageSummary = {
    id: raw._id,
    channelId: raw.channel,
    authorId: raw.author,
    authorName: author?.displayName || author?.username || "?",
    avatar: author?.avatar ?? null,
    content: raw.content ?? "",
    pinned: raw.pinned ?? false,
    edited: !!raw.edited,
    attachments: attachmentsFromRaw(raw.attachments),
    timestamp: ulidTimestampMs(raw._id)
  };
  messageCreateListeners.forEach(cb => cb(msg));
}

function onLiveMessageUpdate(data: unknown): void {
  const payload = data as { id?: string; channel?: string; data?: { content?: string; edited?: string | null } };
  if (!payload.id) return;
  const patch: { content?: string; edited?: boolean } = {};
  if (payload.data?.content !== undefined) patch.content = payload.data.content;
  if (payload.data?.edited !== undefined) patch.edited = !!payload.data.edited;
  messageUpdateListeners.forEach(cb => cb(payload.id!, patch));
}

function onLiveMessageDelete(data: unknown): void {
  const payload = data as { id?: string };
  if (!payload.id) return;
  messageDeleteListeners.forEach(cb => cb(payload.id!));
}

export function initStoatSession(): void {
  window.hyaecord.onStoatEvent((event, data) => {
    if (event === "READY") onReady(data);
    else if (event === "Message") void onLiveMessage(data);
    else if (event === "MessageUpdate") onLiveMessageUpdate(data);
    else if (event === "MessageDelete") onLiveMessageDelete(data);
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
  edited: boolean;
  attachments: StoatAttachment[];
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
/** Renders a message's attachments — inline `<img>` for real images (per `File.metadata.type === "Image"`, not a filename-extension guess), a plain download link for anything else. Neither Discord's nor Stoat's message row rendered attachments at all before this — a real, previously-silent gap on both platforms; only Stoat's is fixed this pass per explicit scope. */
function attachmentsEl(attachments: StoatAttachment[]): HTMLElement | null {
  if (attachments.length === 0) return null;
  return el(
    "div",
    { className: "msg-attachments" },
    ...attachments.map(a =>
      a.isImage
        ? el("img", {
            className: "msg-attachment-image",
            src: a.url,
            alt: a.filename,
            loading: "lazy",
            style: a.width && a.height ? `aspect-ratio: ${a.width} / ${a.height};` : ""
          })
        : el(
            "button",
            {
              type: "button",
              className: "msg-attachment-file",
              onClick: () => void window.hyaecord.openExternal(a.url)
            },
            a.filename
          )
    )
  );
}

/** Same window Discord's own client uses for grouping consecutive messages from one author — see GROUP_WINDOW_MS's twin in session.ts. */
const GROUP_WINDOW_MS = 7 * 60 * 1000;

/** Reads the previous message's author/timestamp straight off the last rendered `.msg` row rather than tracking separate JS state — works identically whether the new row comes from the initial bulk load or a live "Message" dispatch. */
export function lastRenderedMessageMeta(container: HTMLElement): { authorId: string; timestamp: number } | null {
  const last = container.lastElementChild as HTMLElement | null;
  if (!last?.classList.contains("msg")) return null;
  const authorId = last.dataset.author;
  const timestamp = Number(last.dataset.timestamp);
  if (!authorId || !timestamp) return null;
  return { authorId, timestamp };
}

export function stoatMessageRow(msg: StoatMessageSummary, previous: { authorId: string; timestamp: number } | null = null): HTMLElement {
  const grouped = !!previous && previous.authorId === msg.authorId && msg.timestamp !== null && msg.timestamp - previous.timestamp < GROUP_WINDOW_MS;
  const time = msg.timestamp
    ? new Date(msg.timestamp).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })
    : "";
  const avatar = grouped
    ? el("time", { className: "msg-hover-time" }, time)
    : msg.avatar
      ? el("img", { className: "msg-avatar", src: msg.avatar, alt: "", loading: "lazy" })
      : el("span", { className: "msg-avatar msg-avatar-fallback", "aria-hidden": "true" }, msg.authorName[0] ?? "?");
  const content = el("p", { className: "msg-content" }, msg.content);
  applyTwemoji(content);
  const bodyChildren: HTMLElement[] = [];
  if (!grouped) {
    bodyChildren.push(
      el(
        "header",
        { className: "msg-meta" },
        el("span", { className: "msg-author" }, msg.authorName),
        el("time", { className: "msg-time" }, time),
        ...(msg.edited ? [el("span", { className: "msg-edited" }, t("message.edited"))] : [])
      )
    );
  } else if (msg.edited) {
    bodyChildren.push(el("span", { className: "msg-edited" }, t("message.edited")));
  }
  bodyChildren.push(content);
  const attachmentsRow = attachmentsEl(msg.attachments);
  if (attachmentsRow) bodyChildren.push(attachmentsRow);
  const row = el(
    "article",
    { className: grouped ? "msg msg-grouped" : "msg", "data-message": msg.id, "data-author": msg.authorId, "data-timestamp": String(msg.timestamp ?? 0) },
    avatar,
    el("div", { className: "msg-body" }, ...bodyChildren)
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
