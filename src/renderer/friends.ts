import type { RelationshipSummary } from "@shared/types";
import { el, showToast, t, trapFocus } from "./ui";
import { getPfpOverride } from "./avatar-overrides";
import { openProfilePopout } from "./profile-popout";

/**
 * The Friends list — real friends/blocked-users API
 * (docs.discord.food/resources/relationships), not guessed from the
 * gateway READY payload. Fetched fresh every time the modal opens rather
 * than kept live via RELATIONSHIP_ADD/UPDATE/REMOVE dispatch events — a
 * deliberate scope cut, not an oversight: correct on open, just doesn't
 * update itself if left open while something changes elsewhere.
 *
 * Deliberately has no "Online" tab/presence dots: Discord's real client
 * shows online status per friend, but this app doesn't track presence
 * for anyone outside a currently-open guild's member list (see
 * member-list.ts's GUILD_MEMBER_LIST_UPDATE-driven status dots) — adding
 * a fake "everyone's offline" status would be worse than not showing one
 * at all. All Friends / Pending / Blocked tabs only, matching what's
 * actually known.
 */

const RELATIONSHIP_FRIEND = 1;
const RELATIONSHIP_BLOCKED = 2;
const RELATIONSHIP_INCOMING = 3;
const RELATIONSHIP_OUTGOING = 4;

type Tab = "all" | "pending" | "blocked";

let currentTab: Tab = "all";
let relationships: RelationshipSummary[] = [];

function avatarEl(rel: RelationshipSummary): HTMLElement {
  const override = getPfpOverride(rel.id);
  const src = override ?? (rel.avatar ? `https://cdn.discordapp.com/avatars/${rel.id}/${rel.avatar}.png?size=64` : null);
  const name = rel.globalName ?? rel.username;
  return src
    ? el("img", { className: "friend-avatar", src, alt: "", loading: "lazy" })
    : el("span", { className: "friend-avatar friend-avatar-fallback", "aria-hidden": "true" }, name[0] ?? "?");
}

function actionButton(label: string, onClick: () => void, danger = false): HTMLElement {
  return el(
    "button",
    { type: "button", className: danger ? "btn danger friend-action" : "btn ghost friend-action", onClick },
    label
  );
}

function friendRow(rel: RelationshipSummary, list: HTMLElement): HTMLElement {
  const name = rel.globalName ?? rel.username;
  const avatar = avatarEl(rel);
  avatar.classList.add("clickable-profile");
  avatar.addEventListener("click", () => openProfilePopout(rel.id, avatar));

  const actions: HTMLElement[] = [];
  if (rel.type === RELATIONSHIP_INCOMING) {
    actions.push(
      actionButton(t("friends.accept"), () => void respond(rel.id, "accept", list)),
      actionButton(t("friends.decline"), () => void respond(rel.id, "remove", list), true)
    );
  } else if (rel.type === RELATIONSHIP_OUTGOING) {
    actions.push(actionButton(t("friends.cancel"), () => void respond(rel.id, "remove", list), true));
  } else if (rel.type === RELATIONSHIP_BLOCKED) {
    actions.push(actionButton(t("friends.unblock"), () => void respond(rel.id, "remove", list)));
  } else {
    actions.push(actionButton(t("friends.remove"), () => void respond(rel.id, "remove", list), true));
  }

  return el(
    "div",
    { className: "friend-row" },
    avatar,
    el("span", { className: "friend-name" }, name),
    el("span", { className: "friend-status" }, t(`friends.type.${relationshipLabel(rel.type)}`)),
    el("div", { className: "friend-actions" }, ...actions)
  );
}

function relationshipLabel(type: number): string {
  if (type === RELATIONSHIP_INCOMING) return "incoming";
  if (type === RELATIONSHIP_OUTGOING) return "outgoing";
  if (type === RELATIONSHIP_BLOCKED) return "blocked";
  return "friend";
}

async function respond(userId: string, action: "accept" | "remove", list: HTMLElement): Promise<void> {
  const ok = action === "accept" ? await window.hyaecord.acceptFriendRequest(userId) : await window.hyaecord.removeRelationship(userId);
  if (!ok) {
    showToast(t("friends.actionFailed"));
    return;
  }
  relationships = relationships.filter(r => r.id !== userId);
  renderList(list);
}

function renderList(list: HTMLElement): void {
  list.replaceChildren();
  const filtered = relationships.filter(r => {
    if (currentTab === "blocked") return r.type === RELATIONSHIP_BLOCKED;
    if (currentTab === "pending") return r.type === RELATIONSHIP_INCOMING || r.type === RELATIONSHIP_OUTGOING;
    return r.type === RELATIONSHIP_FRIEND;
  });
  if (filtered.length === 0) {
    list.append(el("p", { className: "step-hint" }, t("friends.empty")));
    return;
  }
  for (const rel of filtered) list.append(friendRow(rel, list));
}

export function openFriendsList(): void {
  const close = () => {
    cleanup();
    overlay.remove();
  };

  const list = el("div", { className: "friend-list" }, el("p", { className: "step-hint" }, t("friends.loading")));

  const tabsBar = el("div", { className: "friend-tabs", role: "tablist" });
  const tabs: Array<{ id: Tab; label: string }> = [
    { id: "all", label: t("friends.tab.all") },
    { id: "pending", label: t("friends.tab.pending") },
    { id: "blocked", label: t("friends.tab.blocked") }
  ];
  for (const tab of tabs) {
    const button = el(
      "button",
      {
        type: "button",
        className: tab.id === currentTab ? "friend-tab is-active" : "friend-tab",
        onClick: () => {
          currentTab = tab.id;
          tabsBar.querySelectorAll(".friend-tab").forEach(b => b.classList.remove("is-active"));
          button.classList.add("is-active");
          renderList(list);
        }
      },
      tab.label
    );
    tabsBar.append(button);
  }

  const usernameInput = el("input", {
    type: "text",
    className: "friend-add-input",
    placeholder: t("friends.addPlaceholder"),
    "aria-label": t("friends.addPlaceholder")
  }) as HTMLInputElement;
  const addButton = el(
    "button",
    {
      type: "button",
      className: "btn primary",
      onClick: () => void sendRequest(usernameInput)
    },
    t("friends.addButton")
  );

  const dialog = el(
    "div",
    { className: "modal friends-modal", role: "dialog", "aria-modal": "true", "aria-labelledby": "friends-title" },
    el("div", { className: "settings-header" },
      el("h1", { id: "friends-title" }, t("friends.title")),
      el("button", { className: "btn ghost close", type: "button", "aria-label": t("settings.close"), onClick: close }, "✕")
    ),
    el("div", { className: "friend-add-row" }, usernameInput, addButton),
    el("p", { className: "step-hint friend-add-caution" }, t("friends.addCaution")),
    tabsBar,
    list
  );

  const overlay = el("div", { className: "overlay" }, dialog);
  overlay.addEventListener("keydown", ev => {
    if (ev.key === "Escape") close();
  });
  overlay.addEventListener("mousedown", ev => {
    if (ev.target === overlay) close();
  });
  const cleanup = trapFocus(overlay);
  document.body.append(overlay);
  (dialog.querySelector(".close") as HTMLButtonElement).focus();

  void window.hyaecord.listRelationships().then(rels => {
    relationships = rels;
    renderList(list);
  });
}

async function sendRequest(input: HTMLInputElement): Promise<void> {
  const username = input.value.trim();
  if (!username) return;
  const res = await window.hyaecord.sendFriendRequest(username);
  if (res.ok) {
    input.value = "";
    showToast(t("friends.requestSent"));
  } else {
    showToast(res.error ?? t("friends.actionFailed"));
  }
}
