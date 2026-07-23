import type { StoatSession } from "@shared/types";
import { el, t } from "./ui";

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

let guilds: StoatGuildSummary[] = [];
let activeGuildId: string | null = null;
let activeChannelId: string | null = null;
let selfUserId: string | null = null;
let stateChangeListeners = new Set<() => void>();

export function onStoatGuildsChanged(cb: () => void): () => void {
  stateChangeListeners.add(cb);
  return () => stateChangeListeners.delete(cb);
}

export function getStoatGuilds(): StoatGuildSummary[] {
  return guilds;
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
}

function onReady(data: unknown): void {
  const payload = data as { user?: { _id?: string }; servers?: RawStoatServer[]; channels?: RawStoatChannel[] };
  selfUserId = payload.user?._id ?? selfUserId;
  const channelsById = new Map((payload.channels ?? []).map(ch => [ch._id, ch]));
  guilds = (payload.servers ?? []).map(server => ({
    id: server._id,
    name: server.name ?? "?",
    icon: server.icon ? `https://api.stoat.chat/icons/${server.icon._id}` : null,
    channels: server.channels
      .map(id => channelsById.get(id))
      .filter((ch): ch is RawStoatChannel => !!ch && ch.channel_type === "TextChannel")
      .map(ch => ({ id: ch._id, name: ch.name ?? "?" }))
  }));
  stateChangeListeners.forEach(cb => cb());
}

export function initStoatSession(): void {
  window.hyaecord.onStoatEvent((event, data) => {
    if (event === "READY") onReady(data);
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
  return el(
    "article",
    { className: "msg", "data-message": msg.id },
    avatar,
    el(
      "div",
      { className: "msg-body" },
      el("header", { className: "msg-meta" }, el("span", { className: "msg-author" }, msg.authorName)),
      el("p", { className: "msg-content" }, msg.content)
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
