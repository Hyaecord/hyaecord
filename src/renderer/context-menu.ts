import { el, showToast, state, t } from "./ui";

/**
 * A minimal right-click context menu — currently only used for Developer
 * Mode's "Copy ID" entries (same feature as Discord's own real Developer
 * Mode setting, not a plugin-specific thing). Deliberately small: this
 * isn't a general-purpose menu framework with submenus/icons/dividers,
 * just enough to show a short list of labelled actions near the cursor.
 */

interface ContextMenuItem {
  label: string;
  onClick: () => void;
}

let openMenu: HTMLElement | null = null;

function closeMenu(): void {
  openMenu?.remove();
  openMenu = null;
  document.removeEventListener("pointerdown", onOutsideClick, true);
  document.removeEventListener("keydown", onEscape, true);
  window.removeEventListener("scroll", closeMenu, true);
  window.removeEventListener("resize", closeMenu);
}

function onOutsideClick(ev: PointerEvent): void {
  if (openMenu && !openMenu.contains(ev.target as Node)) closeMenu();
}

function onEscape(ev: KeyboardEvent): void {
  if (ev.key === "Escape") closeMenu();
}

export function openContextMenu(x: number, y: number, items: ContextMenuItem[]): void {
  closeMenu();
  if (items.length === 0) return;

  const menu = el(
    "div",
    { className: "context-menu", role: "menu" },
    ...items.map(item =>
      el(
        "button",
        {
          type: "button",
          role: "menuitem",
          onClick: () => {
            item.onClick();
            closeMenu();
          }
        },
        item.label
      )
    )
  );
  document.body.append(menu);

  // Keep it on-screen rather than letting it overflow the window edge.
  const rect = menu.getBoundingClientRect();
  const left = Math.min(x, window.innerWidth - rect.width - 8);
  const top = Math.min(y, window.innerHeight - rect.height - 8);
  menu.style.left = `${Math.max(8, left)}px`;
  menu.style.top = `${Math.max(8, top)}px`;

  openMenu = menu;
  document.addEventListener("pointerdown", onOutsideClick, true);
  document.addEventListener("keydown", onEscape, true);
  window.addEventListener("scroll", closeMenu, true);
  window.addEventListener("resize", closeMenu);
}

/** A "Copy ID" entry — the one thing Developer Mode's context menus actually do right now. `label` overrides the default when a target has more than one copyable ID (e.g. a message vs. its author). */
export function copyIdItem(id: string, label?: string): ContextMenuItem {
  return {
    label: label ?? t("devMode.copyId"),
    onClick: () => {
      void navigator.clipboard.writeText(id);
      showToast(t("devMode.copiedId"));
    }
  };
}

/**
 * "Copy Mention" / "Copy User URL" — real, native reimplementations of
 * Equicord's CopyUserMention/CopyUserURLs plugins (see PLUGIN_PARITY.md's
 * Category A: better built as native context-menu items reusing this same
 * infrastructure than as sandboxed plugins, since the plugin API has no
 * context-menu hook at all). Unlike Copy ID, these aren't gated behind
 * Developer Mode — Discord's own client doesn't have an equivalent
 * built-in feature to match, so there's no "off by default, matches
 * stock Discord" precedent to follow here; these are always available.
 */
export function mentionItem(userId: string): ContextMenuItem {
  return {
    label: t("devMode.copyMention"),
    onClick: () => {
      void navigator.clipboard.writeText(`<@${userId}>`);
      showToast(t("devMode.copiedMention"));
    }
  };
}

export function userUrlItem(userId: string): ContextMenuItem {
  return {
    label: t("devMode.copyUserUrl"),
    onClick: () => {
      void navigator.clipboard.writeText(`<https://discord.com/users/${userId}>`);
      showToast(t("devMode.copiedUserUrl"));
    }
  };
}

/**
 * Wires a right-click menu for anything representing a single user: Copy
 * Mention and Copy User URL are always present; Copy User ID is added on
 * top only when Developer Mode is on, matching Copy ID's behaviour
 * elsewhere. Use this for member rows, profile popouts, and anything else
 * that's *only* a user (not a message, which also has its own ID — see
 * session.ts's messageRow for that composed case).
 */
export function wireUserContextMenu(target: HTMLElement, userId: string): void {
  target.addEventListener("contextmenu", ev => {
    ev.preventDefault();
    const items = [mentionItem(userId), userUrlItem(userId)];
    if (state.settings.developerMode) items.push(copyIdItem(userId, t("devMode.copyUserId")));
    openContextMenu(ev.clientX, ev.clientY, items);
  });
}
