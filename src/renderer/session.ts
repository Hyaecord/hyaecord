import type { DiscordSession } from "@shared/types";
import { el, t } from "./ui";

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

let guilds: GuildSummary[] = [];
let loginOverlay: HTMLElement | null = null;

const TEXT_CHANNEL_TYPES = new Set([0, 5]);

export function initSession(): void {
  window.hyaecord.onDiscordState(applySession);
  window.hyaecord.onDiscordEvent((event, data) => {
    if (event === "READY") onReady(data);
  });
  void window.hyaecord.getDiscordSession().then(applySession);
}

function statusText(session: DiscordSession): string {
  switch (session.state) {
    case "ready":
      return session.user?.globalName ?? session.user?.username ?? "";
    case "connecting":
      return t("shell.status.connecting");
    case "reconnecting":
      return t("shell.status.reconnecting");
    default:
      return t("shell.status.loggedOut");
  }
}

function applySession(session: DiscordSession): void {
  document.getElementById("chat-header")!.textContent = statusText(session);
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
    };
    li.addEventListener("click", select);
    li.addEventListener("keydown", ev => {
      if ((ev as KeyboardEvent).key === "Enter") select();
    });
    list.append(li);
  }
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
