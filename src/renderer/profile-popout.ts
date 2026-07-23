import type { UserProfile } from "@shared/types";
import { el, t } from "./ui";
import { getPfpOverride, getBgOverride } from "./avatar-overrides";
import { wireUserContextMenu } from "./context-menu";

/**
 * The profile popout — click a username or avatar anywhere in the message
 * list to see it. Backed by Discord's real `/users/{id}/profile` endpoint
 * (docs.discord.food/resources/user), the same one the official client
 * hits from the same click. This is also the prerequisite several backlog
 * items were waiting on (connections display, badge rendering surface).
 */

let openPopout: HTMLElement | null = null;

function closePopout(): void {
  openPopout?.remove();
  openPopout = null;
  document.removeEventListener("pointerdown", onOutsideClick, true);
  document.removeEventListener("keydown", onEscape, true);
}

function onOutsideClick(ev: PointerEvent): void {
  if (openPopout && !openPopout.contains(ev.target as Node)) closePopout();
}

function onEscape(ev: KeyboardEvent): void {
  if (ev.key === "Escape") closePopout();
}

function positionNear(popout: HTMLElement, anchor: HTMLElement): void {
  const rect = anchor.getBoundingClientRect();
  const width = 320;
  let left = rect.left;
  if (left + width > window.innerWidth - 12) left = window.innerWidth - width - 12;
  left = Math.max(12, left);
  let top = rect.bottom + 6;
  popout.style.left = `${left}px`;
  popout.style.top = `${top}px`;
  // Flip above the anchor if it would run off the bottom of the viewport.
  requestAnimationFrame(() => {
    const h = popout.getBoundingClientRect().height;
    if (top + h > window.innerHeight - 12) {
      top = Math.max(12, rect.top - h - 6);
      popout.style.top = `${top}px`;
    }
  });
}

function connectionIcon(type: string): string {
  const known: Record<string, string> = {
    github: "🐙",
    twitter: "🐦",
    youtube: "▶",
    twitch: "🎮",
    spotify: "🎵",
    steam: "🎮",
    reddit: "👽"
  };
  return known[type] ?? "🔗";
}

function renderProfileBody(profile: UserProfile, globalBadges: Array<{ icon: string; tooltip: string }>): HTMLElement {
  // UserPFP/UsrBG overrides win over the real Discord avatar/banner, same
  // priority the real plugins use.
  const avatarUrl =
    getPfpOverride(profile.id) ?? (profile.avatar ? `https://cdn.discordapp.com/avatars/${profile.id}/${profile.avatar}.png?size=128` : null);
  const bgOverride = getBgOverride(profile.id);
  const bannerImageUrl = bgOverride ?? (profile.banner ? `https://cdn.discordapp.com/banners/${profile.id}/${profile.banner}.png?size=480` : null);

  const discordBadgeIcons = profile.badges.map(b =>
    el("img", {
      className: "profile-badge",
      src: `https://cdn.discordapp.com/badge-icons/${b.icon}.png`,
      alt: b.description,
      title: b.description,
      loading: "lazy"
    })
  );
  // GlobalBadges entries already carry full image URLs, unlike Discord's own
  // badges which are just an icon hash resolved through the CDN above.
  const globalBadgeIcons = globalBadges.map(b =>
    el("img", { className: "profile-badge", src: b.icon, alt: b.tooltip, title: b.tooltip, loading: "lazy" })
  );
  const allBadgeIcons = [...discordBadgeIcons, ...globalBadgeIcons];
  // Per-badge stagger delay (CSS var, not an inline style="" attribute —
  // those are CSP-blocked here, see the note in theme-preview.ts).
  allBadgeIcons.forEach((icon, i) => icon.style.setProperty("--i", String(i)));
  const badges = allBadgeIcons.length > 0 ? el("div", { className: "profile-badges" }, ...allBadgeIcons) : null;

  const connections =
    profile.connectedAccounts.length > 0
      ? el(
          "div",
          { className: "profile-connections" },
          ...profile.connectedAccounts.map(c =>
            el(
              "span",
              { className: "profile-connection", title: `${c.name} (${c.type})` },
              connectionIcon(c.type),
              " ",
              c.name
            )
          )
        )
      : null;

  const identityChildren: HTMLElement[] = [
    el("span", { className: "profile-name" }, profile.globalName ?? profile.username),
    el("span", { className: "profile-username" }, `@${profile.username}`)
  ];
  if (profile.pronouns) identityChildren.push(el("span", { className: "profile-pronouns" }, profile.pronouns));

  const avatar = avatarUrl
    ? el("img", { className: "profile-avatar", src: avatarUrl, alt: "" })
    : el("span", { className: "profile-avatar profile-avatar-fallback", "aria-hidden": "true" }, profile.username[0] ?? "?");

  // Inline style="" attributes are blocked by this app's CSP (style-src
  // 'self', no unsafe-inline); per-property CSSOM sets aren't — same fix
  // as theme-preview.ts.
  const banner = el("div", { className: "profile-banner" });
  if (bannerImageUrl) {
    banner.style.backgroundImage = `url(${bannerImageUrl})`;
  } else if (profile.accentColor !== null) {
    banner.style.backgroundColor = `#${profile.accentColor.toString(16).padStart(6, "0")}`;
  }

  const body = el(
    "div",
    { className: "profile-popout-body" },
    banner,
    avatar,
    el("div", { className: "profile-identity" }, ...identityChildren)
  );
  wireUserContextMenu(body, profile.id);
  if (badges) body.append(badges);
  if (profile.bio) body.append(el("p", { className: "profile-bio" }, profile.bio));
  if (connections) body.append(connections);
  return body;
}

export function openProfilePopout(userId: string, anchor: HTMLElement): void {
  closePopout();

  const popout = el(
    "div",
    { className: "profile-popout", role: "dialog", "aria-label": t("profile.title") },
    el("p", { className: "profile-loading" }, t("profile.loading"))
  );
  document.body.append(popout);
  openPopout = popout;
  positionNear(popout, anchor);
  document.addEventListener("pointerdown", onOutsideClick, true);
  document.addEventListener("keydown", onEscape, true);

  void Promise.all([window.hyaecord.getUserProfile(userId), window.hyaecord.getGlobalBadges(userId)]).then(
    ([profile, globalBadges]) => {
      if (openPopout !== popout) return; // closed or replaced while the request was in flight
      popout.replaceChildren();
      if (!profile) {
        popout.append(el("p", { className: "profile-loading" }, t("profile.error")));
        return;
      }
      popout.append(renderProfileBody(profile, globalBadges));
      positionNear(popout, anchor);
    }
  );
}
