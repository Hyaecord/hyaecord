import type { StoatSession, StoatMemberSummary } from "@shared/types";
import { el, t } from "./ui";
import { applyTwemoji } from "./twemoji";
import { ulidTimestampMs } from "./ulid";
import { openContextMenu, type ContextMenuItem } from "./context-menu";
import { openEmojiPicker } from "./emoji-picker";

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

export interface StoatReaction {
  emoji: string;
  userIds: string[];
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
  reactions: StoatReaction[];
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
    reactions: [],
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

type StoatReactionListener = (messageId: string, emoji: string, userId: string, added: boolean) => void;
const messageReactionListeners = new Set<StoatReactionListener>();

export function onStoatMessageReaction(cb: StoatReactionListener): () => void {
  messageReactionListeners.add(cb);
  return () => messageReactionListeners.delete(cb);
}

/** "MessageReact"/"MessageUnreact" — per the same Revolt protocol convention as the message events above, carrying `{id, channel_id, user_id, emoji_id}`; same honesty caveat about not being live-verified this pass. */
function onLiveReaction(data: unknown, added: boolean): void {
  const payload = data as { id?: string; user_id?: string; emoji_id?: string };
  if (!payload.id || !payload.user_id || !payload.emoji_id) return;
  messageReactionListeners.forEach(cb => cb(payload.id!, payload.emoji_id!, payload.user_id!, added));
}

export function initStoatSession(): void {
  window.hyaecord.onStoatEvent((event, data) => {
    if (event === "READY") onReady(data);
    else if (event === "Message") void onLiveMessage(data);
    else if (event === "MessageUpdate") onLiveMessageUpdate(data);
    else if (event === "MessageDelete") onLiveMessageDelete(data);
    else if (event === "MessageReact") onLiveReaction(data, true);
    else if (event === "MessageUnreact") onLiveReaction(data, false);
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
  reactions: StoatReaction[];
}

function mapRawMessages(raw: RawStoatMessageSummary[]): StoatMessageSummary[] {
  return raw.map(m => ({ ...m, timestamp: ulidTimestampMs(m.id) }));
}

export async function selectStoatChannel(channelId: string): Promise<StoatMessageSummary[]> {
  activeChannelId = channelId;
  const raw = (await window.hyaecord.stoatFetchMessages(channelId)) as RawStoatMessageSummary[];
  return mapRawMessages(raw);
}

export async function sendStoatMessage(channelId: string, content: string): Promise<boolean> {
  return window.hyaecord.stoatSendMessage(channelId, content);
}

/** Real full-text search within one channel — `POST /channels/{id}/search`, confirmed real via the OpenAPI spec (Stoat's own equivalent of Discord's message search, message-search.ts). */
export async function searchStoatMessages(channelId: string, query: string): Promise<StoatMessageSummary[]> {
  const raw = (await window.hyaecord.stoatSearchMessages(channelId, query)) as RawStoatMessageSummary[];
  return mapRawMessages(raw);
}

/** Real, full-history pinned-messages list — `POST /channels/{id}/search` with `pinned: true` (confirmed real via the OpenAPI `DataMessageSearch` schema), not limited to whatever the channel's most recently fetched page happens to contain like the first version of this function was. */
export async function fetchStoatPins(channelId: string): Promise<StoatMessageSummary[]> {
  const raw = (await window.hyaecord.stoatGetPinnedMessages(channelId)) as RawStoatMessageSummary[];
  return mapRawMessages(raw);
}

export async function pinStoatMessage(channelId: string, messageId: string): Promise<boolean> {
  return window.hyaecord.stoatPinMessage(channelId, messageId);
}

export async function unpinStoatMessage(channelId: string, messageId: string): Promise<boolean> {
  return window.hyaecord.stoatUnpinMessage(channelId, messageId);
}

export async function editStoatMessage(channelId: string, messageId: string, content: string): Promise<boolean> {
  return window.hyaecord.stoatEditMessage(channelId, messageId, content);
}

export async function deleteStoatMessage(channelId: string, messageId: string): Promise<boolean> {
  return window.hyaecord.stoatDeleteMessage(channelId, messageId);
}

export async function addStoatReaction(channelId: string, messageId: string, emoji: string): Promise<boolean> {
  return window.hyaecord.stoatAddReaction(channelId, messageId, emoji);
}

export async function removeStoatReaction(channelId: string, messageId: string, emoji: string): Promise<boolean> {
  return window.hyaecord.stoatRemoveReaction(channelId, messageId, emoji);
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

/**
 * Renders one pill per reaction (emoji + count), highlighted when the
 * current user is one of the reactors, plus a small "+" to add a new one
 * via the existing emoji picker. Clicking toggles the real reaction via
 * PUT/DELETE (rest.ts) and optimistically updates `msg.reactions` in
 * place before the round trip resolves, re-rendering just this row —
 * the same optimistic-then-reconcile pattern real chat clients use so a
 * click feels instant rather than waiting on the network.
 */
function reactionsEl(msg: StoatMessageSummary): HTMLElement {
  const wrap = el("div", { className: "msg-reactions" });
  const render = () => {
    wrap.replaceChildren();
    for (const r of msg.reactions) {
      if (r.userIds.length === 0) continue;
      const mine = !!selfUserId && r.userIds.includes(selfUserId);
      const pill = el(
        "button",
        {
          type: "button",
          className: mine ? "msg-reaction-pill is-mine" : "msg-reaction-pill",
          "data-emoji": r.emoji,
          "data-users": r.userIds.join(","),
          onClick: () => {
            if (mine) {
              r.userIds = r.userIds.filter(id => id !== selfUserId);
              void removeStoatReaction(msg.channelId, msg.id, r.emoji);
            } else if (selfUserId) {
              r.userIds = [...r.userIds, selfUserId];
              void addStoatReaction(msg.channelId, msg.id, r.emoji);
            }
            render();
          }
        },
        r.emoji,
        " ",
        el("span", { className: "msg-reaction-count" }, String(r.userIds.length))
      );
      applyTwemoji(pill);
      wrap.append(pill);
    }
    const addButton = el(
      "button",
      { type: "button", className: "msg-reaction-add", "aria-label": t("emojiPicker.title"), onClick: () => openEmojiPicker(addButton, emoji => {
        const existing = msg.reactions.find(r => r.emoji === emoji);
        if (existing) {
          if (!existing.userIds.includes(selfUserId ?? "")) existing.userIds.push(selfUserId ?? "");
        } else {
          msg.reactions.push({ emoji, userIds: selfUserId ? [selfUserId] : [] });
        }
        void addStoatReaction(msg.channelId, msg.id, emoji);
        render();
      }) },
      "+"
    );
    wrap.append(addButton);
  };
  render();
  return wrap;
}

/**
 * Patches an already-rendered message row's reaction pills directly in
 * the DOM for a live reaction from someone else — reads/writes each
 * pill's own `data-users` attribute rather than needing the original
 * `StoatMessageSummary` object still in memory (this app doesn't keep
 * one around after rendering), so a live `MessageReact`/`MessageUnreact`
 * dispatch can update the right message even though session.ts's chat
 * pane only tracks DOM state, not a live message array.
 */
export function applyLiveStoatReaction(container: HTMLElement, messageId: string, emoji: string, userId: string, added: boolean): void {
  const reactionsRow = container.querySelector<HTMLElement>(`.msg[data-message="${messageId}"] .msg-reactions`);
  if (!reactionsRow) return;
  const existing = reactionsRow.querySelector<HTMLButtonElement>(`.msg-reaction-pill[data-emoji="${CSS.escape(emoji)}"]`);
  const users = existing ? existing.dataset.users!.split(",").filter(Boolean) : [];
  const nextUsers = added ? [...new Set([...users, userId])] : users.filter(id => id !== userId);

  if (nextUsers.length === 0) {
    existing?.remove();
    return;
  }
  const mine = !!selfUserId && nextUsers.includes(selfUserId);
  const pill =
    existing ??
    (() => {
      const messageEl = reactionsRow.closest<HTMLElement>(".msg");
      const channelId = messageEl?.dataset.channel ?? "";
      const created = el("button", { type: "button", className: "msg-reaction-pill", "data-emoji": emoji }, emoji, " ", el("span", { className: "msg-reaction-count" }, "0"));
      created.addEventListener("click", () => {
        const mine = created.classList.contains("is-mine");
        void (mine ? removeStoatReaction(channelId, messageId, emoji) : addStoatReaction(channelId, messageId, emoji));
      });
      applyTwemoji(created);
      reactionsRow.insertBefore(created, reactionsRow.lastElementChild); // before the "+" add button
      return created;
    })();
  pill.dataset.users = nextUsers.join(",");
  pill.classList.toggle("is-mine", mine);
  const countEl = pill.querySelector(".msg-reaction-count");
  if (countEl) countEl.textContent = String(nextUsers.length);
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

  /** Swaps the content paragraph for an inline `<input>` (Enter saves via the real PATCH endpoint, Escape cancels) — no modal system for this, matching how lightweight the original edit is meant to feel. */
  const startEditing = (): void => {
    const input = el("input", { type: "text", className: "msg-edit-input", value: msg.content }) as HTMLInputElement;
    content.replaceWith(input);
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
    const finish = async (save: boolean) => {
      if (save && input.value.trim() && input.value !== msg.content) {
        const ok = await editStoatMessage(msg.channelId, msg.id, input.value.trim());
        if (ok) {
          msg.content = input.value.trim();
          msg.edited = true;
        }
      }
      content.replaceChildren(msg.content);
      applyTwemoji(content);
      input.replaceWith(content);
    };
    input.addEventListener("keydown", ev => {
      if (ev.key === "Enter") void finish(true);
      else if (ev.key === "Escape") void finish(false);
    });
    input.addEventListener("blur", () => void finish(true));
  };

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
  bodyChildren.push(reactionsEl(msg));
  const row = el(
    "article",
    {
      className: grouped ? "msg msg-grouped" : "msg",
      "data-message": msg.id,
      "data-author": msg.authorId,
      "data-timestamp": String(msg.timestamp ?? 0),
      "data-channel": msg.channelId
    },
    avatar,
    el("div", { className: "msg-body" }, ...bodyChildren)
  );
  row.addEventListener("contextmenu", ev => {
    ev.preventDefault();
    const items: ContextMenuItem[] = [
      {
        label: msg.pinned ? t("pins.unpin") : t("pins.pin"),
        onClick: () => void (msg.pinned ? unpinStoatMessage(msg.channelId, msg.id) : pinStoatMessage(msg.channelId, msg.id))
      }
    ];
    // Edit/delete are only real REST actions for your own messages — Stoat
    // has no per-channel permission model this app computes yet (see the
    // scope note on stoatMessageRow itself), so there's no equivalent of
    // Discord's MANAGE_MESSAGES-can-delete-anyone's-message here.
    if (msg.authorId === selfUserId) {
      items.push(
        { label: t("message.edit"), onClick: startEditing },
        {
          label: t("message.delete"),
          onClick: () => {
            void deleteStoatMessage(msg.channelId, msg.id).then(ok => {
              if (ok) row.remove();
            });
          }
        }
      );
    }
    openContextMenu(ev.clientX, ev.clientY, items);
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
