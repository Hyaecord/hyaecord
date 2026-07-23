import type { PluginInfo, ThemeId } from "@shared/types";
import { burstParticles, el, holdToggleRow, patchSettings, showToast, state, t, toggleRow, trapFocus } from "./ui";
import { refreshChomperViews, getCurrentUser } from "./session";
import { openThemeStore } from "./theme-store";
import { loadAvatarOverrides } from "./avatar-overrides";

const MAX_AVATAR_BYTES = 8 * 1024 * 1024;

function readFileAsDataUri(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function avatarSection(): HTMLElement {
  const user = getCurrentUser();
  const avatarUrl = user?.avatar ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=128` : null;

  const preview = avatarUrl
    ? (el("img", { className: "account-avatar-preview", src: avatarUrl, alt: "" }) as HTMLImageElement)
    : el("span", { className: "account-avatar-preview account-avatar-fallback", "aria-hidden": "true" }, (user?.username ?? "?")[0] ?? "?");

  const status = el("p", { className: "row-description" });
  const fileInput = el("input", { type: "file", accept: "image/png,image/jpeg,image/gif", hidden: true }) as HTMLInputElement;

  const changeButton = el(
    "button",
    {
      className: "btn",
      type: "button",
      onClick: () => fileInput.click()
    },
    t("settings.account.changeAvatar")
  ) as HTMLButtonElement;

  const removeButton = el(
    "button",
    {
      className: "btn ghost",
      type: "button",
      onClick: async () => {
        if (!user) return;
        removeButton.setAttribute("disabled", "");
        const ok = await window.hyaecord.setAvatar(null);
        removeButton.removeAttribute("disabled");
        status.textContent = ok ? "" : t("settings.account.error");
        if (ok) showToast(t("settings.account.updated"));
      }
    },
    t("settings.account.removeAvatar")
  ) as HTMLButtonElement;

  fileInput.addEventListener("change", async () => {
    const file = fileInput.files?.[0];
    fileInput.value = "";
    if (!file || !user) return;
    if (file.size > MAX_AVATAR_BYTES) {
      status.textContent = t("settings.account.tooLarge");
      return;
    }
    status.textContent = "";
    changeButton.setAttribute("disabled", "");
    try {
      const dataUri = await readFileAsDataUri(file);
      const ok = await window.hyaecord.setAvatar(dataUri);
      status.textContent = ok ? "" : t("settings.account.error");
      if (ok) {
        showToast(t("settings.account.updated"));
        if (preview instanceof HTMLImageElement) preview.src = dataUri;
      }
    } finally {
      changeButton.removeAttribute("disabled");
    }
  });

  return el(
    "div",
    { className: "setting-row account-avatar-row" },
    preview,
    el(
      "div",
      { className: "row-text" },
      el("span", { className: "row-label" }, user?.globalName ?? user?.username ?? ""),
      el("div", { className: "account-avatar-actions" }, changeButton, removeButton, fileInput),
      status
    )
  );
}

const REPO_URL = "https://github.com/Hyaecord/hyaecord";

function starRepoButton(): HTMLElement {
  const button = el(
    "button",
    {
      className: "btn star-btn",
      type: "button",
      onClick: (ev: Event) => {
        const rect = (ev.currentTarget as HTMLElement).getBoundingClientRect();
        burstParticles({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
        void window.hyaecord.openExternal(REPO_URL);
      }
    },
    "★ ",
    t("settings.starRepo")
  );
  return el("div", { className: "setting-row" },
    el("span", { className: "row-text" },
      el("span", { className: "row-label" }, t("settings.support")),
      el("span", { className: "row-description" }, t("settings.support.description"))
    ),
    button
  );
}

/**
 * Renders one plugin's own settings schema (boolean/number/string) as
 * plain controls beneath its row — the same shapes used elsewhere
 * (toggle, slider, text input), just driven by a schema instead of a
 * fixed list of app settings.
 */
function pluginSettingRow(pluginId: string, key: string, plugin: PluginInfo): HTMLElement {
  const entry = plugin.settingsSchema![key]!;
  const current = plugin.settingsValues[key] ?? entry.default;

  if (entry.type === "boolean") {
    const input = el("input", { type: "checkbox", className: "switch-input" }) as HTMLInputElement;
    input.checked = Boolean(current);
    input.addEventListener("change", () => void window.hyaecord.setPluginSetting(pluginId, key, input.checked));
    return el(
      "label",
      { className: "setting-row plugin-setting-row" },
      el("span", { className: "row-text" },
        el("span", { className: "row-label" }, entry.label),
        entry.description ? el("span", { className: "row-description" }, entry.description) : ""
      ),
      el("span", { className: "switch" }, input, el("span", { className: "switch-thumb", "aria-hidden": "true" }))
    );
  }

  if (entry.type === "number") {
    const input = el("input", {
      type: "range",
      min: String(entry.min ?? 0),
      max: String(entry.max ?? 100),
      step: String(entry.step ?? 1),
      className: "slider",
      "aria-label": entry.label
    }) as HTMLInputElement;
    input.value = String(current);
    const value = el("output", { className: "slider-value" }, String(current));
    input.addEventListener("input", () => {
      value.textContent = input.value;
    });
    input.addEventListener("change", () => void window.hyaecord.setPluginSetting(pluginId, key, Number(input.value)));
    return el(
      "div",
      { className: "setting-row plugin-setting-row" },
      el("span", { className: "row-text" },
        el("span", { className: "row-label" }, entry.label),
        entry.description ? el("span", { className: "row-description" }, entry.description) : ""
      ),
      el("span", { className: "slider-wrap" }, input, value)
    );
  }

  const input = el("input", { type: "text", className: "select" }) as HTMLInputElement;
  input.value = String(current);
  input.addEventListener("change", () => void window.hyaecord.setPluginSetting(pluginId, key, input.value));
  return el(
    "label",
    { className: "setting-row plugin-setting-row" },
    el("span", { className: "row-text" },
      el("span", { className: "row-label" }, entry.label),
      entry.description ? el("span", { className: "row-description" }, entry.description) : ""
    ),
    input
  );
}

function pluginRow(plugin: PluginInfo): HTMLElement {
  const toggle = el("input", { type: "checkbox", className: "switch-input" }) as HTMLInputElement;
  toggle.checked = plugin.enabled;
  toggle.disabled = !!plugin.error;
  toggle.addEventListener("change", () => void window.hyaecord.setPluginEnabled(plugin.id, toggle.checked));

  const authors = plugin.authors.length ? t("plugins.by", { authors: plugin.authors.join(", ") }) : "";
  const header = el(
    "label",
    { className: "setting-row" },
    el("span", { className: "row-text" },
      el("span", { className: "row-label" }, plugin.name),
      el("span", { className: "row-description" }, plugin.description || authors),
      plugin.error ? el("span", { className: "row-description plugin-error" }, plugin.error) : ""
    ),
    el("span", { className: "switch" }, toggle, el("span", { className: "switch-thumb", "aria-hidden": "true" }))
  );

  const schemaKeys = Object.keys(plugin.settingsSchema ?? {});
  if (schemaKeys.length === 0) return header;

  return el(
    "div",
    { className: "plugin-card" },
    header,
    el("div", { className: "plugin-settings" }, ...schemaKeys.map(key => pluginSettingRow(plugin.id, key, plugin)))
  );
}

function pluginsList(): HTMLElement {
  const list = el("div", { className: "plugin-list" }, el("p", { className: "step-hint" }, t("plugins.loading")));
  void window.hyaecord.getPlugins().then(plugins => {
    list.replaceChildren();
    if (plugins.length === 0) {
      list.append(el("p", { className: "step-hint" }, t("plugins.empty")));
      return;
    }
    for (const plugin of plugins) list.append(pluginRow(plugin));
  });
  return list;
}

/**
 * Settings panel (modal). Every control applies live via patchSettings.
 * Built-in features use a hold-to-disable switch instead of a confirmation
 * popup (project UI direction — see DESIGN.md); turning one on is instant.
 */

const INTEGRATION_KEYS = ["userPFP", "usrBG", "globalBadges", "rpcBridge"] as const;
const DISABLE_HOLD_MS = 900;

export function mountSettingsButton(): void {
  const rail = document.getElementById("server-rail")!;
  const button = el(
    "button",
    { className: "settings-button", type: "button", "aria-label": t("settings.open"), title: t("settings.title"), onClick: openSettings },
    "⚙"
  );
  rail.append(button);
}

function gamingModeStatusText(): string {
  if (!state.settings.gamingMode) return t("settings.gamingMode.off");
  const { available, active } = state.gamingModeState;
  if (available === null) return t("settings.gamingMode.starting");
  if (!available) return t("settings.gamingMode.unavailable");
  return active ? t("settings.gamingMode.active") : t("settings.gamingMode.watching");
}

function selectRow(
  labelKey: string,
  options: Array<{ value: string; labelKey: string }>,
  current: string,
  onChange: (value: string) => void
): HTMLElement {
  const select = el("select", { className: "select" }) as HTMLSelectElement;
  for (const option of options) {
    const o = el("option", { value: option.value }, t(option.labelKey)) as HTMLOptionElement;
    o.selected = option.value === current;
    select.append(o);
  }
  select.addEventListener("change", () => onChange(select.value));
  return el(
    "label",
    { className: "setting-row" },
    el("span", { className: "row-text" }, el("span", { className: "row-label" }, t(labelKey))),
    select
  );
}

function scaleRow(labelKey: string, current: number, onChange: (value: number) => void): HTMLElement {
  const input = el("input", {
    type: "range", min: "0.8", max: "1.6", step: "0.05", className: "slider", "aria-label": t(labelKey)
  }) as HTMLInputElement;
  input.value = String(current);
  const value = el("output", { className: "slider-value" }, `${Math.round(current * 100)}%`);
  input.addEventListener("input", () => {
    value.textContent = `${Math.round(Number(input.value) * 100)}%`;
    onChange(Number(input.value));
  });
  return el(
    "label",
    { className: "setting-row" },
    el("span", { className: "row-text" }, el("span", { className: "row-label" }, t(labelKey))),
    el("span", { className: "slider-wrap" }, input, value)
  );
}

export function openSettings(): void {
  const close = () => {
    cleanup();
    overlay.remove();
  };

  const section = (titleKey: string, ...rows: HTMLElement[]) =>
    el("section", { className: "settings-section" }, el("h2", {}, t(titleKey)), ...rows);

  const themeOptions: Array<{ value: ThemeId; labelKey: string }> = [
    { value: "system", labelKey: "settings.theme.system" },
    { value: "light", labelKey: "settings.theme.light" },
    { value: "dark", labelKey: "settings.theme.dark" }
  ];

  const s = state.settings;

  const dialog = el(
    "div",
    { className: "modal settings", role: "dialog", "aria-modal": "true", "aria-labelledby": "settings-title" },
    el("div", { className: "settings-header" },
      el("h1", { id: "settings-title" }, t("settings.title")),
      el("button", { className: "btn ghost close", type: "button", "aria-label": t("settings.close"), onClick: close }, "✕")
    ),
    el("div", { className: "settings-scroll" },
      ...(getCurrentUser() ? [section("settings.section.account", avatarSection())] : []),
      section("settings.section.appearance",
        selectRow("settings.theme", themeOptions, s.theme, value => void patchSettings({ theme: value as ThemeId })),
        el("div", { className: "setting-row" },
          el("span", { className: "row-text" },
            el("span", { className: "row-label" }, t("settings.communityTheme")),
            el("span", { className: "row-description" },
              s.communityTheme ? t("themeStore.applied", { name: s.communityTheme.name }) : t("settings.communityTheme.description")
            )
          ),
          el("button", { className: "btn", type: "button", onClick: openThemeStore }, t("settings.communityTheme.browse"))
        )
      ),
      section("settings.section.accessibility",
        selectRow("settings.reducedMotion", [
          { value: "system", labelKey: "settings.reducedMotion.system" },
          { value: "on", labelKey: "settings.reducedMotion.on" },
          { value: "off", labelKey: "settings.reducedMotion.off" }
        ], s.reducedMotion, value => void patchSettings({ reducedMotion: value as "system" | "on" | "off" })),
        scaleRow("settings.textScale", s.textScale, value => void patchSettings({ textScale: value })),
        scaleRow("settings.uiScale", s.uiScale, value => void patchSettings({ uiScale: value }))
      ),
      section("settings.section.behaviour",
        toggleRow("settings.gamingMode", null, s.gamingMode, next => void patchSettings({ gamingMode: next })),
        el("p", { className: "row-description" }, gamingModeStatusText()),
        toggleRow("settings.selfPinFade", "settings.selfPinFade.description", s.selfPinFade.enabled, next =>
          void patchSettings({ selfPinFade: { ...state.settings.selfPinFade, enabled: next } })
        )
      ),
      section("settings.section.integrations",
        ...INTEGRATION_KEYS.map(key =>
          holdToggleRow(`feature.${key}`, `feature.${key}.description`, s.integrations[key], DISABLE_HOLD_MS, async next => {
            await patchSettings({ integrations: { ...state.settings.integrations, [key]: next } });
            // Re-fetches the override map immediately (or clears it, if just
            // turned off); already-rendered avatars/banners pick up the
            // change next time they're re-rendered (new messages, reopening
            // a profile, switching channels) rather than repainting instantly.
            if (key === "userPFP" || key === "usrBG") void loadAvatarOverrides();
          })
        )
      ),
      section("settings.section.plugins", pluginsList()),
      section("settings.section.privacy",
        toggleRow("settings.telemetry", "settings.telemetry.description", s.telemetry.enabled, next =>
          void patchSettings({ telemetry: { ...state.settings.telemetry, enabled: next } })
        )
      ),
      section("settings.section.chomper",
        el("p", { className: "row-description" }, t("settings.chomper.count", { count: s.chomper.hidden.length })),
        toggleRow("settings.chomper.showHidden", "settings.chomper.showHidden.description", s.chomper.showHidden, async next => {
          await patchSettings({ chomper: { ...state.settings.chomper, showHidden: next } });
          // Toggling the visibility override also flips the mute state of
          // everything Chomper is tracking — showing them again means
          // un-muting, hiding them again re-mutes the same set.
          for (const item of state.settings.chomper.hidden) {
            if (item.type === "guild") void window.hyaecord.muteGuild(item.id, !next);
            else void window.hyaecord.muteDm(item.id, !next);
          }
          refreshChomperViews();
        })
      ),
      section("settings.section.support", starRepoButton())
    )
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
}
