import { el, showToast, t, trapFocus } from "./ui";
import { icon } from "./icons";
import {
  STOAT_CHANNEL_PERMISSIONS,
  setStoatSlowmode,
  setStoatDefaultChannelPermissions,
  setStoatRoleChannelPermissions,
  type StoatChannelSummary,
  type StoatRoleSummary
} from "./stoat-session";

/**
 * Real "Channel Settings" for Stoat — slowmode and per-role channel
 * permission overrides, both backed by real, confirmed endpoints
 * (`PATCH /channels/{id}`, `PUT /channels/{id}/permissions/default`,
 * `PUT /channels/{id}/permissions/{role}` — see stoat-session.ts). The
 * permission bit values themselves come from Stoat's own current backend
 * source, fetched live via the GitHub API rather than guessed. This app
 * doesn't compute effective Stoat permissions client-side yet (a real,
 * stated scope cut — see stoat-session.ts's module doc comment), so the
 * panel is reachable regardless of whether the viewer actually has
 * ManagePermissions; the server enforces that for real and a failed save
 * shows a real error toast rather than silently pretending to work.
 */

type PermState = "neutral" | "allow" | "deny";

function permStateOf(bit: number, allow: number, deny: number): PermState {
  if ((allow & bit) === bit) return "allow";
  if ((deny & bit) === bit) return "deny";
  return "neutral";
}

function nextPermState(s: PermState): PermState {
  if (s === "neutral") return "allow";
  if (s === "allow") return "deny";
  return "neutral";
}

function permStateLabel(s: PermState): string {
  if (s === "allow") return "✓";
  if (s === "deny") return "✕";
  return "–";
}

let openDialog: HTMLElement | null = null;

export function openChannelSettings(channel: StoatChannelSummary, roles: StoatRoleSummary[]): void {
  if (openDialog) {
    openDialog.remove();
    openDialog = null;
  }

  const close = () => {
    cleanup();
    overlay.remove();
    openDialog = null;
  };

  // Slowmode
  const slowmodeInput = el("input", {
    type: "number",
    min: "0",
    max: "21600",
    className: "channel-settings-slowmode-input",
    value: String(channel.slowmode ?? 0)
  }) as HTMLInputElement;
  const slowmodeSave = el(
    "button",
    {
      type: "button",
      className: "btn",
      onClick: async () => {
        const seconds = Math.max(0, Math.min(21600, Number(slowmodeInput.value) || 0));
        const ok = await setStoatSlowmode(channel.id, seconds === 0 ? null : seconds);
        showToast(t(ok ? "channelSettings.saved" : "friends.actionFailed"));
      }
    },
    t("channelSettings.save")
  );

  // Permission editor: role picker + tri-state rows, one save button that
  // applies to whichever role/default is currently selected.
  let selectedRoleId: string | null = null; // null = "Default" (@everyone-equivalent)
  const permRows = new Map<number, HTMLButtonElement>();

  const currentOverride = (): { allow: number; deny: number } => {
    if (selectedRoleId === null) return channel.defaultPermissions ?? { allow: 0, deny: 0 };
    return channel.rolePermissions[selectedRoleId] ?? { allow: 0, deny: 0 };
  };

  const permGrid = el("div", { className: "channel-settings-perm-grid" });

  const renderPermGrid = () => {
    permGrid.replaceChildren();
    permRows.clear();
    const { allow, deny } = currentOverride();
    for (const perm of STOAT_CHANNEL_PERMISSIONS) {
      let state = permStateOf(perm.bit, allow, deny);
      const btn = el(
        "button",
        { type: "button", className: `channel-settings-perm-state perm-${state}` },
        permStateLabel(state)
      ) as HTMLButtonElement;
      btn.addEventListener("click", () => {
        state = nextPermState(state);
        btn.className = `channel-settings-perm-state perm-${state}`;
        btn.textContent = permStateLabel(state);
      });
      permRows.set(perm.bit, btn);
      permGrid.append(el("div", { className: "channel-settings-perm-row" }, el("span", {}, perm.key), btn));
    }
  };
  renderPermGrid();

  const roleOptions: Array<{ id: string | null; label: string }> = [
    { id: null, label: t("channelSettings.defaultRole") },
    ...roles.map(r => ({ id: r.id, label: r.name }))
  ];
  const roleSelect = el(
    "select",
    {
      className: "channel-settings-role-select",
      onChange: (ev: Event) => {
        const value = (ev.target as HTMLSelectElement).value;
        selectedRoleId = value === "__default__" ? null : value;
        renderPermGrid();
      }
    },
    ...roleOptions.map(o => el("option", { value: o.id ?? "__default__" }, o.label))
  );

  const permSave = el(
    "button",
    {
      type: "button",
      className: "btn primary",
      onClick: async () => {
        let allow = 0;
        let deny = 0;
        for (const perm of STOAT_CHANNEL_PERMISSIONS) {
          const btn = permRows.get(perm.bit)!;
          if (btn.classList.contains("perm-allow")) allow |= perm.bit;
          else if (btn.classList.contains("perm-deny")) deny |= perm.bit;
        }
        const ok =
          selectedRoleId === null
            ? await setStoatDefaultChannelPermissions(channel.id, allow, deny)
            : await setStoatRoleChannelPermissions(channel.id, selectedRoleId, allow, deny);
        showToast(t(ok ? "channelSettings.saved" : "friends.actionFailed"));
      }
    },
    t("channelSettings.save")
  );

  const dialog = el(
    "div",
    { className: "modal channel-settings-modal", role: "dialog", "aria-modal": "true", "aria-labelledby": "channel-settings-title" },
    el(
      "div",
      { className: "settings-header" },
      el("h1", { id: "channel-settings-title" }, t("channelSettings.title", { name: channel.name })),
      el("button", { className: "btn ghost close", type: "button", "aria-label": t("settings.close"), onClick: close }, icon("x"))
    ),
    el(
      "section",
      { className: "settings-section" },
      el("h2", {}, t("channelSettings.slowmode")),
      el("p", { className: "step-hint" }, t("channelSettings.slowmodeHint")),
      el("div", { className: "friend-add-row" }, slowmodeInput, slowmodeSave)
    ),
    el(
      "section",
      { className: "settings-section" },
      el("h2", {}, t("channelSettings.permissions")),
      el("p", { className: "step-hint" }, t("channelSettings.permissionsHint")),
      roleSelect,
      permGrid,
      permSave
    )
  );

  const overlay = el("div", { className: "overlay" }, dialog);
  overlay.addEventListener("keydown", ev => {
    if (ev.key === "Escape") close();
  });
  overlay.addEventListener("mousedown", ev => {
    if (ev.target === overlay) close();
  });
  document.body.append(overlay);
  openDialog = overlay;
  const cleanup = trapFocus(overlay);
}
