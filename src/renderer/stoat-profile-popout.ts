import { el, t } from "./ui";
import { stoatPresenceStatus } from "./stoat-session";

/**
 * A minimal profile popout for Stoat users — deliberately not sharing
 * profile-popout.ts's implementation: that one fetches Discord's real
 * `/users/{id}/profile` endpoint (bio, banner, connections, badges) over
 * REST on open. Stoat has an equivalent (`GET /users/{target}/profile`)
 * but this pass only surfaces what's already in memory (avatar, name,
 * presence — everywhere a Stoat avatar is clickable already has this from
 * the user cache) rather than adding another network round trip; a real
 * bio/banner popout is a reasonable future increment, not done here.
 */

let openPopout: HTMLElement | null = null;

function close(): void {
  openPopout?.remove();
  openPopout = null;
  document.removeEventListener("pointerdown", onOutsideClick, true);
  document.removeEventListener("keydown", onEscape, true);
}

function onOutsideClick(ev: PointerEvent): void {
  if (openPopout && !openPopout.contains(ev.target as Node)) close();
}

function onEscape(ev: KeyboardEvent): void {
  if (ev.key === "Escape") close();
}

export interface StoatProfileData {
  username: string;
  displayName: string | null;
  avatar: string | null;
  online: boolean;
  presence: string | null;
}

export function openStoatProfilePopout(anchor: HTMLElement, user: StoatProfileData): void {
  close();
  const name = user.displayName || user.username;
  const status = stoatPresenceStatus(user);
  const avatar = user.avatar
    ? el("img", { className: "profile-popout-avatar", src: user.avatar, alt: "" })
    : el("span", { className: "profile-popout-avatar profile-popout-avatar-fallback", "aria-hidden": "true" }, name[0] ?? "?");

  const popout = el(
    "div",
    { className: "profile-popout", role: "dialog", "aria-label": t("profile.title") },
    el(
      "div",
      { className: "profile-popout-header" },
      avatar,
      el("span", { className: `member-status-dot status-${status} profile-popout-status`, "aria-hidden": "true" })
    ),
    el("h2", { className: "profile-popout-name" }, name),
    el("p", { className: "profile-popout-username" }, `@${user.username}`),
    el("p", { className: "profile-popout-status-text" }, t(`friends.presence.${status}`))
  );

  document.body.append(popout);
  openPopout = popout;

  const rect = anchor.getBoundingClientRect();
  const width = 280;
  let left = Math.max(12, Math.min(rect.left, window.innerWidth - width - 12));
  let top = rect.bottom + 6;
  popout.style.left = `${left}px`;
  popout.style.top = `${top}px`;
  requestAnimationFrame(() => {
    const h = popout.getBoundingClientRect().height;
    if (top + h > window.innerHeight - 12) {
      popout.style.top = `${Math.max(12, rect.top - h - 6)}px`;
    }
  });

  document.addEventListener("pointerdown", onOutsideClick, true);
  document.addEventListener("keydown", onEscape, true);
}
