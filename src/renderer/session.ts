import type { DiscordSession } from "@shared/types";
import { el, mountRotatingText, t } from "./ui";

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
}

interface GuildSummary {
  id: string;
  name: string;
  icon: string | null;
  channels: ChannelSummary[];
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
let loginOverlay: HTMLElement | null = null;
let activeChannelId: string | null = null;

const TEXT_CHANNEL_TYPES = new Set([0, 5]);

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
  const raw = (data as { guilds?: unknown[] })?.guilds ?? [];
  guilds = raw.map(entry => {
    const g = entry as {
      id: string;
      name?: string;
      icon?: string | null;
      properties?: { name?: string; icon?: string | null };
      channels?: Array<{ id: string; name?: string; type?: number; position?: number }>;
    };
    return {
      id: g.id,
      name: g.properties?.name ?? g.name ?? "?",
      icon: g.properties?.icon ?? g.icon ?? null,
      channels: (g.channels ?? []).map(ch => ({
        id: ch.id,
        name: ch.name ?? "?",
        type: ch.type ?? 0,
        position: ch.position ?? 0
      }))
    };
  });
  renderRail();
  const first = guilds[0];
  if (first) selectGuild(first.id);
}

function renderRail(): void {
  const rail = document.getElementById("server-rail")!;
  rail.querySelectorAll(".server-pill").forEach(pill => pill.remove());
  const settingsButton = rail.querySelector(".settings-button");
  for (const guild of guilds) {
    const pill = el("button", {
      className: "server-pill",
      type: "button",
      title: guild.name,
      "aria-label": guild.name,
      "data-guild": guild.id,
      onClick: () => selectGuild(guild.id)
    });
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

function selectGuild(id: string): void {
  const guild = guilds.find(g => g.id === id);
  if (!guild) return;

  document.querySelectorAll<HTMLElement>(".server-pill").forEach(pill => {
    pill.setAttribute("aria-current", pill.dataset.guild === id ? "true" : "false");
  });
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

/* ---------- login view ---------- */

function showLogin(): void {
  if (loginOverlay) return;

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

  const dialog = el(
    "div",
    { className: "modal login", role: "dialog", "aria-modal": "true", "aria-labelledby": "login-title" },
    el("h1", { id: "login-title" }, t("login.title")),
    el("p", { className: "modal-subtitle" }, t("login.body")),
    form
  );
  loginOverlay = el("div", { className: "overlay" }, dialog);
  document.body.append(loginOverlay);
  input.focus();
}

function hideLogin(): void {
  loginOverlay?.remove();
  loginOverlay = null;
}
