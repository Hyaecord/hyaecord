import { el, holdButton, showToast, t } from "./ui";
import { getActiveGuild } from "./session";

/**
 * Moderator View — Shift+M in a server you can manage channels in. Select
 * channels, hold the delete button to confirm (same hold-instead-of-popup
 * pattern as everywhere else), selected channels "chomp" into the den
 * before their REST delete calls fire.
 *
 * Scope note: this only ever touches the currently active guild's channel
 * list, and only after confirming `canManageChannels` computed from real
 * Discord role/overwrite data (see permissions.ts) — never a client-side
 * guess. Deletion is real and irreversible; there is no undo, same as
 * deleting a channel in the official client.
 */

let active = false;
let selected = new Set<string>();
let bar: HTMLElement | null = null;

export function initModeratorView(): void {
  window.addEventListener("keydown", ev => {
    const target = ev.target as HTMLElement | null;
    const typing = target?.tagName === "INPUT" || target?.tagName === "TEXTAREA";

    if (ev.key === "Escape" && active) {
      exit();
      return;
    }
    if (typing) return;
    if (ev.key.toLowerCase() === "m" && ev.shiftKey && !ev.ctrlKey && !ev.altKey && !ev.metaKey) {
      ev.preventDefault();
      toggle();
    }
  });
}

function toggle(): void {
  if (active) {
    exit();
    return;
  }
  const guild = getActiveGuild();
  if (!guild) {
    showToast(t("moderator.noGuild"));
    return;
  }
  if (!guild.canManageChannels) {
    showToast(t("moderator.noPermission"));
    return;
  }
  enter();
}

function enter(): void {
  active = true;
  selected = new Set();
  const list = document.getElementById("channels")!;
  list.classList.add("moderator-mode");

  for (const li of list.querySelectorAll<HTMLElement>("li")) {
    li.setAttribute("aria-selected", "false");
    li.addEventListener("click", onItemClick, { capture: true });
  }

  bar = renderBar();
  document.getElementById("channel-list")!.append(bar);
  showToast(t("moderator.entered"));
}

function exit(): void {
  active = false;
  selected = new Set();
  const list = document.getElementById("channels");
  if (list) {
    list.classList.remove("moderator-mode");
    for (const li of list.querySelectorAll<HTMLElement>("li")) {
      li.removeAttribute("aria-selected");
      li.removeEventListener("click", onItemClick, { capture: true });
    }
  }
  bar?.remove();
  bar = null;
}

function onItemClick(ev: MouseEvent): void {
  if (!active) return;
  ev.preventDefault();
  ev.stopPropagation();
  const li = ev.currentTarget as HTMLElement;
  const id = li.dataset.channel;
  if (!id) return;
  if (selected.has(id)) {
    selected.delete(id);
    li.setAttribute("aria-selected", "false");
  } else {
    selected.add(id);
    li.setAttribute("aria-selected", "true");
  }
  updateBar();
}

function renderBar(): HTMLElement {
  const count = el("span", { className: "count" }, t("moderator.selected", { count: 0 }));
  const cancel = el("button", { className: "btn ghost", type: "button", onClick: exit }, t("moderator.cancel"));
  const confirm = holdButton(t("moderator.holdToDelete"), 1200, onConfirmDelete, "danger");
  const el2 = el("div", { className: "moderator-bar" }, count, cancel, confirm);
  return el2;
}

function updateBar(): void {
  if (!bar) return;
  const count = bar.querySelector(".count")!;
  count.textContent = t("moderator.selected", { count: selected.size });
}

const CHOMP_ANIMATION_MS = 420;

async function onConfirmDelete(): Promise<void> {
  const ids = [...selected];
  if (ids.length === 0) return;
  const list = document.getElementById("channels")!;

  for (const id of ids) {
    const li = list.querySelector<HTMLElement>(`li[data-channel="${id}"]`);
    li?.classList.add("is-consumed");
  }

  const [results] = await Promise.all([
    Promise.all(ids.map(id => window.hyaecord.deleteChannel(id))),
    new Promise(resolve => setTimeout(resolve, CHOMP_ANIMATION_MS))
  ]);

  const failed = results.filter(ok => !ok).length;
  for (const id of ids) {
    list.querySelector<HTMLElement>(`li[data-channel="${id}"]`)?.remove();
  }

  showToast(
    failed > 0
      ? t("moderator.deletedPartial", { ok: ids.length - failed, failed })
      : t("moderator.deleted", { count: ids.length })
  );
  exit();
}
