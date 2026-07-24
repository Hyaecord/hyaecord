import type { DiscordSession } from "@shared/types";
import { el, mountRotatingText, patchSettings, showToast, state, t } from "./ui";
import { computeChannelPermissions, hasPermission, Permission } from "./permissions";
import { openProfilePopout } from "./profile-popout";
import { openGifPicker } from "./gif-picker";
import { openStickerPicker } from "./sticker-picker";
import { openEmojiPicker } from "./emoji-picker";
import { setActiveGuildRoles, clearMemberList, applyMemberListUpdate, beginSubscription, renderStoatMembers } from "./member-list";
import { getPfpOverride } from "./avatar-overrides";
import { openContextMenu, copyIdItem, mentionItem, userUrlItem, type ContextMenuItem } from "./context-menu";
import { openMessageSearch } from "./message-search";
import { openFriendsList } from "./friends";
import { tryExecuteSlashCommand, showSlashSuggestions, closeSlashSuggestions } from "./slash-commands";
import { openPinsPanel } from "./pins";
import { initVoiceUI, setVoiceChannelNameResolver } from "./voice-ui";
import { icon } from "./icons";
import { applyTwemoji } from "./twemoji";
import {
  getStoatGuilds,
  onStoatGuildsChanged,
  initStoatSession,
  selectStoatGuild,
  selectStoatChannel,
  sendStoatMessage,
  stoatMessageRow,
  isStoatReady,
  onStoatStateChange,
  loginStoat,
  getStoatMembers,
  fetchStoatMembers,
  fetchStoatDMs,
  fetchStoatPins,
  searchStoatMessages,
  pinStoatMessage,
  unpinStoatMessage,
  onStoatMessageCreate,
  onStoatMessageUpdate,
  onStoatMessageDelete,
  onStoatMessageReaction,
  applyLiveStoatReaction,
  onStoatTyping,
  notifyStoatTyping,
  getSelfStoatUserId,
  getStoatUser,
  lastRenderedMessageMeta,
  type StoatChannelSummary,
  type StoatMessageSummary
} from "./stoat-session";

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
  avatar: string | null;
}

interface StoatDmSummary {
  id: string;
  name: string;
  icon: string | null;
}

let stoatDms: StoatDmSummary[] = [];

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
/** Which backend the currently-open chat pane belongs to — routes the composer's send and the message list's fetch/render to the right platform. */
let activeChatPlatform: "discord" | "stoat" = "discord";
let currentUser: DiscordSession["user"] = null;

/** The logged-in user's own summary (id/username/avatar), for UI like the avatar picker that needs to show/act on it. */
export function getCurrentUser(): DiscordSession["user"] {
  return currentUser;
}

const TEXT_CHANNEL_TYPES = new Set([0, 5]);
/** GUILD_VOICE only (2) — stage channels (13) work differently enough (speaker/audience roles) that they're deliberately not included here yet. */
const VOICE_CHANNEL_TYPE = 2;
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
  initVoiceUI();
  setVoiceChannelNameResolver(resolveChannelName);
  initStoatSession();
  onStoatGuildsChanged(renderRail);
  onStoatStateChange(() => updateLoginGate());
  onStoatMessageCreate(onStoatMessageCreated);
  onStoatMessageUpdate(onStoatMessageUpdated);
  onStoatMessageDelete(onStoatMessageDeleted);
  onStoatMessageReaction((messageId, emoji, userId, added) => {
    if (activeChatPlatform !== "stoat") return;
    applyLiveStoatReaction(document.getElementById("messages")!, messageId, emoji, userId, added);
  });
  onStoatTyping(onStoatTypingEvent);
}

/** channelId -> userId -> auto-expiry timer (in case a real EndTyping is missed — the same defensive-timeout shape Discord's own client uses for its typing indicator). */
const stoatTypingByChannel = new Map<string, Map<string, ReturnType<typeof setTimeout>>>();
const TYPING_EXPIRE_MS = 6000;

function onStoatTypingEvent(channelId: string, userId: string, started: boolean): void {
  if (userId === getSelfStoatUserId()) return; // never show your own typing back at yourself
  let users = stoatTypingByChannel.get(channelId);
  if (!users) {
    users = new Map();
    stoatTypingByChannel.set(channelId, users);
  }
  const existing = users.get(userId);
  if (existing) clearTimeout(existing);
  if (started) {
    users.set(
      userId,
      setTimeout(() => {
        users!.delete(userId);
        renderStoatTypingIndicator(channelId);
      }, TYPING_EXPIRE_MS)
    );
  } else {
    users.delete(userId);
  }
  renderStoatTypingIndicator(channelId);
}

function renderStoatTypingIndicator(channelId: string): void {
  const indicator = document.getElementById("typing-indicator")!;
  if (activeChatPlatform !== "stoat" || channelId !== activeChannelId) return;
  const users = stoatTypingByChannel.get(channelId);
  const names = [...(users?.keys() ?? [])].map(id => getStoatUser(id)?.displayName || getStoatUser(id)?.username || "Someone");
  if (names.length === 0) {
    indicator.textContent = "";
    return;
  }
  indicator.textContent =
    names.length === 1
      ? t("typing.one", { name: names[0]! })
      : names.length === 2
        ? t("typing.two", { a: names[0]!, b: names[1]! })
        : t("typing.many", { count: names.length });
}

/** Stoat's half of onMessageCreate() — live messages weren't shown at all before this; the chat pane only ever updated by reselecting the channel. */
function onStoatMessageCreated(msg: StoatMessageSummary): void {
  if (activeChatPlatform !== "stoat" || msg.channelId !== activeChannelId) return;
  const container = document.getElementById("messages")!;
  const atBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 80;
  container.append(stoatMessageRow(msg, lastRenderedMessageMeta(container)));
  if (atBottom) container.scrollTop = container.scrollHeight;
}

function onStoatMessageUpdated(messageId: string, patch: { content?: string; edited?: boolean }): void {
  if (activeChatPlatform !== "stoat") return;
  const row = document.querySelector<HTMLElement>(`#messages .msg[data-message="${messageId}"]`);
  if (!row) return;
  if (patch.content !== undefined) {
    const content = row.querySelector<HTMLElement>(".msg-content");
    if (content) {
      content.textContent = patch.content;
      applyTwemoji(content);
    }
  }
  if (patch.edited && !row.querySelector(".msg-edited")) {
    row.querySelector(".msg-meta")?.append(el("span", { className: "msg-edited" }, t("message.edited")));
  }
}

function onStoatMessageDeleted(messageId: string): void {
  document.querySelector<HTMLElement>(`#messages .msg[data-message="${messageId}"]`)?.remove();
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
    if (activeChatPlatform === "stoat") {
      if (!activeChannelId) return;
      const channelId = activeChannelId;
      // Stoat's real search endpoint (see rest.ts's searchMessages) is
      // scoped to one channel, not guild-wide like Discord's — every hit
      // is already in the channel that's currently open, so "jump" is a
      // no-op beyond just closing the panel.
      openMessageSearch(
        button,
        async query => ({
          indexing: false,
          hits: (await searchStoatMessages(channelId, query)).map(m => ({ id: m.id, channelId: m.channelId, content: m.content, authorName: m.authorName }))
        }),
        () => document.getElementById("chat-header")?.textContent ?? channelId,
        () => {}
      );
      return;
    }
    const guildId = activeGuildId;
    const channelId = activeChannelId;
    openMessageSearch(
      button,
      async query => {
        const result = await window.hyaecord.searchMessages(query, guildId, guildId ? null : channelId);
        return { indexing: result.indexing, hits: result.messages };
      },
      resolveChannelName,
      jumpChannelId => jumpToChannel(guildId, jumpChannelId)
    );
  });

  const pinsButton = document.getElementById("pins-button") as HTMLButtonElement;
  pinsButton.addEventListener("click", () => {
    if (!activeChannelId) return;
    const channelId = activeChannelId;
    if (activeChatPlatform === "stoat") {
      openPinsPanel(pinsButton, {
        listPins: async () =>
          (await fetchStoatPins(channelId)).map(m => ({
            id: m.id,
            channelId: m.channelId,
            authorName: m.authorName,
            authorId: m.authorId,
            avatar: m.avatar,
            content: m.content,
            timestamp: m.timestamp ? new Date(m.timestamp).toISOString() : "",
            pinnedAt: m.timestamp ? new Date(m.timestamp).toISOString() : ""
          })),
        unpin: messageId => unpinStoatMessage(channelId, messageId),
        canUnpin: true
      });
      return;
    }
    openPinsPanel(pinsButton, {
      listPins: () => window.hyaecord.listMessagePins(channelId),
      unpin: messageId => window.hyaecord.unpinMessage(channelId, messageId),
      canUnpin: canManageMessagesIn(channelId)
    });
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

/**
 * The composer bar itself is always visible now — the actual root cause of
 * "it only shows up in channels you can't talk in or DMs" was a CSS
 * flex/scroll bug (see `.messages`'s `min-height: 0` fix), not any
 * show/hide logic; there wasn't any before this. What genuinely should
 * differ per channel is whether typing is *allowed* — this disables the
 * real input and swaps its placeholder for an explanation, matching
 * Discord's own read-only-channel composer, instead of letting someone
 * type a message that would just fail to send.
 */
function setComposerReadOnly(readOnly: boolean, placeholder: string): void {
  const input = document.getElementById("composer-input") as HTMLInputElement;
  input.disabled = readOnly;
  input.placeholder = readOnly ? t("composer.readOnly") : placeholder;
  input.classList.toggle("is-read-only", readOnly);
  // The GIF/sticker/emoji buttons each send independently of the text
  // input (a click sends immediately, no Enter/typing involved) — disabling
  // just the input wouldn't stop those from still firing a real send in a
  // channel with no SEND_MESSAGES permission.
  for (const id of ["gif-picker-button", "sticker-picker-button", "emoji-picker-button", "silent-toggle-button"]) {
    (document.getElementById(id) as HTMLButtonElement | null)?.toggleAttribute("disabled", readOnly);
  }
}

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
    if (activeChatPlatform === "stoat" && activeChannelId && input.value.trim()) {
      notifyStoatTyping(activeChannelId);
    }
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

    if (activeChatPlatform === "stoat") {
      const content = input.value;
      input.value = "";
      const ok = await sendStoatMessage(activeChannelId, content);
      if (!ok) input.value = content;
      return;
    }

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

  const stickerButton = document.getElementById("sticker-picker-button") as HTMLButtonElement;
  stickerButton.addEventListener("click", () => {
    openStickerPicker(stickerButton, id => {
      if (!activeChannelId) return;
      void window.hyaecord.sendSticker(activeChannelId, id);
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

  discordReady = session.state === "ready";
  updateLoginGate();
  if (session.state === "ready") {
    if (session.freshLogin && !freshLoginNoticeShown) {
      freshLoginNoticeShown = true;
      showFreshLoginNotice();
    }
  }
}

let discordReady = false;

/**
 * The login overlay blocks the whole UI, so it should only show when
 * *neither* platform is connected — logging into Stoat alone (with
 * Discord still logged out) is a real, complete state now, not "half
 * logged in". Both Discord's applySession() and the Stoat state listener
 * (see initSession()) call this on every change.
 */
function updateLoginGate(): void {
  if (discordReady || isStoatReady()) {
    hideLogin();
  } else {
    showLogin();
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
      icon?: string | null;
      recipients?: Array<{ id?: string; global_name?: string | null; username?: string; avatar?: string | null }>;
    };
    const names = (d.recipients ?? []).map(r => r.global_name ?? r.username ?? "?").join(", ");
    // Group DMs (type 3) can have their own icon; a 1-1 DM (type 1) shows
    // the other recipient's own avatar as its icon — same convention
    // Discord's real client uses, and the same one applied to Stoat's DM
    // list below (fetchStoatDMs).
    const groupIcon = d.type === 3 && d.icon ? `https://cdn.discordapp.com/channel-icons/${d.id}/${d.icon}.png?size=64` : null;
    const recipient = d.recipients?.[0];
    const recipientAvatar = recipient?.id && recipient.avatar ? `https://cdn.discordapp.com/avatars/${recipient.id}/${recipient.avatar}.png?size=64` : null;
    return { id: d.id, type: d.type ?? 1, name: names || "?", avatar: groupIcon ?? recipientAvatar };
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
  if (state.settings.mergeSidebar) {
    pill.append(el("span", { className: "platform-badge platform-badge-discord", "aria-hidden": "true" }, "D"));
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
  // Pills live in the scrollable #server-pills region, not #server-rail
  // itself — the settings button is a fixed footer outside that scroll
  // area (see styles.css) specifically so it can't get scrolled out of
  // view once enough servers push the pill list past the window's
  // height, which is what was happening before this split.
  const rail = document.getElementById("server-pills")!;
  rail.querySelectorAll(".server-pill, .dm-pill, .friends-pill, .server-folder").forEach(pill => pill.remove());

  const dmPill = el(
    "button",
    {
      className: "server-pill dm-pill",
      type: "button",
      title: t("shell.directMessages"),
      "aria-label": t("shell.directMessages"),
      onClick: selectDms
    },
    icon("message-circle")
  );
  rail.append(dmPill);

  const friendsPill = el(
    "button",
    {
      className: "server-pill friends-pill",
      type: "button",
      title: t("shell.friends"),
      "aria-label": t("shell.friends"),
      onClick: () => openFriendsList()
    },
    icon("users")
  );
  rail.append(friendsPill);

  const showDiscord = state.settings.mergeSidebar || state.settings.activeSidebarPlatform === "discord";
  const showStoat = state.settings.mergeSidebar || state.settings.activeSidebarPlatform === "stoat";

  if (showDiscord) {
    const renderedFolders = new Set<string>();
    for (const guild of guilds) {
      if (isChomperHidden(guild.id)) continue;
      const folder = folderOf(guild.id);
      if (folder) {
        if (renderedFolders.has(folder.id)) continue;
        renderedFolders.add(folder.id);
        rail.append(buildFolderElement(folder));
        continue;
      }
      rail.append(buildGuildPill(guild, null));
    }
  }

  if (showStoat) {
    for (const guild of getStoatGuilds()) {
      rail.append(buildStoatGuildPill(guild));
    }
  }
}

/** Same visual shape as buildGuildPill, tagged with a small platform badge in the corner (only shown when both platforms are merged into one rail — redundant, and thus omitted, in single-platform mode). */
function buildStoatGuildPill(guild: { id: string; name: string; icon: string | null }): HTMLElement {
  const pill = el("button", {
    className: "server-pill",
    type: "button",
    title: guild.name,
    "aria-label": guild.name,
    "data-stoat-guild": guild.id,
    onClick: () => selectStoatGuildUI(guild.id)
  });
  if (guild.icon) {
    pill.append(el("img", { src: guild.icon, alt: "", loading: "lazy" }));
  } else {
    pill.textContent = guild.name
      .split(/\s+/)
      .map(w => w[0] ?? "")
      .join("")
      .slice(0, 3);
  }
  if (state.settings.mergeSidebar) {
    pill.append(el("span", { className: "platform-badge platform-badge-stoat", "aria-hidden": "true" }, "S"));
  }
  return pill;
}

function markActivePill(guildId: string | null): void {
  document.querySelectorAll<HTMLElement>(".server-pill").forEach(pill => {
    const isDm = pill.classList.contains("dm-pill");
    pill.setAttribute("aria-current", isDm ? String(guildId === null) : String(pill.dataset.guild === guildId));
  });
}

/** Same small-avatar-in-list convention Discord's own DM list uses; a plain `#`/hash icon would be wrong here since a DM isn't a channel with a name, it's a person (or group). */
function dmRowAvatar(name: string, avatar: string | null): HTMLElement {
  return avatar
    ? el("img", { className: "dm-row-avatar", src: avatar, alt: "", loading: "lazy" })
    : el("span", { className: "dm-row-avatar dm-row-avatar-fallback", "aria-hidden": "true" }, name[0] ?? "?");
}

function renderStoatDmRow(list: HTMLElement, dm: StoatDmSummary): void {
  const li = el("li", { tabindex: "0", "data-channel": dm.id, className: "platform-row-stoat" }, dmRowAvatar(dm.name, dm.icon), dm.name);
  const select = () => {
    list.querySelectorAll("li").forEach(item => item.removeAttribute("aria-current"));
    li.setAttribute("aria-current", "true");
    void loadStoatMessages(null, dm.id, dm.name);
  };
  li.addEventListener("click", select);
  li.addEventListener("keydown", ev => {
    if ((ev as KeyboardEvent).key === "Enter") select();
  });
  list.append(li);
}

function selectDms(): void {
  activeGuildId = null;
  markActivePill(null);
  applyServerHeaderBanner(t("shell.directMessages"), null);
  clearMemberList();

  const list = document.getElementById("channels")!;
  list.replaceChildren();
  for (const dm of dms) {
    if (isChomperHidden(dm.id)) continue;
    const li = el(
      "li",
      {
        tabindex: "0",
        "data-channel": dm.id,
        className: isChomperTracked(dm.id) ? "chomper-restored" : ""
      },
      dmRowAvatar(dm.name, dm.avatar),
      dm.name
    );
    const select = () => {
      if (li.dataset.suppressClick) {
        delete li.dataset.suppressClick;
        return;
      }
      list.querySelectorAll("li").forEach(item => item.removeAttribute("aria-current"));
      li.setAttribute("aria-current", "true");
      document.getElementById("chat-header")!.textContent = dm.name;
      setComposerReadOnly(false, t("shell.chat.placeholder").replace("#general", dm.name)); // DMs have no permission model to gate on
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

  // Stoat's DMs render in the same list, tagged with a platform-row class
  // (small left accent bar via CSS) rather than a separate section — this
  // list is already how the merged-sidebar rail treats mixed platforms.
  for (const dm of stoatDms) renderStoatDmRow(list, dm);
  if (isStoatReady()) {
    void fetchStoatDMs().then(fetched => {
      stoatDms = fetched;
      if (activeGuildId === null) {
        list.querySelectorAll("li.platform-row-stoat").forEach(row => row.remove());
        for (const dm of stoatDms) renderStoatDmRow(list, dm);
      }
    });
  }
}

/**
 * Renders a guild's real banner as a backdrop behind its name in the
 * channel-list header — Discord's own client shows this same image as a
 * thin, heavily-cropped sliver; this gives it real visual room instead
 * (see BUILD_PROMPT.md's "server banner rendering" item). CSS `cover` +
 * a fixed-height strip is deliberate: neither Discord nor Stoat publish a
 * banner aspect ratio anywhere, so `cover` sidesteps needing that fact at
 * all rather than guessing at it. `bannerUrl` must already be a complete,
 * usable URL — Discord's is a hash the caller builds into a CDN URL first
 * (see selectGuild), Stoat's arrives from stoat-session.ts already fully
 * resolved, so this function itself stays platform-agnostic.
 */
function applyServerHeaderBanner(name: string, bannerUrl: string | null): void {
  const header = document.getElementById("server-header")!;
  header.textContent = name;
  if (bannerUrl) {
    header.classList.add("has-banner");
    header.style.backgroundImage = `linear-gradient(rgba(0,0,0,0.35), rgba(0,0,0,0.55)), url(${bannerUrl})`;
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
  applyServerHeaderBanner(guild.name, guild.banner ? `https://cdn.discordapp.com/banners/${guild.id}/${guild.banner}.png?size=512` : null);
  setActiveGuildRoles(guild.roles);

  const list = document.getElementById("channels")!;
  list.replaceChildren();
  const channels = guild.channels
    .filter(ch => TEXT_CHANNEL_TYPES.has(ch.type))
    .sort((a, b) => a.position - b.position);
  for (const channel of channels) {
    const li = el("li", { tabindex: "0", "data-channel": channel.id }, icon("hash", "channel-icon"), channel.name);
    const select = () => {
      list.querySelectorAll("li").forEach(item => item.removeAttribute("aria-current"));
      li.setAttribute("aria-current", "true");
      document.getElementById("chat-header")!.textContent = `# ${channel.name}`;
      setComposerReadOnly(
        !hasPermission(channel.permissions, Permission.SEND_MESSAGES),
        t("shell.chat.placeholder").replace("#general", `#${channel.name}`)
      );
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

  const voiceChannels = guild.channels.filter(ch => ch.type === VOICE_CHANNEL_TYPE).sort((a, b) => a.position - b.position);
  for (const channel of voiceChannels) {
    const li = el(
      "li",
      { className: "voice-channel-item", tabindex: "0", "data-voice-channel": channel.id },
      icon("volume-2", "channel-icon"),
      channel.name
    );
    li.addEventListener("click", () => window.hyaecord.joinVoiceChannel(id, channel.id));
    li.addEventListener("keydown", ev => {
      if ((ev as KeyboardEvent).key === "Enter") window.hyaecord.joinVoiceChannel(id, channel.id);
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

/** Same window stoat-session.ts's stoatMessageRow uses for message grouping — kept as a separate constant rather than importing theirs since these two message pipelines are deliberately not sharing code (see this file's platform-split comments throughout). */
const GROUP_WINDOW_MS = 7 * 60 * 1000;

function messageRow(msg: MessageSummary, previous: { authorId: string; timestamp: number } | null = null): HTMLElement {
  if (msg.type === MESSAGE_TYPE_PIN_NOTICE) return pinNoticeRow(msg);

  const msgTimestampMs = msg.timestamp ? new Date(msg.timestamp).getTime() : 0;
  const grouped = !!previous && previous.authorId === msg.authorId && msgTimestampMs !== 0 && msgTimestampMs - previous.timestamp < GROUP_WINDOW_MS;

  const time = msg.timestamp
    ? new Date(msg.timestamp).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })
    : "";

  let avatar: HTMLElement;
  if (grouped) {
    avatar = el("time", { className: "msg-hover-time" }, time);
  } else {
    // A UserPFP override, if the user has one and the integration is on,
    // takes priority over their real Discord avatar — same behaviour as
    // the real UserPFP plugin.
    const pfpOverride = getPfpOverride(msg.authorId);
    const avatarSrc = pfpOverride ?? (msg.avatar ? `https://cdn.discordapp.com/avatars/${msg.authorId}/${msg.avatar}.png?size=64` : null);
    avatar = avatarSrc
      ? el("img", { className: "msg-avatar", src: avatarSrc, alt: "", loading: "lazy" })
      : el("span", { className: "msg-avatar msg-avatar-fallback", "aria-hidden": "true" }, msg.authorName[0] ?? "?");
    avatar.classList.add("clickable-profile");
    avatar.addEventListener("click", () => openProfilePopout(msg.authorId, avatar));
  }

  // textContent path only — message content must never become HTML.
  // applyTwemoji() operates on the resulting text nodes, not the raw
  // string, so it can't reintroduce that risk (see twemoji.ts).
  const content = el("p", { className: "msg-content" }, msg.content);
  applyTwemoji(content);

  const bodyChildren: HTMLElement[] = [];
  if (!grouped) {
    const authorName = el("span", { className: "msg-author clickable-profile" }, msg.authorName);
    authorName.addEventListener("click", () => openProfilePopout(msg.authorId, authorName));
    bodyChildren.push(el("header", { className: "msg-meta" }, authorName, el("time", { className: "msg-time" }, time)));
  }
  bodyChildren.push(content);

  const row = el(
    "article",
    {
      className: grouped ? "msg msg-grouped" : "msg",
      "data-message": msg.id,
      "data-author": msg.authorId,
      "data-timestamp": String(msgTimestampMs)
    },
    avatar,
    el("div", { className: "msg-body" }, ...bodyChildren)
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
  activeChatPlatform = "discord";
  document.getElementById("typing-indicator")!.textContent = "";
  const container = document.getElementById("messages")!;
  container.replaceChildren();
  const raw = await window.hyaecord.fetchMessages(channelId);
  if (channelId !== activeChannelId || activeChatPlatform !== "discord") return; // user moved on while we fetched
  for (const entry of raw) {
    const msg = toSummary(entry);
    if (msg) container.append(messageRow(msg, lastRenderedMessageMeta(container)));
  }
  container.scrollTop = container.scrollHeight;
}

/** Stoat's half of loadMessages() — deliberately separate rather than a shared generic function, since the two platforms' message shapes and rendering (stoatMessageRow vs messageRow) don't overlap. `guildId` is null for a Stoat DM (no server context). */
async function loadStoatMessages(guildId: string | null, channelId: string, channelName: string): Promise<void> {
  activeGuildId = guildId;
  activeChannelId = channelId;
  activeChatPlatform = "stoat";
  document.getElementById("chat-header")!.textContent = `# ${channelName}`;
  document.getElementById("typing-indicator")!.textContent = "";
  // Stoat channels do have a real permission model (default_permissions /
  // role_permissions on TextChannel), but this app doesn't compute
  // effective per-channel permissions for Stoat yet the way it does for
  // Discord (permissions.ts) — always-enabled here is a real, stated scope
  // cut, not a guess at Stoat's permission bits.
  setComposerReadOnly(false, t("shell.chat.placeholder").replace("#general", `#${channelName}`));
  const container = document.getElementById("messages")!;
  container.replaceChildren();
  const messages = await selectStoatChannel(channelId);
  if (channelId !== activeChannelId || activeChatPlatform !== "stoat") return;
  for (const msg of messages) container.append(stoatMessageRow(msg, lastRenderedMessageMeta(container)));
  container.scrollTop = container.scrollHeight;
}

/** Same leading-glyph convention Discord's own channel list uses (see buildChannelRow) — a real `hash`/`volume-2` SVG icon, not a `#`/🔊 character, so both platforms read identically at a glance. */
function stoatChannelRow(channel: StoatChannelSummary): HTMLElement {
  return el(
    "li",
    { tabindex: "0", "data-channel": channel.id, className: channel.hasVoice ? "voice-channel-item" : "" },
    icon(channel.hasVoice ? "volume-2" : "hash", "channel-icon"),
    channel.name
  );
}

function selectStoatGuildUI(id: string): void {
  const guild = selectStoatGuild(id);
  if (!guild) return;
  markActivePill(null);
  document.querySelectorAll<HTMLElement>(`.server-pill[data-stoat-guild="${id}"]`).forEach(p => p.setAttribute("aria-current", "true"));
  applyServerHeaderBanner(guild.name, guild.banner);
  renderStoatMembers(getStoatMembers(id));
  // Ready's own payload never carries a server's full member list (only
  // ever the current user's own membership) — this is the real fetch
  // (GET /servers/{id}/members) that was missing before, re-rendering
  // once it resolves so the panel doesn't stay stuck on stale/self-only
  // data if the server was already cached from a previous visit.
  void fetchStoatMembers(id).then(members => {
    if (activeGuildId === id) renderStoatMembers(members);
  });

  const list = document.getElementById("channels")!;
  list.replaceChildren();
  try {
    for (const channel of guild.channels) {
      // Stoat has no separate voice-channel type — voice capability is
      // just a nullable field on an ordinary text channel (its `voice`
      // property), so a voice-capable channel is still a real text
      // channel to click into, just visually flagged (voice-channel-item,
      // same class Discord's dedicated voice channels use) rather than
      // routed to a join action Stoat's LiveKit voice isn't wired up for
      // yet.
      const li = stoatChannelRow(channel);
      const select = () => {
        list.querySelectorAll("li").forEach(item => item.removeAttribute("aria-current"));
        li.setAttribute("aria-current", "true");
        void loadStoatMessages(id, channel.id, channel.name);
      };
      li.addEventListener("click", select);
      li.addEventListener("keydown", ev => {
        if ((ev as KeyboardEvent).key === "Enter") select();
      });
      list.append(li);
    }
  } catch (err) {
    // A render exception here must not silently take the composer or
    // settings button down with it — they're separate, already-mounted
    // DOM elements untouched by this function, but surfacing the error
    // rather than swallowing it is what actually helps track down a
    // "some things just don't show up" report like this one.
    console.error("Failed to render Stoat channel list", err);
  }
}

function onMessageCreate(data: unknown): void {
  const msg = toSummary(data);
  if (!msg || msg.channelId !== activeChannelId) return;
  const container = document.getElementById("messages")!;
  const atBottom =
    container.scrollHeight - container.scrollTop - container.clientHeight < 80;
  container.append(messageRow(msg, lastRenderedMessageMeta(container)));
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
 * Login is browser-only by design for both platforms: each button opens
 * that platform's own real login page in an embedded window rather than
 * any form of ours, so there's nothing here that could be mistaken for a
 * phishing-shaped credential prompt and nothing asking a user to trust
 * this app with a pasted token. See browser-login.ts / loginWithBrowser()
 * (Discord) and stoat-session.ts / loginStoat() (Stoat).
 *
 * Shown whenever *neither* platform is connected (see updateLoginGate())
 * — a real platform choice, not a Discord screen with Stoat bolted on
 * somewhere else. Logging into either one dismisses this; the other
 * platform stays connectable later from Settings → Accounts.
 */
function showLogin(): void {
  if (loginOverlay) return;

  const discordError = el("p", { className: "login-error", role: "alert" });
  const discordButton = el(
    "button",
    {
      className: "btn primary login-big-btn",
      type: "button",
      onClick: async () => {
        discordError.textContent = "";
        discordButton.setAttribute("disabled", "");
        const result = await window.hyaecord.discordLoginBrowser();
        discordButton.removeAttribute("disabled");
        if (!result.ok && result.error !== "cancelled") {
          discordError.textContent = t(`login.error.${result.error}`);
        } else if (result.ok && result.persisted === false) {
          showToast(t("login.sessionOnly"));
        }
      }
    },
    t("login.withBrowser")
  ) as HTMLButtonElement;

  const stoatError = el("p", { className: "login-error", role: "alert" });
  const stoatButton = el(
    "button",
    {
      className: "btn login-big-btn",
      type: "button",
      onClick: async () => {
        stoatError.textContent = "";
        stoatButton.setAttribute("disabled", "");
        const result = await loginStoat();
        stoatButton.removeAttribute("disabled");
        if (!result.ok && result.error !== "cancelled") {
          // Was showing the raw error code ("invalid-token", "network") as
          // literal user-facing text instead of a translated message —
          // Discord's own button (below) already used the real t() lookup;
          // Stoat's just never matched it. Same real error codes on both
          // (see main/stoat/index.ts's completeLogin), so the same keys apply.
          stoatError.textContent = t(`login.error.${result.error}`);
        }
      }
    },
    t("login.withStoat")
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
    el("div", { className: "login-platform-row" }, discordButton, stoatButton),
    discordError,
    stoatError
  );
  const dialog = el(
    "div",
    { className: "modal login", role: "dialog", "aria-modal": "true", "aria-labelledby": "login-title" },
    el("h1", { id: "login-title" }, t("login.title")),
    body
  );
  loginOverlay = el("div", { className: "overlay" }, dialog);
  document.body.append(loginOverlay);
  discordButton.focus();
}

function hideLogin(): void {
  loginOverlay?.remove();
  loginOverlay = null;
}
