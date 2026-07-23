import type { DiscordSession, MfaMethod } from "@shared/types";
import { el, mountRotatingText, patchSettings, showToast, state, t } from "./ui";
import { computeChannelPermissions, hasPermission, Permission } from "./permissions";
import { openProfilePopout } from "./profile-popout";
import { openGifPicker } from "./gif-picker";

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
  channels: ChannelSummary[];
  /** True if the user can manage channels in *any* channel of this guild — gates Moderator View. */
  canManageChannels: boolean;
}

interface DmSummary {
  id: string;
  /** Comma-joined recipient names; "?" for a DM with no recipients (shouldn't happen). */
  name: string;
  type: number;
}

interface MessageSummary {
  id: string;
  channelId: string;
  authorName: string;
  authorId: string;
  avatar: string | null;
  content: string;
  timestamp: string;
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
  });
  void window.hyaecord.getDiscordSession().then(applySession);
  wireComposer();
  wireChannelProximity();
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

function wireComposer(): void {
  const input = document.getElementById("composer-input") as HTMLInputElement;
  input.addEventListener("keydown", async ev => {
    if (ev.key !== "Enter" || !activeChannelId || !input.value.trim()) return;
    const content = input.value;
    input.value = "";
    const ok = await window.hyaecord.sendMessage(activeChannelId, content);
    if (!ok) {
      input.value = content; // don't lose what they typed
    }
  });

  const gifButton = document.getElementById("gif-picker-button") as HTMLButtonElement;
  gifButton.addEventListener("click", () => {
    openGifPicker(gifButton, url => {
      if (!activeChannelId) return;
      void window.hyaecord.sendMessage(activeChannelId, url);
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

function onReady(data: unknown): void {
  const payload = data as {
    user?: { id?: string };
    guilds?: unknown[];
    private_channels?: unknown[];
  };
  selfUserId = payload.user?.id ?? selfUserId;

  const raw = payload.guilds ?? [];
  guilds = raw.map(entry => {
    const g = entry as {
      id: string;
      name?: string;
      icon?: string | null;
      properties?: { name?: string; icon?: string | null };
      channels?: Array<{
        id: string;
        name?: string;
        type?: number;
        position?: number;
        permission_overwrites?: Array<{ id?: string; type?: number; allow?: string; deny?: string }>;
      }>;
    };
    const channels: ChannelSummary[] = (g.channels ?? []).map(ch => ({
      id: ch.id,
      name: ch.name ?? "?",
      type: ch.type ?? 0,
      position: ch.position ?? 0,
      permissions: selfUserId ? computeChannelPermissions(g, ch, selfUserId) : 0n
    }));
    return {
      id: g.id,
      name: g.properties?.name ?? g.name ?? "?",
      icon: g.properties?.icon ?? g.icon ?? null,
      channels,
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
  rail.querySelectorAll(".server-pill, .dm-pill, .server-folder").forEach(pill => pill.remove());
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
  document.getElementById("server-header")!.textContent = t("shell.directMessages");

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
    list.append(li);
  }
}

function selectGuild(id: string): void {
  const guild = guilds.find(g => g.id === id);
  if (!guild) return;

  activeGuildId = id;
  markActivePill(id);
  document.getElementById("server-header")!.textContent = guild.name;

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
    };
    li.addEventListener("click", select);
    li.addEventListener("keydown", ev => {
      if ((ev as KeyboardEvent).key === "Enter") select();
    });
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
    timestamp: m.timestamp ?? ""
  };
}

function messageRow(msg: MessageSummary): HTMLElement {
  const avatar = msg.avatar
    ? el("img", {
        className: "msg-avatar",
        src: `https://cdn.discordapp.com/avatars/${msg.authorId}/${msg.avatar}.png?size=64`,
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
  return el(
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

type LoginScreen = "welcome" | "credentials" | "mfa" | "token";

function showLogin(): void {
  if (loginOverlay) return;

  let screen: LoginScreen = "welcome";
  let mfaTicket = "";
  let mfaMethods: MfaMethod[] = [];

  const body = el("div", { className: "login-body" });
  const dialog = el(
    "div",
    { className: "modal login", role: "dialog", "aria-modal": "true", "aria-labelledby": "login-title" },
    el("h1", { id: "login-title" }, t("login.title")),
    body
  );
  loginOverlay = el("div", { className: "overlay" }, dialog);
  document.body.append(loginOverlay);

  function goTo(next: LoginScreen, ticket = "", methods: MfaMethod[] = []): void {
    screen = next;
    if (ticket) mfaTicket = ticket;
    if (methods.length) mfaMethods = methods;
    render();
  }

  function render(): void {
    body.replaceChildren();
    if (screen === "welcome") body.append(welcomeScreen(goTo));
    else if (screen === "credentials") body.append(credentialsScreen(goTo));
    else if (screen === "mfa") body.append(mfaScreen(mfaTicket, mfaMethods, goTo));
    else body.append(tokenScreen(goTo));
    body.querySelector("input")?.focus();
  }

  render();
}

type GoTo = (screen: LoginScreen, ticket?: string, methods?: MfaMethod[]) => void;

function welcomeScreen(goTo: GoTo): HTMLElement {
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
        }
      }
    },
    t("login.withBrowser")
  );

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

  return el(
    "div",
    {},
    el("p", { className: "modal-subtitle" }, t("login.welcomeBody")),
    vpnNotice,
    browserButton,
    browserError,
    el("p", { className: "login-switch" },
      el("button", { className: "link-button", type: "button", onClick: () => goTo("credentials") }, t("login.useCredentials")),
      " · ",
      el("button", { className: "link-button", type: "button", onClick: () => goTo("token") }, t("login.useToken"))
    )
  );
}

function credentialsScreen(goTo: GoTo): HTMLElement {
  const emailInput = el("input", {
    type: "text",
    id: "login-email",
    className: "login-input",
    autocomplete: "username",
    placeholder: t("login.emailPlaceholder")
  }) as HTMLInputElement;
  const passwordInput = el("input", {
    type: "password",
    id: "login-password",
    className: "login-input",
    autocomplete: "current-password"
  }) as HTMLInputElement;
  const error = el("p", { className: "login-error", role: "alert" });
  const button = el("button", { className: "btn primary", type: "submit" }, t("login.connect"));

  const form = el(
    "form",
    { className: "login-form" },
    el("label", { for: "login-email", className: "row-label" }, t("login.emailLabel")),
    emailInput,
    el("label", { for: "login-password", className: "row-label" }, t("login.passwordLabel")),
    passwordInput,
    error,
    el("div", { className: "modal-actions" }, button)
  ) as HTMLFormElement;

  form.addEventListener("submit", async ev => {
    ev.preventDefault();
    error.textContent = "";
    button.setAttribute("disabled", "");
    const result = await window.hyaecord.discordLoginCredentials(emailInput.value, passwordInput.value);
    button.removeAttribute("disabled");
    if (result.ok) return;
    if (result.mfaRequired) {
      goTo("mfa", result.ticket, result.methods);
      return;
    }
    error.textContent = t(`login.error.${result.error}`);
    passwordInput.focus();
  });

  return el(
    "div",
    {},
    el("p", { className: "modal-subtitle" }, t("login.body")),
    form,
    el("p", { className: "login-switch" },
      el("button", { className: "link-button", type: "button", onClick: () => goTo("welcome") }, t("login.back")),
      " · ",
      el("button", { className: "link-button", type: "button", onClick: () => goTo("token") }, t("login.useToken"))
    )
  );
}

const MFA_METHOD_LABEL: Record<MfaMethod, string> = {
  totp: "login.mfaMethod.totp",
  sms: "login.mfaMethod.sms",
  backup: "login.mfaMethod.backup"
};

/**
 * All three account MFA methods Discord supports at login share this one
 * screen. SMS needs an extra step first (request the code be sent) before
 * the same code input applies; the picker only appears when the account
 * actually has more than one method available.
 */
function mfaScreen(ticket: string, methods: MfaMethod[], goTo: GoTo): HTMLElement {
  const container = el("div", {});
  let method: MfaMethod = methods.includes("totp") ? "totp" : (methods[0] ?? "totp");
  let smsSent = false;

  function renderBody(): void {
    container.replaceChildren();

    const codeInput = el("input", {
      type: "text",
      id: "login-mfa-code",
      className: "login-input",
      inputmode: method === "backup" ? "text" : "numeric",
      autocomplete: "one-time-code",
      placeholder: t(method === "backup" ? "login.backupPlaceholder" : "login.mfaPlaceholder")
    }) as HTMLInputElement;
    const error = el("p", { className: "login-error", role: "alert" });
    const button = el(
      "button",
      { className: "btn primary", type: "submit" },
      t("login.verify")
    ) as HTMLButtonElement;

    const form = el(
      "form",
      { className: "login-form" },
      el("label", { for: "login-mfa-code", className: "row-label" }, t("login.mfaLabel")),
      codeInput,
      error,
      el("div", { className: "modal-actions" }, button)
    ) as HTMLFormElement;

    form.addEventListener("submit", async ev => {
      ev.preventDefault();
      error.textContent = "";
      button.setAttribute("disabled", "");
      const result = await window.hyaecord.discordSubmitMfa(method, codeInput.value, ticket);
      button.removeAttribute("disabled");
      if (result.ok) return;
      error.textContent = t(`login.error.${result.mfaRequired ? "mfa-unsupported" : result.error}`);
      codeInput.focus();
    });

    const parts: (Node | string)[] = [el("p", { className: "modal-subtitle" }, t("login.mfaBody"))];

    if (methods.length > 1) {
      parts.push(
        el(
          "div",
          { className: "login-method-switch" },
          ...methods.map(m =>
            el(
              "button",
              {
                type: "button",
                className: `link-button${m === method ? " is-active" : ""}`,
                onClick: () => {
                  method = m;
                  smsSent = false;
                  renderBody();
                }
              },
              t(MFA_METHOD_LABEL[m])
            )
          )
        )
      );
    }

    if (method === "sms" && !smsSent) {
      const smsError = el("p", { className: "login-error", role: "alert" });
      const sendButton = el(
        "button",
        {
          className: "btn primary",
          type: "button",
          onClick: async () => {
            smsError.textContent = "";
            sendButton.setAttribute("disabled", "");
            const res = await window.hyaecord.discordRequestMfaSms(ticket);
            sendButton.removeAttribute("disabled");
            if (!res.ok) {
              smsError.textContent = t("login.error.network");
              return;
            }
            smsSent = true;
            renderBody();
          }
        },
        t("login.sendSmsCode")
      );
      parts.push(el("p", {}, t("login.smsBody")), sendButton, smsError);
    } else {
      if (method === "sms") parts.push(el("p", { className: "row-description" }, t("login.smsSent")));
      parts.push(form);
    }

    parts.push(
      el("p", { className: "login-switch" },
        el("button", { className: "link-button", type: "button", onClick: () => goTo("credentials") }, t("login.back"))
      )
    );

    container.append(...parts);
    container.querySelector("input")?.focus();
  }

  renderBody();
  return container;
}

function tokenScreen(goTo: (screen: LoginScreen) => void): HTMLElement {
  const input = el("input", {
    type: "password",
    id: "login-token",
    className: "login-input",
    autocomplete: "off",
    spellcheck: "false"
  }) as HTMLInputElement;
  const error = el("p", { className: "login-error", role: "alert" });
  const note = el("p", { className: "step-hint" });
  const button = el("button", { className: "btn primary", type: "submit" }, t("login.connect"));

  const form = el(
    "form",
    { className: "login-form" },
    el("label", { for: "login-token", className: "row-label" }, t("login.tokenLabel")),
    input,
    error,
    note,
    el("div", { className: "modal-actions" }, button)
  ) as HTMLFormElement;

  form.addEventListener("submit", async ev => {
    ev.preventDefault();
    error.textContent = "";
    button.setAttribute("disabled", "");
    const result = await window.hyaecord.discordLogin(input.value);
    button.removeAttribute("disabled");
    if (!result.ok) {
      error.textContent = t(`login.error.${result.error ?? "network"}`);
      input.focus();
      return;
    }
    if (result.persisted === false) note.textContent = t("login.sessionOnly");
  });

  return el(
    "div",
    {},
    el("p", { className: "modal-subtitle" }, t("login.tokenBody")),
    form,
    el("p", { className: "login-switch" },
      el("button", { className: "link-button", type: "button", onClick: () => goTo("welcome") }, t("login.back"))
    )
  );
}

function hideLogin(): void {
  loginOverlay?.remove();
  loginOverlay = null;
}
