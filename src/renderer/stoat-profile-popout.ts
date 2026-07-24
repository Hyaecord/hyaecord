import { el, t } from "./ui";
import { stoatPresenceStatus } from "./stoat-session";
import { applyTwemoji } from "./twemoji";

/**
 * A minimal profile popout for Stoat users — deliberately not sharing
 * profile-popout.ts's implementation, since the two platforms' real
 * profile endpoints return different fields (Discord's also has
 * connections/badges/theme colours; Stoat's is just bio + banner).
 * Avatar/name/presence render instantly from the already-cached data
 * (everywhere this popout opens from already has that in memory); the
 * real bio/banner (`GET /users/{id}/profile`, confirmed via the OpenAPI
 * spec) load in progressively after, the same "don't block the popout
 * opening on a network round trip" pattern Discord's own profile popout
 * uses.
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
  id: string;
  username: string;
  displayName: string | null;
  avatar: string | null;
  online: boolean;
  presence: string | null;
}

/** Set by session.ts (which owns real channel navigation) — lets this popout's "Message" button actually open a real DM and jump to it, without this module needing to import session.ts itself (that would be circular: session.ts already imports openStoatProfilePopout indirectly via member-list.ts/friends.ts). */
let messageHandler: ((userId: string, displayName: string) => void) | null = null;

export function setStoatMessageHandler(handler: (userId: string, displayName: string) => void): void {
  messageHandler = handler;
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
    el("p", { className: "profile-popout-status-text" }, t(`friends.presence.${status}`)),
    // "Start a DM with this person" — real gap found while checking for
    // reachable UI: neither platform had any way to start a *new* DM at
    // all before this (Stoat now does; Discord's own equivalent gap
    // wasn't touched this pass per the owner's Stoat-first scope).
    el(
      "button",
      {
        type: "button",
        className: "btn primary profile-popout-message-btn",
        onClick: () => {
          messageHandler?.(user.id, name);
          close();
        }
      },
      t("profile.message")
    )
  );

  document.body.append(popout);
  openPopout = popout;

  const reposition = () => {
    const rect = anchor.getBoundingClientRect();
    const width = 280;
    const left = Math.max(12, Math.min(rect.left, window.innerWidth - width - 12));
    let top = rect.bottom + 6;
    popout.style.left = `${left}px`;
    popout.style.top = `${top}px`;
    requestAnimationFrame(() => {
      const h = popout.getBoundingClientRect().height;
      if (top + h > window.innerHeight - 12) {
        top = Math.max(12, rect.top - h - 6);
        popout.style.top = `${top}px`;
      }
    });
  };
  reposition();

  document.addEventListener("pointerdown", onOutsideClick, true);
  document.addEventListener("keydown", onEscape, true);

  void window.hyaecord.stoatGetProfile(user.id).then(profile => {
    if (openPopout !== popout) return; // closed while loading
    if (profile.banner) {
      popout.style.backgroundImage = `linear-gradient(rgba(0,0,0,0.25), rgba(0,0,0,0.45)), url(${profile.banner})`;
      popout.style.backgroundSize = "cover";
      popout.style.backgroundPosition = "top";
    }
    if (profile.bio) {
      const messageBtn = popout.querySelector(".profile-popout-message-btn");
      const bio = el("p", { className: "profile-popout-bio" }, profile.bio);
      applyTwemoji(bio);
      if (messageBtn) messageBtn.before(bio);
      else popout.append(bio);
    }
    reposition(); // content just grew — the flip-above-if-clipped check needs to re-run
  });
}
