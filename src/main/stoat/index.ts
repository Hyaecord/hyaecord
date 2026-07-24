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

export interface StoatAttachmentSummary {
  url: string;
  filename: string;
  contentType: string;
  isImage: boolean;
  width: number | null;
  height: number | null;
}

function toAttachment(file: { _id: string; filename: string; content_type: string; metadata: { type: string; width?: number; height?: number } }): StoatAttachmentSummary {
  return {
    url: stoatFileUrl("attachments", file._id),
    filename: file.filename,
    contentType: file.content_type,
    isImage: file.metadata.type === "Image",
    width: file.metadata.width ?? null,
    height: file.metadata.height ?? null
  };
}

export interface StoatReactionSummary {
  emoji: string;
  userIds: string[];
}

function toReactions(reactions: Record<string, string[]> | undefined): StoatReactionSummary[] {
  return Object.entries(reactions ?? {}).map(([emoji, userIds]) => ({ emoji, userIds }));
}

function toSummary(
  raw: RawStoatMessage,
  users: Map<string, RawStoatUser>
): {
  id: string;
  channelId: string;
  authorId: string;
  authorName: string;
  avatar: string | null;
  content: string;
  pinned: boolean;
  edited: boolean;
  attachments: StoatAttachmentSummary[];
  reactions: StoatReactionSummary[];
  replyToId: string | null;
} {
  const author = raw.user ?? users.get(raw.author);
  return {
    id: raw._id,
    channelId: raw.channel,
    authorId: raw.author,
    authorName: author?.display_name || author?.username || "?",
    avatar: author?.avatar ? stoatFileUrl("avatars", author.avatar._id) : null,
    content: raw.content ?? "",
    pinned: raw.pinned ?? false,
    edited: !!raw.edited,
    attachments: (raw.attachments ?? []).map(toAttachment),
    reactions: toReactions(raw.reactions),
    replyToId: raw.replies?.[0] ?? null
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

async function searchInternal(channelId: string, query: string | null, pinnedOnly: boolean) {
  if (!rest) return [];
  try {
    const { messages, users } = await rest.searchMessages(channelId, query, pinnedOnly);
    const userMap = new Map(users.map(u => [u._id, u]));
    return messages.reverse().map(m => toSummary(m, userMap));
  } catch {
    return [];
  }
}

/** Real full-text search within one channel — `POST /channels/{id}/search`, confirmed real via the OpenAPI spec. */
export async function searchMessages(channelId: string, query: string) {
  return searchInternal(channelId, query, false);
}

/** Real "every pinned message in this channel," not just the ones within the last-fetched page — see rest.ts's searchMessages for why this is a genuine upgrade over filtering fetchMessages() client-side. */
export async function getPinnedMessages(channelId: string) {
  return searchInternal(channelId, null, true);
}

export async function sendMessage(channelId: string, content: string, replyTo?: { id: string; mention: boolean }): Promise<boolean> {
  if (!rest || !content.trim()) return false;
  try {
    await rest.createMessage(channelId, content, replyTo);
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

export async function editMessage(channelId: string, messageId: string, content: string): Promise<boolean> {
  if (!rest || !content.trim()) return false;
  try {
    await rest.editMessage(channelId, messageId, content);
    return true;
  } catch {
    return false;
  }
}

export async function deleteMessage(channelId: string, messageId: string): Promise<boolean> {
  if (!rest) return false;
  try {
    await rest.deleteMessage(channelId, messageId);
    return true;
  } catch {
    return false;
  }
}

export async function addReaction(channelId: string, messageId: string, emoji: string): Promise<boolean> {
  if (!rest) return false;
  try {
    await rest.addReaction(channelId, messageId, emoji);
    return true;
  } catch {
    return false;
  }
}

export async function removeReaction(channelId: string, messageId: string, emoji: string): Promise<boolean> {
  if (!rest) return false;
  try {
    await rest.removeReaction(channelId, messageId, emoji);
    return true;
  } catch {
    return false;
  }
}

/** Real bio/banner for the profile popout — fetched on demand only when a popout actually opens (see rest.ts's getProfile), not preloaded for every user in a list. */
export async function getUserProfile(userId: string): Promise<{ bio: string | null; banner: string | null }> {
  if (!rest) return { bio: null, banner: null };
  try {
    const profile = await rest.getProfile(userId);
    return {
      bio: profile.content ?? null,
      banner: profile.background ? stoatFileUrl("backgrounds", profile.background._id) : null
    };
  } catch {
    return { bio: null, banner: null };
  }
}

/** Resolves an author the renderer hasn't cached yet (e.g. someone who posts a live message but wasn't in Ready's initial user snapshot) — real `GET /users/{id}`, not a guess at what the gateway would eventually send. */
export async function getUser(userId: string): Promise<{ id: string; username: string; displayName: string | null; avatar: string | null } | null> {
  if (!rest) return null;
  try {
    const u = await rest.getUser(userId);
    return {
      id: u._id,
      username: u.username,
      displayName: u.display_name ?? null,
      avatar: u.avatar ? stoatFileUrl("avatars", u.avatar._id) : null
    };
  } catch {
    return null;
  }
}

export async function sendFriendRequest(usernameWithDiscriminator: string): Promise<{ ok: boolean; error?: string }> {
  if (!rest) return { ok: false, error: "network" };
  try {
    await rest.sendFriendRequest(usernameWithDiscriminator);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof StoatRestError ? err.message : "network" };
  }
}

export async function acceptFriendRequest(userId: string): Promise<boolean> {
  if (!rest) return false;
  try {
    await rest.acceptFriendRequest(userId);
    return true;
  } catch {
    return false;
  }
}

export async function removeFriend(userId: string): Promise<boolean> {
  if (!rest) return false;
  try {
    await rest.removeFriend(userId);
    return true;
  } catch {
    return false;
  }
}

export function startTyping(channelId: string): void {
  gateway?.beginTyping(channelId);
}

export function stopTyping(channelId: string): void {
  gateway?.endTyping(channelId);
}

/** Real "create a new server" — `POST /servers/create`, only `name` required (no icon upload needed, so no dependency on the Autumn upload flow this pass deliberately doesn't build — see stoat-session.ts's module doc comment). Returns the new server id directly from the REST response rather than waiting on the "ServerCreate" gateway dispatch (which still arrives too, harmlessly de-duped client-side). */
export async function createServer(name: string): Promise<{ ok: boolean; serverId?: string; error?: string }> {
  if (!rest) return { ok: false, error: "network" };
  const trimmed = name.trim();
  if (!trimmed) return { ok: false, error: "invalid" };
  try {
    const res = await rest.createServer(trimmed);
    return { ok: true, serverId: res.server._id };
  } catch (err) {
    return { ok: false, error: err instanceof StoatRestError ? err.message : "network" };
  }
}

export async function leaveServer(serverId: string): Promise<boolean> {
  if (!rest) return false;
  try {
    await rest.leaveServer(serverId);
    return true;
  } catch {
    return false;
  }
}

/** Real "generate a shareable invite link" — the app could only ever *use* an invite before this (item 79), never create one. Builds the real, clickable `stoat.chat/invite/{code}` URL from the returned code. */
export async function createInvite(channelId: string): Promise<{ ok: boolean; url?: string; error?: string }> {
  if (!rest) return { ok: false, error: "network" };
  try {
    const invite = await rest.createInvite(channelId);
    return { ok: true, url: `https://stoat.chat/invite/${invite._id}` };
  } catch (err) {
    return { ok: false, error: err instanceof StoatRestError ? err.message : "network" };
  }
}

export interface StoatInvitePreview {
  serverId: string;
  serverName: string;
  serverIcon: string | null;
  memberCount: number;
}

/** Real "preview a server invite before joining" — `GET /invites/{code}`, strips any `stoat.chat/invite/`-style prefix the user might have pasted in whole. */
export async function previewInvite(codeOrUrl: string): Promise<{ ok: true; invite: StoatInvitePreview } | { ok: false; error: string }> {
  if (!rest) return { ok: false, error: "network" };
  const code = codeOrUrl.trim().replace(/^https?:\/\/(www\.)?stoat\.chat\/invite\//, "").replace(/\/$/, "");
  if (!code) return { ok: false, error: "invalid" };
  try {
    const raw = await rest.fetchInvite(code);
    if (raw.type !== "Server" || !raw.server_id) return { ok: false, error: "invalid" };
    return {
      ok: true,
      invite: {
        serverId: raw.server_id,
        serverName: raw.server_name ?? "?",
        serverIcon: raw.server_icon ? stoatFileUrl("icons", raw.server_icon._id) : null,
        memberCount: raw.member_count ?? 0
      }
    };
  } catch (err) {
    return { ok: false, error: err instanceof StoatRestError ? err.message : "network" };
  }
}

/** Real "actually join" — `POST /invites/{code}`. The renderer re-derives the same bare code from whatever was previewed, so this doesn't need the raw pasted URL again. */
export async function joinServerInvite(code: string): Promise<{ ok: boolean; error?: string }> {
  if (!rest) return { ok: false, error: "network" };
  try {
    await rest.joinInvite(code);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof StoatRestError ? err.message : "network" };
  }
}

/** Real "start a new DM" — Stoat had no way to open one with someone you don't already have a DM channel with; `GET /users/{id}/dm` both opens the existing one and creates one if needed, per the OpenAPI spec. */
export async function openDM(userId: string): Promise<string | null> {
  if (!rest) return null;
  try {
    const channel = await rest.openDM(userId);
    return channel._id;
  } catch {
    return null;
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
