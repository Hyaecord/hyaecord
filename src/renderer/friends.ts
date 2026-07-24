import type { RelationshipSummary } from "@shared/types";
import { el, showToast, t, trapFocus } from "./ui";
import { getPfpOverride } from "./avatar-overrides";
import { openProfilePopout } from "./profile-popout";
import { getPresenceStatus, onPresenceChange } from "./session";
import { icon } from "./icons";
import { getStoatFriends, isStoatReady, stoatPresenceStatus, acceptStoatFriendRequest, removeStoatFriend } from "./stoat-session";
import { openStoatProfilePopout } from "./stoat-profile-popout";

/**
 * The Friends list — real friends/blocked-users API
 * (docs.discord.food/resources/relationships), not guessed from the
 * gateway READY payload. Fetched fresh every time the modal opens rather
 * than kept live via RELATIONSHIP_ADD/UPDATE/REMOVE dispatch events — a
 * deliberate scope cut, not an oversight: correct on open, just doesn't
 * update itself if left open while something changes elsewhere.
 *
 * Presence (Online tab, status dots) is real: confirmed via
 * docs.discord.food's gateway events reference that a user-account
 * session automatically receives PRESENCE_UPDATE for friends (no
 * explicit subscription, unlike guild member lists) and that READY's own
 * `presences` field is the initial snapshot — see session.ts's
 * presenceMap. Only friend-type relationships get a status dot; pending
 * requests and blocked users don't show one (their presence isn't
 * meaningful in that context).
 */

const RELATIONSHIP_FRIEND = 1;
const RELATIONSHIP_BLOCKED = 2;
const RELATIONSHIP_INCOMING = 3;
const RELATIONSHIP_OUTGOING = 4;

type Tab = "online" | "all" | "pending" | "blocked";

let currentTab: Tab = "online";
let relationships: RelationshipSummary[] = [];

function avatarEl(rel: RelationshipSummary): HTMLElement {
  const override = rel.platform === "stoat" ? null : getPfpOverride(rel.id);
  // Stoat's avatar is already a full resolved CDN URL (built server-side
  // from the discovered Autumn base — see stoat-session.ts); only
  // Discord's needs the hash-to-URL construction here.
  const src = override ?? (rel.platform === "stoat" ? rel.avatar : rel.avatar ? `https://cdn.discordapp.com/avatars/${rel.id}/${rel.avatar}.png?size=64` : null);
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
  if (rel.platform === "stoat") {
    avatar.addEventListener("click", () =>
      openStoatProfilePopout(avatar, {
        username: rel.username,
        displayName: rel.globalName,
        avatar: rel.avatar,
        online: rel.stoatOnline ?? false,
        presence: rel.stoatPresence ?? null
      })
    );
  } else {
    avatar.addEventListener("click", () => openProfilePopout(rel.id, avatar));
  }

  const avatarWrap = el("span", { className: "friend-avatar-wrap" }, avatar);
  if (rel.type === RELATIONSHIP_FRIEND) {
    const status =
      rel.platform === "stoat" ? stoatPresenceStatus({ online: rel.stoatOnline ?? false, presence: rel.stoatPresence ?? null }) : getPresenceStatus(rel.id);
    avatarWrap.append(el("span", { className: `friend-status-dot status-${status}`, "aria-hidden": "true" }));
  }

  const actions: HTMLElement[] = [];
  const platform = rel.platform === "stoat" ? "stoat" : "discord";
  if (rel.type === RELATIONSHIP_INCOMING) {
    actions.push(
      actionButton(t("friends.accept"), () => void respond(rel.id, "accept", list, platform)),
      actionButton(t("friends.decline"), () => void respond(rel.id, "remove", list, platform), true)
    );
  } else if (rel.type === RELATIONSHIP_OUTGOING) {
    actions.push(actionButton(t("friends.cancel"), () => void respond(rel.id, "remove", list, platform), true));
  } else if (rel.type === RELATIONSHIP_BLOCKED) {
    actions.push(actionButton(t("friends.unblock"), () => void respond(rel.id, "remove", list, platform)));
  } else {
    actions.push(actionButton(t("friends.remove"), () => void respond(rel.id, "remove", list, platform), true));
  }

  return el(
    "div",
    { className: "friend-row" },
    avatarWrap,
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

async function respond(userId: string, action: "accept" | "remove", list: HTMLElement, platform: "discord" | "stoat"): Promise<void> {
  const ok =
    platform === "stoat"
      ? action === "accept"
        ? await acceptStoatFriendRequest(userId)
        : await removeStoatFriend(userId)
      : action === "accept"
        ? await window.hyaecord.acceptFriendRequest(userId)
        : await window.hyaecord.removeRelationship(userId);
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
    if (currentTab === "online") {
      if (r.type !== RELATIONSHIP_FRIEND) return false;
      return r.platform === "stoat" ? (r.stoatOnline ?? false) : getPresenceStatus(r.id) !== "offline";
    }
    return r.type === RELATIONSHIP_FRIEND;
  });
  if (filtered.length === 0) {
    list.append(el("p", { className: "step-hint" }, t("friends.empty")));
    return;
  }
  for (const rel of filtered) list.append(friendRow(rel, list));
}

export function openFriendsList(): void {
  const unsubscribePresence = onPresenceChange(() => renderList(list));
  const close = () => {
    unsubscribePresence();
    cleanup();
    overlay.remove();
  };

  const list = el("div", { className: "friend-list" }, el("p", { className: "step-hint" }, t("friends.loading")));

  const tabsBar = el("div", { className: "friend-tabs", role: "tablist" });
  const tabs: Array<{ id: Tab; label: string }> = [
    { id: "online", label: t("friends.tab.online") },
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
      el("button", { className: "btn ghost close", type: "button", "aria-label": t("settings.close"), onClick: close }, icon("x"))
    ),
    el("div", { className: "friend-add-row" }, usernameInput, addButton),
    // Only shown when Stoat friends can actually appear in this same list
    // (below) — without it, someone might reasonably assume this one input
    // sends a request on whichever platform, when it's really Discord-only
    // this pass (see BUILD_PROMPT.md item 73 for why: the two platforms
    // need different input formats and there's no platform picker here).
    isStoatReady() ? el("p", { className: "step-hint friend-add-caution" }, t("friends.addDiscordOnly")) : "",
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
    const stoatFriends: RelationshipSummary[] = isStoatReady()
      ? getStoatFriends().map(f => ({
          id: f.id,
          type: stoatRelationshipToType(f.relationship),
          username: f.username,
          globalName: f.displayName,
          avatar: f.avatar,
          platform: "stoat" as const,
          stoatOnline: f.online,
          stoatPresence: f.presence
        }))
      : [];
    relationships = [...rels, ...stoatFriends];
    renderList(list);
  });
}

/** Real RelationshipStatus strings ("Friend"/"Incoming"/"Outgoing"/"Blocked") to this file's existing Discord-numeric convention, so the same tab-filtering/action logic works for both platforms' rows unmodified. */
function stoatRelationshipToType(relationship: string): number {
  if (relationship === "Incoming") return RELATIONSHIP_INCOMING;
  if (relationship === "Outgoing") return RELATIONSHIP_OUTGOING;
  if (relationship === "Blocked") return RELATIONSHIP_BLOCKED;
  return RELATIONSHIP_FRIEND;
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
