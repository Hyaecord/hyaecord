import type { DiscordSession } from "@shared/types";
import { el, mountRotatingText, patchSettings, showToast, state, t } from "./ui";
import { computeChannelPermissions, hasPermission, Permission } from "./permissions";
import { openProfilePopout } from "./profile-popout";
import { openGifPicker } from "./gif-picker";
import { openEmojiPicker } from "./emoji-picker";
import { setActiveGuildRoles, clearMemberList, applyMemberListUpdate, beginSubscription } from "./member-list";
import { getPfpOverride } from "./avatar-overrides";
import { openContextMenu, copyIdItem, mentionItem, userUrlItem, type ContextMenuItem } from "./context-menu";
import { openMessageSearch } from "./message-search";
import { openFriendsList } from "./friends";
import { tryExecuteSlashCommand, showSlashSuggestions, closeSlashSuggestions } from "./slash-commands";
import { openPinsPanel } from "./pins";

/**
 * Wires a right-click menu onto one element: Developer Mode's "Copy ID"
 * entries (one per `{ id, label }` the target represents — e.g. a message
 * has both its own ID and its author's), plus, when `userId` is given,
 * the always-available Copy Mention / Copy User URL entries (native
 * reimplementations of Equicord's CopyUserMention/CopyUserURLs, see
 * context-menu.ts). `extra` appends more items regardless of Developer
 * Mode (e.g. messageRow's Suppress/Unsuppress Embeds). A no-op (native
 * browser context menu still shows) only when nothing applies at all.
 */
function wireDevModeContextMenu(
  target: HTMLElement,
  entries: Array<{ id: string; label?: string }>,
  userId?: string,
  extra?: () => ContextMenuItem[]
): void {
  target.addEventListener("contextmenu", ev => {
    const items: ContextMenuItem[] = [];
    if (userId) items.push(mentionItem(userId), userUrlItem(userId));
    if (state.settings.developerMode) items.push(...entries.map(e => copyIdItem(e.id, e.label)));
    if (extra) items.push(...extra());
    if (items.length === 0) return;
    ev.preventDefault();
    openContextMenu(ev.clientX, ev.clientY, items);
  });
}

const SUPPRESS_EMBEDS_FLAG = 1 << 2;

/** Own messages can always have their embeds suppressed/unsuppressed; others' need MANAGE_MESSAGES in that channel (DMs have no such permission concept, so only the author can toggle there). */
function canToggleEmbeds(msg: MessageSummary): boolean {
  if (msg.authorId === selfUserId) return true;
  if (!activeGuildId) return false;
  const channel = guilds.find(g => g.id === activeGuildId)?.channels.find(ch => ch.id === msg.channelId);
  return channel ? hasPermission(channel.permissions, Permission.MANAGE_MESSAGES) : false;
}

/** Pin/unpin requires MANAGE_MESSAGES in a guild channel regardless of authorship — per docs.discord.food, unlike embed suppression this isn't author-exempt. DMs allow it unconditionally. */
function pinItem(msg: MessageSummary): ContextMenuItem[] {
  if (!canManageMessagesIn(msg.channelId)) return [];
  return [
    {
      label: msg.pinned ? t("pins.unpin") : t("pins.pin"),
      onClick: async () => {
        const ok = msg.pinned
          ? await window.hyaecord.unpinMessage(msg.channelId, msg.id)
          : await window.hyaecord.pinMessage(msg.channelId, msg.id);
        if (!ok) showToast(t("pins.actionFailed"));
      }
    }
  ];
}

/**
 * Native reimplementation of Equicord's "UnsuppressEmbeds" — see
 * PLUGIN_PARITY.md. Only offered when a message actually has embeds, or
 * is already suppressed (its embeds array is empty *because* it's
 * suppressed — that's the point of the flag), matching the original's
 * own visibility condition.
 */
function suppressEmbedsItem(msg: MessageSummary): ContextMenuItem[] {
  const isSuppressed = (msg.flags & SUPPRESS_EMBEDS_FLAG) !== 0;
  if (!msg.hasEmbeds && !isSuppressed) return [];
  if (!canToggleEmbeds(msg)) return [];
  return [
    {
      label: isSuppressed ? t("devMode.unsuppressEmbeds") : t("devMode.suppressEmbeds"),
      onClick: () => {
        void window.hyaecord.toggleEmbedSuppression(msg.channelId, msg.id, msg.flags);
      }
    }
  ];
}

const CONNECTING_KEYS = [
  "shell.status.connecting.0",
  "shell.status.connecting.1",
  "shell.status.connecting.2",
  "shell.status.connecting.3"
];

/**
 * Discord session presentation: the login view when logged out, and the
 * guild rail / channel list once READY arrives. Message rendering is the
 * next increment — selecting a channel currently only updates the header.
 */

interface ChannelSummary {
  id: string;
  name: string;
  type: number;
  position: number;
  /** Computed effective permissions for the logged-in user in this channel. */
  permissions: bigint;
}

interface GuildSummary {
  id: string;
  name: string;
  icon: string | null;
  banner: string | null;
  channels: ChannelSummary[];
  /** True if the user can manage channels in *any* channel of this guild — gates Moderator View. */
  canManageChannels: boolean;
  /** Role id -> display name/colour, used to label member-list groups (Discord groups members by hoisted role). */
  roles: Record<string, { name: string; color: number }>;
}

interface DmSummary {
  id: string;
  /** Comma-joined recipient names; "?" for a DM with no recipients (shouldn't happen). */
  name: string;
  type: number;
}

/** 0 = normal message; 6 = the automatic "X pinned a message" system notice. Full enum: docs.discord.com/developers/resources/message. */
const MESSAGE_TYPE_PIN_NOTICE = 6;

interface MessageSummary {
  id: string;
  channelId: string;
  authorName: string;
  authorId: string;
  avatar: string | null;
  content: string;
  timestamp: string;
  type: number;
  flags: number;
  hasEmbeds: boolean;
  pinned: boolean;
}

let guilds: GuildSummary[] = [];
let dms: DmSummary[] = [];
let loginOverlay: HTMLElement | null = null;
let activeChannelId: string | null = null;
let activeGuildId: string | null = null;
let selfUserId: string | null = null;
let currentUser: DiscordSession["user"] = null;

/** The logged-in user's own summary (id/username/avatar), for UI like the avatar picker that needs to show/act on it. */
export function getCurrentUser(): DiscordSession["user"] {
  return currentUser;
}

const TEXT_CHANNEL_TYPES = new Set([0, 5]);
const DM_TYPES = new Set([1, 3]);

export function initSession(): void {
  window.hyaecord.onDiscordState(applySession);
  window.hyaecord.onDiscordEvent((event, data) => {
    if (event === "READY") onReady(data);
    if (event === "MESSAGE_CREATE") onMessageCreate(data);
    if (event === "GUILD_MEMBER_LIST_UPDATE") applyMemberListUpdate(data);
    if (event === "PRESENCE_UPDATE") applyPresenceUpdate(data);
  });
  void window.hyaecord.getDiscordSession().then(applySession);
  wireComposer();
  wireChannelProximity();
  wireMessageSearch();
}

function resolveChannelName(channelId: string): string {
  const dm = dms.find(d => d.id === channelId);
  if (dm) return dm.name;
  for (const guild of guilds) {
    const channel = guild.channels.find(ch => ch.id === channelId);
    if (channel) return `# ${channel.name}`;
  }
  return channelId;
}

/** Switches to the given channel (and its guild, or DMs if guildId is null), reusing the exact same selection path a click in the sidebar takes. */
function jumpToChannel(guildId: string | null, channelId: string): void {
  if (guildId) selectGuild(guildId);
  else selectDms();
  document.querySelector<HTMLElement>(`#channels li[data-channel="${channelId}"]`)?.click();
}

function wireMessageSearch(): void {
  const button = document.getElementById("message-search-button") as HTMLButtonElement;
  button.addEventListener("click", () => {
    openMessageSearch(button, { guildId: activeGuildId, channelId: activeGuildId ? null : activeChannelId }, resolveChannelName, channelId =>
      jumpToChannel(activeGuildId, channelId)
    );
  });

  const pinsButton = document.getElementById("pins-button") as HTMLButtonElement;
  pinsButton.addEventListener("click", () => {
    if (!activeChannelId) return;
    openPinsPanel(pinsButton, activeChannelId, canManageMessagesIn(activeChannelId));
  });
}

/** Own messages can always be pinned/unpinned in a DM; guild channels need MANAGE_MESSAGES regardless of authorship (matches docs.discord.food's real requirement — pin/unpin isn't author-exempt the way embed suppression is). */
function canManageMessagesIn(channelId: string): boolean {
  if (!activeGuildId) return true;
  const channel = guilds.find(g => g.id === activeGuildId)?.channels.find(ch => ch.id === channelId);
  return channel ? hasPermission(channel.permissions, Permission.MANAGE_MESSAGES) : false;
}

/**
 * Channel names brighten and nudge toward the accent colour as the cursor
 * passes near them vertically — a lightweight CSS-custom-property version of
 * the "proximity sidebar" effect (no rAF loop needed at this list size; the
 * CSS transition on --effect does the smoothing).
 */
function wireChannelProximity(): void {
  const list = document.getElementById("channels")!;
  const PROXIMITY_RADIUS = 90;
  list.addEventListener("pointermove", ev => {
    const rect = list.getBoundingClientRect();
    const pointerY = ev.clientY - rect.top;
    for (const item of list.querySelectorAll<HTMLElement>("li")) {
      const center = item.offsetTop + item.offsetHeight / 2;
      const distance = Math.abs(pointerY - center);
      const effect = Math.max(0, 1 - distance / PROXIMITY_RADIUS);
      item.style.setProperty("--effect", effect.toFixed(3));
    }
  });
  list.addEventListener("pointerleave", () => {
    for (const item of list.querySelectorAll<HTMLElement>("li")) {
      item.style.setProperty("--effect", "0");
    }
  });
}

/**
 * Native reimplementation of Equicord's "SilentMessageToggle" — see
 * PLUGIN_PARITY.md. The original prepends `"@silent "` to the message
 * content, which only works because Discord's *own* official composer
 * parses and strips that prefix client-side before building the request;
 * a client that talks to the REST API directly (like this one) has to set
 * the real thing instead — the SUPPRESS_NOTIFICATIONS message flag (see
 * rest.ts's createMessage). Auto-disables after one send, matching the
 * original's default `autoDisable: true` (no persistence option ported —
 * this app has no per-channel/per-restart state store for it yet).
 */
let silentModeEnabled = false;

function wireComposer(): void {
  const input = document.getElementById("composer-input") as HTMLInputElement;
  const silentButton = document.getElementById("silent-toggle-button") as HTMLButtonElement;
  silentButton.addEventListener("click", () => {
    silentModeEnabled = !silentModeEnabled;
    silentButton.classList.toggle("is-active", silentModeEnabled);
    silentButton.setAttribute("aria-pressed", String(silentModeEnabled));
    silentButton.title = silentModeEnabled ? t("composer.silentOn") : t("composer.silentOff");
  });

  input.addEventListener("input", () => {
    const match = input.value.match(/^\/(\w*)$/);
    if (match) {
      showSlashSuggestions(input, match[1] ?? "", name => {
        input.value = `/${name} `;
        input.setSelectionRange(input.value.length, input.value.length);
        input.focus();
        closeSlashSuggestions();
      });
    } else {
      closeSlashSuggestions();
    }
  });
  input.addEventListener("blur", () => closeSlashSuggestions());

  input.addEventListener("keydown", async ev => {
    if (ev.key !== "Enter" || !activeChannelId || !input.value.trim()) return;
    closeSlashSuggestions();
    const original = input.value;
    const result = await tryExecuteSlashCommand(original);
    if (result.handled && result.content === null) {
      input.value = ""; // a plugin command declined to produce a message
      return;
    }
    const content = result.handled ? (result.content as string) : original;
    const silent = silentModeEnabled;
    input.value = "";
    if (silent) {
      silentModeEnabled = false;
      silentButton.classList.remove("is-active");
      silentButton.setAttribute("aria-pressed", "false");
    }
    const ok = await window.hyaecord.sendMessage(activeChannelId, content, silent);
    if (!ok) {
      input.value = original; // don't lose what they typed
    }
  });

  const gifButton = document.getElementById("gif-picker-button") as HTMLButtonElement;
  gifButton.addEventListener("click", () => {
    openGifPicker(gifButton, url => {
      if (!activeChannelId) return;
      void window.hyaecord.sendMessage(activeChannelId, url);
    });
  });

  const emojiButton = document.getElementById("emoji-picker-button") as HTMLButtonElement;
  emojiButton.addEventListener("click", () => {
    openEmojiPicker(emojiButton, emoji => {
      const start = input.selectionStart ?? input.value.length;
      const end = input.selectionEnd ?? input.value.length;
      input.value = input.value.slice(0, start) + emoji + input.value.slice(end);
      const caret = start + emoji.length;
      input.setSelectionRange(caret, caret);
      input.focus();
    });
  });
}

let stopRotation: (() => void) | null = null;
let freshLoginNoticeShown = false;

function applySession(session: DiscordSession): void {
  currentUser = session.user;
  stopRotation?.();
  stopRotation = null;

  const header = document.getElementById("chat-header")!;
  if (session.state === "connecting" || session.state === "reconnecting") {
    stopRotation = mountRotatingText(header, CONNECTING_KEYS);
  } else if (session.state === "ready") {
    header.classList.remove("rotating-text", "is-fading");
    header.textContent = session.user?.globalName ?? session.user?.username ?? "";
  } else {
    header.classList.remove("rotating-text", "is-fading");
    header.textContent = t("shell.status.loggedOut");
  }

  if (session.state === "logged-out") {
    showLogin();
  } else if (session.state === "ready") {
    hideLogin();
    if (session.freshLogin && !freshLoginNoticeShown) {
      freshLoginNoticeShown = true;
      showFreshLoginNotice();
    }
  }
}

/**
 * A one-time, dismissible caution after a brand-new login (not a restored
 * session). Discord's own abuse-detection systems can react badly to a new
 * client immediately sending messages after authenticating — this is a soft
 * heads-up, not a guarantee, since the detection logic is entirely on
 * Discord's side. See the incident note in BUILD_PROMPT.md.
 */
function showFreshLoginNotice(): void {
  const notice = el(
    "div",
    { className: "fresh-login-notice", role: "status" },
    t("session.freshLoginNotice"),
    " ",
    el(
      "button",
      {
        className: "link-button",
        type: "button",
        onClick: (ev: Event) => (ev.currentTarget as HTMLElement).closest(".fresh-login-notice")?.remove()
      },
      t("session.freshLoginNotice.dismiss")
    )
  );
  const messages = document.getElementById("messages")!;
  messages.parentElement?.insertBefore(notice, messages);
}

/* ---------- READY → guild rail + channels ---------- */

/**
 * Global presence tracking — friends and implicit relationships only, not
 * a general "everyone's status" store. Per docs.discord.food's gateway
 * events reference: a user-account gateway session automatically
 * receives PRESENCE_UPDATE for its friends (no explicit subscription
 * needed, unlike guild member lists' OP 14), and READY's own `presences`
 * field gives the initial snapshot for whoever's already non-offline —
 * both confirmed there, not assumed. Anyone not in this map is presumed
 * offline (the safe default — Discord only sends non-offline presences
 * in READY, per that same doc).
 */
const presenceMap = new Map<string, string>();
const presenceListeners = new Set<() => void>();

export function getPresenceStatus(userId: string): string {
  return presenceMap.get(userId) ?? "offline";
}

/** Called by anything that wants to re-render when a tracked presence changes (e.g. the Friends list, while open). */
export function onPresenceChange(cb: () => void): () => void {
  presenceListeners.add(cb);
  return () => presenceListeners.delete(cb);
}

function applyPresenceUpdate(data: unknown): void {
  const p = data as { user?: { id?: string }; status?: string };
  if (!p.user?.id || !p.status) return;
  presenceMap.set(p.user.id, p.status);
  presenceListeners.forEach(cb => cb());
}

function onReady(data: unknown): void {
  const payload = data as {
    user?: { id?: string };
    guilds?: unknown[];
    private_channels?: unknown[];
    presences?: Array<{ user?: { id?: string }; status?: string }>;
  };
  selfUserId = payload.user?.id ?? selfUserId;

  presenceMap.clear();
  for (const p of payload.presences ?? []) {
    if (p.user?.id && p.status) presenceMap.set(p.user.id, p.status);
  }

  const raw = payload.guilds ?? [];
  guilds = raw.map(entry => {
    const g = entry as {
      id: string;
      name?: string;
      icon?: string | null;
      banner?: string | null;
      properties?: { name?: string; icon?: string | null; banner?: string | null };
      channels?: Array<{
        id: string;
        name?: string;
        type?: number;
        position?: number;
        permission_overwrites?: Array<{ id?: string; type?: number; allow?: string; deny?: string }>;
      }>;
      roles?: Array<{ id: string; name: string; color: number }>;
    };
    const channels: ChannelSummary[] = (g.channels ?? []).map(ch => ({
      id: ch.id,
      name: ch.name ?? "?",
      type: ch.type ?? 0,
      position: ch.position ?? 0,
      permissions: selfUserId ? computeChannelPermissions(g, ch, selfUserId) : 0n
    }));
    const roles: Record<string, { name: string; color: number }> = {};
    for (const role of g.roles ?? []) roles[role.id] = { name: role.name, color: role.color };
    return {
      id: g.id,
      name: g.properties?.name ?? g.name ?? "?",
      icon: g.properties?.icon ?? g.icon ?? null,
      banner: g.properties?.banner ?? g.banner ?? null,
      channels,
      roles,
      canManageChannels: channels.some(ch => hasPermission(ch.permissions, Permission.MANAGE_CHANNELS))
    };
  });

  dms = (payload.private_channels ?? []).map(entry => {
    const d = entry as {
      id: string;
      type?: number;
      recipients?: Array<{ global_name?: string | null; username?: string }>;
    };
    const names = (d.recipients ?? []).map(r => r.global_name ?? r.username ?? "?").join(", ");
    return { id: d.id, type: d.type ?? 1, name: names || "?" };
  });

  renderRail();
  const first = guilds.find(g => !isChomperHidden(g.id));
  if (first) selectGuild(first.id);
}

/* ---------- Server Chomper: swipe a server pill or DM row away to hide + mute it ---------- */

const CHOMPER_SWIPE_THRESHOLD = 70;

function isChomperHidden(id: string): boolean {
  const { hidden, showHidden } = state.settings.chomper;
  return hidden.some(h => h.id === id) && !showHidden;
}

function isChomperTracked(id: string): boolean {
  return state.settings.chomper.hidden.some(h => h.id === id);
}

async function chomperHide(id: string, type: "guild" | "dm", name: string): Promise<void> {
  const hidden = state.settings.chomper.hidden;
  if (!hidden.some(h => h.id === id)) {
    await patchSettings({ chomper: { ...state.settings.chomper, hidden: [...hidden, { id, type }] } });
  }
  if (type === "guild") void window.hyaecord.muteGuild(id, true);
  else void window.hyaecord.muteDm(id, true);
  showToast(t("chomper.hidden", { name }));

  if (type === "guild") {
    renderRail();
    if (activeGuildId === id) {
      const next = guilds.find(g => !isChomperHidden(g.id));
      if (next) selectGuild(next.id);
      else selectDms();
    }
  } else if (activeGuildId === null) {
    selectDms(); // re-render the DM list without the one just hidden
  }
}

/** Wires horizontal drag-to-hide on a server pill or DM list row. */
function wireChomperDrag(target: HTMLElement, id: string, type: "guild" | "dm", name: string): void {
  let startX = 0;
  let dx = 0;
  let dragging = false;

  target.addEventListener("pointerdown", ev => {
    startX = ev.clientX;
    dx = 0;
    dragging = true;
    target.setPointerCapture(ev.pointerId);
  });
  target.addEventListener("pointermove", ev => {
    if (!dragging) return;
    dx = ev.clientX - startX;
    target.style.transform = `translateX(${dx}px)`;
    target.style.opacity = String(Math.max(0.3, 1 - Math.abs(dx) / 140));
  });
  const end = () => {
    if (!dragging) return;
    dragging = false;
    target.style.transform = "";
    target.style.opacity = "";
    if (Math.abs(dx) > CHOMPER_SWIPE_THRESHOLD) {
      target.dataset.suppressClick = "true";
      void chomperHide(id, type, name);
    }
    dx = 0;
  };
  target.addEventListener("pointerup", end);
  target.addEventListener("pointercancel", end);
}

/** Re-renders the server rail and, if DMs are the active view, the DM list too — used after the Chomper restore toggle flips, since that can change what's visible in either place. */
export function refreshChomperViews(): void {
  renderRail();
  if (activeGuildId === null) selectDms();
}

/* ---------- Server folders: drag one server pill onto another to group them ----------
 * Local to this client only — see the note on HyaecordSettings.serverFolders for why
 * this doesn't round-trip Discord's real protobuf folder settings. Drag is a vertical
 * gesture on the pill (orthogonal to Chomper's horizontal swipe-to-hide, so the same
 * pointer sequence can commit to either one based on which axis actually moves first);
 * there's also an explicit "Remove from folder" button on each folder member for
 * keyboard/touch users, since drag-to-group itself has no non-pointer equivalent yet
 * (same as Discord's own client).
 */

type ServerFolder = { id: string; name: string; color: string | null; guildIds: string[]; collapsed: boolean };

const FOLDER_COLORS = ["#5865f2", "#57f287", "#fee75c", "#eb459e", "#ed4245", "#eb8e34"];

function folderOf(guildId: string): ServerFolder | null {
  return state.settings.serverFolders.find(f => f.guildIds.includes(guildId)) ?? null;
}

async function saveFolders(folders: ServerFolder[]): Promise<void> {
  await patchSettings({ serverFolders: folders.filter(f => f.guildIds.length > 0) });
}

/** Merges `draggedId` into `targetId`'s folder, or creates a new one containing both. */
async function groupGuilds(draggedId: string, targetId: string): Promise<void> {
  if (draggedId === targetId) return;
  const folders = state.settings.serverFolders.map(f => ({ ...f, guildIds: f.guildIds.filter(id => id !== draggedId) }));
  const targetFolder = folders.find(f => f.guildIds.includes(targetId));
  if (targetFolder) {
    targetFolder.guildIds.push(draggedId);
  } else {
    folders.push({
      id: `folder-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      name: "",
      color: FOLDER_COLORS[Math.floor(Math.random() * FOLDER_COLORS.length)] ?? null,
      guildIds: [targetId, draggedId],
      collapsed: false
    });
  }
  await saveFolders(folders);
  renderRail();
}

async function removeFromFolder(guildId: string): Promise<void> {
  const folders = state.settings.serverFolders.map(f => ({ ...f, guildIds: f.guildIds.filter(id => id !== guildId) }));
  await saveFolders(folders);
  renderRail();
}

async function toggleFolderCollapsed(folderId: string): Promise<void> {
  const folders = state.settings.serverFolders.map(f => (f.id === folderId ? { ...f, collapsed: !f.collapsed } : f));
  await saveFolders(folders);
  renderRail();
}

async function renameFolder(folderId: string, name: string): Promise<void> {
  const folders = state.settings.serverFolders.map(f => (f.id === folderId ? { ...f, name } : f));
  await saveFolders(folders);
}

const FOLDER_DRAG_ACTIVATE_PX = 10;

/** Wires a server pill for both Chomper's horizontal swipe-to-hide and vertical drag-to-group into a folder. */
function wireRailPointer(target: HTMLElement, guild: GuildSummary): void {
  let startX = 0;
  let startY = 0;
  let mode: "none" | "hide" | "group" = "none";
  let dx = 0;
  let hoverTarget: HTMLElement | null = null;

  const clearHover = () => {
    hoverTarget?.classList.remove("folder-drop-target");
    hoverTarget = null;
  };

  target.addEventListener("pointerdown", ev => {
    startX = ev.clientX;
    startY = ev.clientY;
    mode = "none";
    dx = 0;
    target.setPointerCapture(ev.pointerId);
  });

  target.addEventListener("pointermove", ev => {
    const moveX = ev.clientX - startX;
    const moveY = ev.clientY - startY;
    if (mode === "none") {
      if (Math.abs(moveX) < FOLDER_DRAG_ACTIVATE_PX && Math.abs(moveY) < FOLDER_DRAG_ACTIVATE_PX) return;
      mode = Math.abs(moveX) > Math.abs(moveY) ? "hide" : "group";
    }
    if (mode === "hide") {
      dx = moveX;
      target.style.transform = `translateX(${dx}px)`;
      target.style.opacity = String(Math.max(0.3, 1 - Math.abs(dx) / 140));
    } else {
      target.releasePointerCapture(ev.pointerId);
      clearHover();
      const under = document
        .elementFromPoint(ev.clientX, ev.clientY)
        ?.closest<HTMLElement>(".server-pill[data-guild], .server-folder-head");
      if (under && under !== target) {
        under.classList.add("folder-drop-target");
        hoverTarget = under;
      }
    }
  });

  const end = () => {
    if (mode === "hide") {
      target.style.transform = "";
      target.style.opacity = "";
      if (Math.abs(dx) > CHOMPER_SWIPE_THRESHOLD) {
        target.dataset.suppressClick = "true";
        void chomperHide(guild.id, "guild", guild.name);
      }
    } else if (mode === "group" && hoverTarget) {
      target.dataset.suppressClick = "true";
      const targetGuildId = hoverTarget.dataset.guild;
      const targetFolderId = hoverTarget.dataset.folder;
      if (targetGuildId) void groupGuilds(guild.id, targetGuildId);
      else if (targetFolderId) {
        const folders = state.settings.serverFolders.map(f =>
          f.id === targetFolderId ? { ...f, guildIds: [...f.guildIds.filter(id => id !== guild.id), guild.id] } : f
        );
        void saveFolders(folders).then(renderRail);
      }
    }
    clearHover();
    mode = "none";
    dx = 0;
  };
  target.addEventListener("pointerup", end);
  target.addEventListener("pointercancel", () => {
    if (mode === "hide") {
      target.style.transform = "";
      target.style.opacity = "";
    }
    clearHover();
    mode = "none";
  });
}

function buildGuildPill(guild: GuildSummary, inFolder: ServerFolder | null): HTMLElement {
  const pill = el("button", {
    className: isChomperTracked(guild.id) ? "server-pill chomper-restored" : "server-pill",
    type: "button",
    title: guild.name,
    "aria-label": guild.name,
    "data-guild": guild.id,
    onClick: () => {
      if (pill.dataset.suppressClick) {
        delete pill.dataset.suppressClick;
        return;
      }
      selectGuild(guild.id);
    }
  });
  wireRailPointer(pill, guild);
  wireDevModeContextMenu(pill, [{ id: guild.id, label: t("devMode.copyServerId") }]);
  if (guild.icon) {
    pill.append(
      el("img", {
        src: `https://cdn.discordapp.com/icons/${guild.id}/${guild.icon}.png?size=96`,
        alt: "",
        loading: "lazy"
      })
    );
  } else {
    pill.textContent = guild.name
      .split(/\s+/)
      .map(w => w[0] ?? "")
      .join("")
      .slice(0, 3);
  }
  if (inFolder) {
    const removeBtn = el(
      "button",
      {
        type: "button",
        className: "folder-remove-btn",
        title: t("serverFolders.remove", { name: guild.name }),
        "aria-label": t("serverFolders.remove", { name: guild.name }),
        onClick: (ev: Event) => {
          ev.stopPropagation();
          void removeFromFolder(guild.id);
        }
      },
      "×"
    );
    return el("div", { className: "folder-member" }, pill, removeBtn);
  }
  return pill;
}

function buildFolderElement(folder: ServerFolder): HTMLElement {
  const members = folder.guildIds.map(id => guilds.find(g => g.id === id)).filter((g): g is GuildSummary => !!g && !isChomperHidden(g.id));
  if (members.length === 0) return el("div", {});

  const head = el("button", {
    type: "button",
    className: "server-pill server-folder-head",
    "data-folder": folder.id,
    style: folder.color ? `border-color: ${folder.color};` : "",
    title: folder.name || t("serverFolders.untitled"),
    "aria-label": folder.name || t("serverFolders.untitled"),
    "aria-expanded": String(!folder.collapsed),
    onClick: () => void toggleFolderCollapsed(folder.id)
  });
  if (folder.collapsed) {
    head.className += " is-collapsed";
    head.append(
      el(
        "div",
        { className: "folder-mini-grid" },
        ...members.slice(0, 4).map(g =>
          g.icon
            ? el("img", { src: `https://cdn.discordapp.com/icons/${g.id}/${g.icon}.png?size=32`, alt: "", loading: "lazy" })
            : el("span", { className: "folder-mini-initial" }, g.name[0] ?? "?")
        )
      )
    );
  } else {
    head.textContent = "▾";
  }

  if (folder.collapsed) return head;

  const nameLabel = el("span", { className: "folder-name", tabindex: "0", role: "button" }, folder.name || t("serverFolders.untitled"));
  nameLabel.addEventListener("dblclick", () => {
    const input = el("input", { className: "folder-name-input", value: folder.name }) as HTMLInputElement;
    nameLabel.replaceWith(input);
    input.focus();
    input.select();
    const commit = () => {
      void renameFolder(folder.id, input.value.trim());
      input.replaceWith(nameLabel);
      nameLabel.textContent = input.value.trim() || t("serverFolders.untitled");
    };
    input.addEventListener("blur", commit);
    input.addEventListener("keydown", ev => {
      if (ev.key === "Enter") input.blur();
    });
  });

  return el(
    "div",
    { className: "server-folder is-expanded" },
    head,
    nameLabel,
    ...members.map(g => buildGuildPill(g, folder))
  );
}

export function renderRail(): void {
  const rail = document.getElementById("server-rail")!;
  rail.querySelectorAll(".server-pill, .dm-pill, .friends-pill, .server-folder").forEach(pill => pill.remove());
  const settingsButton = rail.querySelector(".settings-button");

  const dmPill = el(
    "button",
    {
      className: "server-pill dm-pill",
      type: "button",
      title: t("shell.directMessages"),
      "aria-label": t("shell.directMessages"),
      onClick: selectDms
    },
    "💬"
  );
  rail.insertBefore(dmPill, settingsButton);

  const friendsPill = el(
    "button",
    {
      className: "server-pill friends-pill",
      type: "button",
      title: t("shell.friends"),
      "aria-label": t("shell.friends"),
      onClick: () => openFriendsList()
    },
    "👥"
  );
  rail.insertBefore(friendsPill, settingsButton);

  const renderedFolders = new Set<string>();
  for (const guild of guilds) {
    if (isChomperHidden(guild.id)) continue;
    const folder = folderOf(guild.id);
    if (folder) {
      if (renderedFolders.has(folder.id)) continue;
      renderedFolders.add(folder.id);
      rail.insertBefore(buildFolderElement(folder), settingsButton);
      continue;
    }
    rail.insertBefore(buildGuildPill(guild, null), settingsButton);
  }
}

function markActivePill(guildId: string | null): void {
  document.querySelectorAll<HTMLElement>(".server-pill").forEach(pill => {
    const isDm = pill.classList.contains("dm-pill");
    pill.setAttribute("aria-current", isDm ? String(guildId === null) : String(pill.dataset.guild === guildId));
  });
}

function selectDms(): void {
  activeGuildId = null;
  markActivePill(null);
  applyServerHeaderBanner(null, t("shell.directMessages"), null);
  clearMemberList();

  const list = document.getElementById("channels")!;
  list.replaceChildren();
  for (const dm of dms) {
    if (isChomperHidden(dm.id)) continue;
    const li = el("li", {
      tabindex: "0",
      "data-channel": dm.id,
      className: isChomperTracked(dm.id) ? "chomper-restored" : ""
    }, dm.name);
    const select = () => {
      if (li.dataset.suppressClick) {
        delete li.dataset.suppressClick;
        return;
      }
      list.querySelectorAll("li").forEach(item => item.removeAttribute("aria-current"));
      li.setAttribute("aria-current", "true");
      document.getElementById("chat-header")!.textContent = dm.name;
      const input = document.getElementById("composer-input") as HTMLInputElement;
      input.placeholder = t("shell.chat.placeholder").replace("#general", dm.name);
      activeChannelId = dm.id;
      void loadMessages(dm.id);
    };
    li.addEventListener("click", select);
    li.addEventListener("keydown", ev => {
      if ((ev as KeyboardEvent).key === "Enter") select();
    });
    wireChomperDrag(li, dm.id, "dm", dm.name);
    wireDevModeContextMenu(li, [{ id: dm.id, label: t("devMode.copyChannelId") }]);
    list.append(li);
  }
}

/**
 * Renders a guild's real banner as a backdrop behind its name in the
 * channel-list header — Discord's own client shows this same image as a
 * thin, heavily-cropped sliver; this gives it real visual room instead
 * (see BUILD_PROMPT.md's "server banner rendering" item). CSS `cover` +
 * a fixed-height strip is deliberate: Discord doesn't publish a banner
 * aspect ratio anywhere (checked docs.discord.com and docs.discord.food,
 * neither states one), so `cover` sidesteps needing that fact at all
 * rather than guessing at it.
 */
function applyServerHeaderBanner(guildId: string | null, name: string, banner: string | null): void {
  const header = document.getElementById("server-header")!;
  header.textContent = name;
  if (guildId && banner) {
    header.classList.add("has-banner");
    header.style.backgroundImage = `linear-gradient(rgba(0,0,0,0.35), rgba(0,0,0,0.55)), url(https://cdn.discordapp.com/banners/${guildId}/${banner}.png?size=512)`;
  } else {
    header.classList.remove("has-banner");
    header.style.backgroundImage = "";
  }
}

function selectGuild(id: string): void {
  const guild = guilds.find(g => g.id === id);
  if (!guild) return;

  activeGuildId = id;
  markActivePill(id);
  applyServerHeaderBanner(guild.id, guild.name, guild.banner);
  setActiveGuildRoles(guild.roles);

  const list = document.getElementById("channels")!;
  list.replaceChildren();
  const channels = guild.channels
    .filter(ch => TEXT_CHANNEL_TYPES.has(ch.type))
    .sort((a, b) => a.position - b.position);
  for (const channel of channels) {
    const li = el("li", { tabindex: "0", "data-channel": channel.id }, `# ${channel.name}`);
    const select = () => {
      list.querySelectorAll("li").forEach(item => item.removeAttribute("aria-current"));
      li.setAttribute("aria-current", "true");
      document.getElementById("chat-header")!.textContent = `# ${channel.name}`;
      const input = document.getElementById("composer-input") as HTMLInputElement;
      input.placeholder = t("shell.chat.placeholder").replace("#general", `#${channel.name}`);
      activeChannelId = channel.id;
      void loadMessages(channel.id);
      beginSubscription(id);
      window.hyaecord.subscribeMemberList(id, channel.id);
    };
    li.addEventListener("click", select);
    li.addEventListener("keydown", ev => {
      if ((ev as KeyboardEvent).key === "Enter") select();
    });
    wireDevModeContextMenu(li, [{ id: channel.id, label: t("devMode.copyChannelId") }]);
    list.append(li);
  }
}

export function getActiveGuild(): GuildSummary | null {
  return guilds.find(g => g.id === activeGuildId) ?? null;
}

/* ---------- messages ---------- */

function toSummary(raw: unknown): MessageSummary | null {
  const m = raw as {
    id?: string;
    channel_id?: string;
    content?: string;
    timestamp?: string;
    type?: number;
    flags?: number;
    embeds?: unknown[];
    pinned?: boolean;
    author?: { id?: string; username?: string; global_name?: string | null; avatar?: string | null };
  };
  if (!m?.id || !m.channel_id || !m.author?.id) return null;
  return {
    id: m.id,
    channelId: m.channel_id,
    authorId: m.author.id,
    authorName: m.author.global_name ?? m.author.username ?? "?",
    avatar: m.author.avatar ?? null,
    content: m.content ?? "",
    timestamp: m.timestamp ?? "",
    type: m.type ?? 0,
    flags: m.flags ?? 0,
    hasEmbeds: (m.embeds?.length ?? 0) > 0,
    pinned: m.pinned ?? false
  };
}

/**
 * Discord's automatic "X pinned a message to this channel" system notice.
 * When it's *your own* pin action and the self-pin-fade setting is on, it
 * fades out and removes itself after `selfPinFade.delaySeconds` — the
 * DOM removal alone gives the smooth reflow (no layout jump), no manual
 * height animation needed since it's just one line in a flex column.
 * Pins by other people are left alone (always visible) — there's no
 * "hide other people's pins" setting in the UI to honour yet.
 */
function pinNoticeRow(msg: MessageSummary): HTMLElement {
  const row = el(
    "div",
    { className: "pin-notice", "data-message": msg.id },
    "📌 ",
    el("span", { className: "pin-notice-author" }, msg.authorName),
    ` ${t("message.pinNotice")}`
  );
  const { enabled, delaySeconds } = state.settings.selfPinFade;
  if (enabled && msg.authorId === selfUserId) {
    setTimeout(() => {
      row.classList.add("is-fading");
      // Not just transitionend: a 0ms transition (reduced-motion zeroes
      // --dur-slow) never fires that event at all, which would leave the
      // notice stuck forever instead of disappearing instantly. The
      // timeout guarantees removal either way; whichever fires first wins,
      // and removing an already-removed node is a harmless no-op.
      row.addEventListener("transitionend", () => row.remove(), { once: true });
      setTimeout(() => row.remove(), 400);
    }, delaySeconds * 1000);
  }
  return row;
}

function messageRow(msg: MessageSummary): HTMLElement {
  if (msg.type === MESSAGE_TYPE_PIN_NOTICE) return pinNoticeRow(msg);

  // A UserPFP override, if the user has one and the integration is on,
  // takes priority over their real Discord avatar — same behaviour as
  // the real UserPFP plugin.
  const pfpOverride = getPfpOverride(msg.authorId);
  const avatarSrc = pfpOverride ?? (msg.avatar ? `https://cdn.discordapp.com/avatars/${msg.authorId}/${msg.avatar}.png?size=64` : null);
  const avatar = avatarSrc
    ? el("img", {
        className: "msg-avatar",
        src: avatarSrc,
        alt: "",
        loading: "lazy"
      })
    : el("span", { className: "msg-avatar msg-avatar-fallback", "aria-hidden": "true" },
        msg.authorName[0] ?? "?");
  avatar.classList.add("clickable-profile");
  avatar.addEventListener("click", () => openProfilePopout(msg.authorId, avatar));

  const authorName = el("span", { className: "msg-author clickable-profile" }, msg.authorName);
  authorName.addEventListener("click", () => openProfilePopout(msg.authorId, authorName));

  const time = msg.timestamp
    ? new Date(msg.timestamp).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })
    : "";
  const row = el(
    "article",
    { className: "msg", "data-message": msg.id },
    avatar,
    el("div", { className: "msg-body" },
      el("header", { className: "msg-meta" },
        authorName,
        el("time", { className: "msg-time" }, time)
      ),
      // textContent path only — message content must never become HTML
      el("p", { className: "msg-content" }, msg.content)
    )
  );
  wireDevModeContextMenu(
    row,
    [
      { id: msg.id, label: t("devMode.copyMessageId") },
      { id: msg.authorId, label: t("devMode.copyAuthorId") }
    ],
    msg.authorId,
    () => [...pinItem(msg), ...suppressEmbedsItem(msg)]
  );
  return row;
}

async function loadMessages(channelId: string): Promise<void> {
  const container = document.getElementById("messages")!;
  container.replaceChildren();
  const raw = await window.hyaecord.fetchMessages(channelId);
  if (channelId !== activeChannelId) return; // user moved on while we fetched
  for (const entry of raw) {
    const msg = toSummary(entry);
    if (msg) container.append(messageRow(msg));
  }
  container.scrollTop = container.scrollHeight;
}

function onMessageCreate(data: unknown): void {
  const msg = toSummary(data);
  if (!msg || msg.channelId !== activeChannelId) return;
  const container = document.getElementById("messages")!;
  const atBottom =
    container.scrollHeight - container.scrollTop - container.clientHeight < 80;
  container.append(messageRow(msg));
  if (atBottom) container.scrollTop = container.scrollHeight;
}

/* ---------- login view ----------
 * Leads with the two trustworthy paths — a real embedded discord.com login
 * page, and Discord's own QR-code scan flow — so it's unmistakable this is
 * genuine Discord and not a phishing-shaped custom form. Typing an email
 * and password into our own UI, or pasting a token, are both still here
 * (some people prefer them, and they hit the exact same real endpoints),
 * but demoted to secondary links rather than the default screen. */

/**
 * Login is browser-only by design: it opens the real discord.com/login page
 * in an embedded window rather than any form of ours, so there's nothing
 * here that could be mistaken for a phishing-shaped credential prompt and
 * nothing asking a user to trust this app with a pasted token. See
 * browser-login.ts / loginWithBrowser() for the actual implementation.
 */
function showLogin(): void {
  if (loginOverlay) return;

  const browserError = el("p", { className: "login-error", role: "alert" });
  const browserButton = el(
    "button",
    {
      className: "btn primary login-big-btn",
      type: "button",
      onClick: async () => {
        browserError.textContent = "";
        browserButton.setAttribute("disabled", "");
        const result = await window.hyaecord.discordLoginBrowser();
        browserButton.removeAttribute("disabled");
        if (!result.ok && result.error !== "cancelled") {
          browserError.textContent = t(`login.error.${result.error}`);
        } else if (result.ok && result.persisted === false) {
          showToast(t("login.sessionOnly"));
        }
      }
    },
    t("login.withBrowser")
  ) as HTMLButtonElement;

  const vpnNotice = el("div", { className: "login-vpn-notice", hidden: true });
  void window.hyaecord.isUsingVpn().then(detected => {
    if (!detected) return;
    vpnNotice.hidden = false;
    vpnNotice.append(
      t("login.vpnNotice"),
      " ",
      el(
        "button",
        { className: "link-button", type: "button", onClick: () => (vpnNotice.hidden = true) },
        t("login.vpnNotice.dismiss")
      )
    );
  });

  const body = el(
    "div",
    { className: "login-body" },
    el("p", { className: "modal-subtitle" }, t("login.welcomeBody")),
    vpnNotice,
    browserButton,
    browserError
  );
  const dialog = el(
    "div",
    { className: "modal login", role: "dialog", "aria-modal": "true", "aria-labelledby": "login-title" },
    el("h1", { id: "login-title" }, t("login.title")),
    body
  );
  loginOverlay = el("div", { className: "overlay" }, dialog);
  document.body.append(loginOverlay);
  browserButton.focus();
}

function hideLogin(): void {
  loginOverlay?.remove();
  loginOverlay = null;
}
