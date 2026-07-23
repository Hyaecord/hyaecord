import type { DiscordSession, QrLoginEvent } from "@shared/types";
import QRCode from "qrcode";
import { el, mountRotatingText, patchSettings, showToast, state, t } from "./ui";
import { computeChannelPermissions, hasPermission, Permission } from "./permissions";

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
/** Set only while the QR login screen is mounted; the IPC listener itself is registered once, in initSession(). */
let qrEventHandler: ((event: QrLoginEvent) => void) | null = null;

const TEXT_CHANNEL_TYPES = new Set([0, 5]);
const DM_TYPES = new Set([1, 3]);

export function initSession(): void {
  window.hyaecord.onDiscordState(applySession);
  window.hyaecord.onDiscordEvent((event, data) => {
    if (event === "READY") onReady(data);
    if (event === "MESSAGE_CREATE") onMessageCreate(data);
  });
  window.hyaecord.onDiscordQrLoginEvent(event => qrEventHandler?.(event));
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
}

let stopRotation: (() => void) | null = null;

function applySession(session: DiscordSession): void {
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
  }
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

/* ---------- Server Chomper: swipe a server pill away to hide + mute it ---------- */

const CHOMPER_SWIPE_THRESHOLD = 70;

function isChomperHidden(guildId: string): boolean {
  const { hiddenGuildIds, showHidden } = state.settings.chomper;
  return hiddenGuildIds.includes(guildId) && !showHidden;
}

async function chomperHide(guildId: string, guildName: string): Promise<void> {
  const ids = state.settings.chomper.hiddenGuildIds;
  if (!ids.includes(guildId)) {
    await patchSettings({ chomper: { ...state.settings.chomper, hiddenGuildIds: [...ids, guildId] } });
  }
  void window.hyaecord.muteGuild(guildId, true);
  showToast(t("chomper.hidden", { name: guildName }));
  renderRail();
  if (activeGuildId === guildId) {
    const next = guilds.find(g => !isChomperHidden(g.id));
    if (next) selectGuild(next.id);
    else selectDms();
  }
}

/** Wires horizontal drag-to-hide on a server pill. Returns true if the drag exceeded the click threshold (caller should suppress the click). */
function wireChomperDrag(pill: HTMLElement, guildId: string, guildName: string): void {
  let startX = 0;
  let dx = 0;
  let dragging = false;

  pill.addEventListener("pointerdown", ev => {
    startX = ev.clientX;
    dx = 0;
    dragging = true;
    pill.setPointerCapture(ev.pointerId);
  });
  pill.addEventListener("pointermove", ev => {
    if (!dragging) return;
    dx = ev.clientX - startX;
    pill.style.transform = `translateX(${dx}px)`;
    pill.style.opacity = String(Math.max(0.3, 1 - Math.abs(dx) / 140));
  });
  const end = () => {
    if (!dragging) return;
    dragging = false;
    pill.style.transform = "";
    pill.style.opacity = "";
    if (Math.abs(dx) > CHOMPER_SWIPE_THRESHOLD) {
      pill.dataset.suppressClick = "true";
      void chomperHide(guildId, guildName);
    }
    dx = 0;
  };
  pill.addEventListener("pointerup", end);
  pill.addEventListener("pointercancel", end);
}

export function renderRail(): void {
  const rail = document.getElementById("server-rail")!;
  rail.querySelectorAll(".server-pill, .dm-pill").forEach(pill => pill.remove());
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

  for (const guild of guilds) {
    if (isChomperHidden(guild.id)) continue;
    const pill = el("button", {
      className: state.settings.chomper.hiddenGuildIds.includes(guild.id) ? "server-pill chomper-restored" : "server-pill",
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
    wireChomperDrag(pill, guild.id, guild.name);
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
    rail.insertBefore(pill, settingsButton);
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
    const li = el("li", { tabindex: "0", "data-channel": dm.id }, dm.name);
    const select = () => {
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
  const time = msg.timestamp
    ? new Date(msg.timestamp).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })
    : "";
  return el(
    "article",
    { className: "msg", "data-message": msg.id },
    avatar,
    el("div", { className: "msg-body" },
      el("header", { className: "msg-meta" },
        el("span", { className: "msg-author" }, msg.authorName),
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

type LoginScreen = "welcome" | "credentials" | "mfa" | "token" | "qr";

function showLogin(): void {
  if (loginOverlay) return;

  let screen: LoginScreen = "welcome";
  let mfaTicket = "";

  const body = el("div", { className: "login-body" });
  const dialog = el(
    "div",
    { className: "modal login", role: "dialog", "aria-modal": "true", "aria-labelledby": "login-title" },
    el("h1", { id: "login-title" }, t("login.title")),
    body
  );
  loginOverlay = el("div", { className: "overlay" }, dialog);
  document.body.append(loginOverlay);

  function goTo(next: LoginScreen, ticket = ""): void {
    if (screen === "qr" && next !== "qr") {
      window.hyaecord.discordCancelQrLogin();
      qrEventHandler = null;
    }
    screen = next;
    if (ticket) mfaTicket = ticket;
    render();
  }

  function render(): void {
    body.replaceChildren();
    if (screen === "welcome") body.append(welcomeScreen(goTo));
    else if (screen === "credentials") body.append(credentialsScreen(goTo));
    else if (screen === "mfa") body.append(mfaScreen(mfaTicket, goTo));
    else if (screen === "qr") body.append(qrScreen(goTo));
    else body.append(tokenScreen(goTo));
    body.querySelector("input")?.focus();
  }

  render();
}

function welcomeScreen(goTo: (screen: LoginScreen, ticket?: string) => void): HTMLElement {
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
    el("button", { className: "btn login-big-btn", type: "button", onClick: () => goTo("qr") }, t("login.withQr")),
    el("p", { className: "login-switch" },
      el("button", { className: "link-button", type: "button", onClick: () => goTo("credentials") }, t("login.useCredentials")),
      " · ",
      el("button", { className: "link-button", type: "button", onClick: () => goTo("token") }, t("login.useToken"))
    )
  );
}

function qrScreen(goTo: (screen: LoginScreen) => void): HTMLElement {
  const canvas = el("canvas", { className: "login-qr", width: "220", height: "220" }) as HTMLCanvasElement;
  const status = el("p", { className: "step-hint login-qr-status" }, t("login.qr.waiting"));
  const error = el("p", { className: "login-error", role: "alert" });

  qrEventHandler = event => {
    if (event.type === "url") {
      void QRCode.toCanvas(canvas, event.url, { width: 220, margin: 1 });
      status.textContent = t("login.qr.waiting");
    } else if (event.type === "confirming") {
      status.textContent = t("login.qr.confirming");
    } else if (event.type === "expired") {
      error.textContent = t("login.qr.expired");
    } else if (event.type === "error") {
      error.textContent = t(`login.error.${event.error}`);
    }
  };
  window.hyaecord.discordStartQrLogin();

  return el(
    "div",
    {},
    el("p", { className: "modal-subtitle" }, t("login.qr.body")),
    el("div", { className: "login-qr-wrap" }, canvas),
    status,
    error,
    el("p", { className: "login-switch" },
      el("button", { className: "link-button", type: "button", onClick: () => goTo("welcome") }, t("login.back"))
    )
  );
}

function credentialsScreen(goTo: (screen: LoginScreen, ticket?: string) => void): HTMLElement {
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
      goTo("mfa", result.ticket);
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

function mfaScreen(ticket: string, goTo: (screen: LoginScreen) => void): HTMLElement {
  const codeInput = el("input", {
    type: "text",
    id: "login-mfa-code",
    className: "login-input",
    inputmode: "numeric",
    autocomplete: "one-time-code",
    placeholder: t("login.mfaPlaceholder")
  }) as HTMLInputElement;
  const error = el("p", { className: "login-error", role: "alert" });
  const button = el("button", { className: "btn primary", type: "submit" }, t("login.verify"));

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
    const result = await window.hyaecord.discordSubmitMfa(codeInput.value, ticket);
    button.removeAttribute("disabled");
    if (result.ok) return;
    error.textContent = t(`login.error.${result.mfaRequired ? "mfa-unsupported" : result.error}`);
    codeInput.focus();
  });

  return el(
    "div",
    {},
    el("p", { className: "modal-subtitle" }, t("login.mfaBody")),
    form,
    el("p", { className: "login-switch" },
      el("button", { className: "link-button", type: "button", onClick: () => goTo("credentials") }, t("login.back"))
    )
  );
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
  qrEventHandler = null;
}
