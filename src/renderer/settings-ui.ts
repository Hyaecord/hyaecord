import type { PluginInfo, ThemeId } from "@shared/types";
import { burstParticles, el, holdToggleRow, patchSettings, showToast, state, t, toggleRow, trapFocus } from "./ui";
import { refreshChomperViews, getCurrentUser, renderRail } from "./session";
import { loginStoat, logoutStoat, getStoatSessionState } from "./stoat-session";
import { openThemeStore } from "./theme-store";
import { loadAvatarOverrides } from "./avatar-overrides";
import { refreshPluginCommands } from "./slash-commands";
import { openDevicePicker } from "./device-picker";
import { openScreenSharePicker } from "./screen-share-picker";
import { openMediaPreview, openMicPreview } from "./media-preview";
import { icon } from "./icons";

const MAX_AVATAR_BYTES = 8 * 1024 * 1024;

function readFileAsDataUri(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

/**
 * Voice & Video device tests — real camera/mic/screen-source pickers with
 * a genuine live local preview, same idea as Discord's own Voice & Video
 * Settings page. Deliberately scoped as tests/previews, not a call:
 * actual voice/video transport to a channel isn't built (see
 * voice-gateway.ts's own scope note) — these buttons don't send anything
 * anywhere, they just prove your hardware/source selection actually
 * works, which is real and complete on its own.
 */
function voiceVideoSection(): HTMLElement {
  const cameraButton = el(
    "button",
    {
      className: "btn",
      type: "button",
      onClick: () =>
        openDevicePicker("videoinput", async deviceId => {
          // 16:9 is a request, not a guarantee — getUserMedia's `aspectRatio`
          // constraint is "ideal" by default (not `exact`), so a camera that
          // can't produce it falls back to its own native ratio rather than
          // failing outright. Discord's own client requests the same 16:9 for
          // its camera preview/call video.
          const stream = await navigator.mediaDevices.getUserMedia({
            video: { deviceId: { exact: deviceId }, aspectRatio: { ideal: 16 / 9 }, width: { ideal: 1280 }, height: { ideal: 720 } }
          });
          openMediaPreview(stream, t("settings.voice.testCamera"));
        })
    },
    t("settings.voice.testCamera")
  );

  const micButton = el(
    "button",
    {
      className: "btn",
      type: "button",
      onClick: () =>
        openDevicePicker("audioinput", async deviceId => {
          const stream = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: { exact: deviceId } } });
          openMicPreview(stream, t("settings.voice.testMic"));
        })
    },
    t("settings.voice.testMic")
  );

  const screenButton = el(
    "button",
    {
      className: "btn",
      type: "button",
      onClick: () =>
        openScreenSharePicker(async source => {
          const stream = await navigator.mediaDevices.getUserMedia({
            audio: false,
            video: { mandatory: { chromeMediaSourceId: source.id } }
          } as MediaStreamConstraints);
          openMediaPreview(stream, source.name);
        })
    },
    t("settings.voice.testScreenShare")
  );

  return el(
    "div",
    { className: "voice-video-tests" },
    el("p", { className: "step-hint" }, t("settings.voice.description")),
    el("div", { className: "voice-video-buttons" }, cameraButton, micButton, screenButton)
  );
}

/**
 * Multi-platform account management — owner ask: connect a Stoat.chat
 * account alongside Discord, merge both into one rail (with a small
 * platform badge per server, see session.ts's buildGuildPill/
 * buildStoatGuildPill), or switch to viewing one platform at a time.
 * Fluxer isn't built yet (only Stoat was asked for this pass) — no entry
 * for it here, rather than a dead "coming soon" row.
 */
function accountsSection(): HTMLElement {
  const stoatStatus = el("p", { className: "row-description" }, t("settings.accounts.checking"));
  const stoatRow = el(
    "div",
    { className: "setting-row" },
    el("span", { className: "row-text" },
      el("span", { className: "row-label" }, "Stoat.chat"),
      stoatStatus
    )
  );
  const refreshStoatRow = async () => {
    const session = await getStoatSessionState();
    const existingButton = stoatRow.querySelector(".account-action-btn");
    existingButton?.remove();
    if (session.state === "ready" && session.user) {
      stoatStatus.textContent = t("settings.accounts.connectedAs", { name: session.user.displayName ?? session.user.username });
      stoatRow.append(
        el(
          "button",
          {
            className: "btn ghost account-action-btn",
            type: "button",
            onClick: async () => {
              await logoutStoat();
              renderRail();
              void refreshStoatRow();
            }
          },
          t("settings.accounts.disconnect")
        )
      );
    } else {
      stoatStatus.textContent = t("settings.accounts.notConnected");
      stoatRow.append(
        el(
          "button",
          {
            className: "btn account-action-btn",
            type: "button",
            onClick: async () => {
              stoatStatus.textContent = t("settings.accounts.connecting");
              const res = await loginStoat();
              if (!res.ok && res.error !== "cancelled") showToast(t("settings.accounts.connectFailed"));
              renderRail();
              void refreshStoatRow();
            }
          },
          t("settings.accounts.connect")
        )
      );
    }
  };
  void refreshStoatRow();

  const mergeToggle = toggleRow(
    "settings.accounts.merge",
    "settings.accounts.merge.description",
    state.settings.mergeSidebar,
    next => {
      void patchSettings({ mergeSidebar: next });
      renderRail();
    }
  );

  return el("div", { className: "accounts-section" }, stoatRow, mergeToggle);
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

/** Real dependency names/licenses pulled from package.json, not guessed — kept in sync manually since there's no build step that generates this. */
const CREDITS = [
  { name: "Electron", url: "https://electronjs.org", license: "MIT" },
  { name: "lucide-static", url: "https://lucide.dev", license: "ISC" },
  { name: "@twemoji/api", url: "https://github.com/twitter/twemoji", license: "MIT + CC-BY 4.0" },
  { name: "unicode-emoji-json", url: "https://github.com/muan/unicode-emoji-json", license: "MIT" },
  { name: "ws", url: "https://github.com/websockets/ws", license: "MIT" }
];

/** One contributor tile: real GitHub avatar + username, linking to their real profile — see credits.ts for why it's a GitHub avatar specifically (that's what GitHub's own contributors API actually returns; there's no general way to source a Discord avatar for an arbitrary contributor). */
function contributorTile(c: { username: string; avatarUrl: string; profileUrl: string }): HTMLElement {
  return el(
    "button",
    {
      type: "button",
      className: "contributor-tile",
      title: c.username,
      onClick: () => void window.hyaecord.openExternal(c.profileUrl)
    },
    el("img", { src: c.avatarUrl, alt: "", loading: "lazy" }),
    el("span", { className: "contributor-name" }, c.username)
  );
}

function creditsSection(): HTMLElement {
  const list = el(
    "ul",
    { className: "credits-list" },
    ...CREDITS.map(dep =>
      el(
        "li",
        {},
        el(
          "button",
          { type: "button", className: "link-button", onClick: () => void window.hyaecord.openExternal(dep.url) },
          dep.name
        ),
        el("span", { className: "credits-license" }, dep.license)
      )
    )
  );

  const contributorsGrid = el("div", { className: "contributors-grid" }, el("p", { className: "step-hint" }, t("settings.credits.loading")));
  void window.hyaecord.getCredits().then(contributors => {
    contributorsGrid.replaceChildren();
    if (contributors.length === 0) {
      contributorsGrid.append(el("p", { className: "step-hint" }, t("settings.credits.contributorsEmpty")));
      return;
    }
    for (const c of contributors) contributorsGrid.append(contributorTile(c));
  });

  return el(
    "div",
    { className: "credits-body" },
    el("p", { className: "row-description" }, t("settings.credits.intro")),
    list,
    el("h3", { className: "credits-subheading" }, t("settings.credits.contributors")),
    contributorsGrid,
    // Honest empty state, not a "coming soon" placeholder — Stoat support
    // is new enough this pass that nobody outside this app's own commits
    // has specifically worked on it yet; this section exists so real
    // Stoat-focused contributors have somewhere to be credited once they
    // show up, not to imply a program that doesn't exist yet.
    el("h3", { className: "credits-subheading" }, t("settings.credits.stoatHelpers")),
    el("p", { className: "row-description" }, t("settings.credits.stoatHelpersEmpty")),
    el("p", { className: "row-description credits-disclaimer" }, t("settings.credits.disclaimer"))
  );
}

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

/**
 * A dual-logo badge for plugins that are a from-scratch reimplementation of
 * an existing Equicord/Vencord plugin's behaviour (see PLUGIN_PARITY.md) —
 * shows the source project's icon and Hyaecord's own icon side by side, so
 * it's visually clear the code was adapted, not vendored unmodified.
 */
const SOURCE_LABELS: Record<"equicord" | "vencord", string> = { equicord: "Equicord", vencord: "Vencord" };

function portedFromBadge(portedFrom: PluginInfo["portedFrom"]): HTMLElement | string {
  if (!portedFrom) return "";
  const sourceLabels = portedFrom.sources.map(s => SOURCE_LABELS[s]).join(" + ");
  const logos: HTMLElement[] = [];
  portedFrom.sources.forEach((source, i) => {
    if (i > 0) logos.push(el("span", { className: "plugin-attribution-plus", "aria-hidden": "true" }, "+"));
    logos.push(el("span", { className: `plugin-attribution-logo plugin-attribution-logo-${source}`, "aria-hidden": "true" }));
  });
  return el(
    "a",
    {
      className: "plugin-attribution",
      href: portedFrom.url,
      target: "_blank",
      rel: "noreferrer",
      title: t("plugins.portedFrom", { source: sourceLabels, original: portedFrom.originalName })
    },
    ...logos,
    el("span", { className: "plugin-attribution-plus", "aria-hidden": "true" }, "+"),
    el("span", { className: "plugin-attribution-logo plugin-attribution-logo-hyaecord", "aria-hidden": "true" }),
    el("span", { className: "plugin-attribution-label" }, t("plugins.portedFrom.short", { source: sourceLabels }))
  );
}

function pluginRow(plugin: PluginInfo): HTMLElement {
  const toggle = el("input", { type: "checkbox", className: "switch-input" }) as HTMLInputElement;
  toggle.checked = plugin.enabled;
  toggle.disabled = !!plugin.error;
  toggle.addEventListener("change", () =>
    void window.hyaecord.setPluginEnabled(plugin.id, toggle.checked).then(() => refreshPluginCommands())
  );

  const authors = plugin.authors.length ? t("plugins.by", { authors: plugin.authors.join(", ") }) : "";
  const header = el(
    "label",
    { className: "setting-row" },
    el("span", { className: "row-text" },
      el("span", { className: "row-label" }, plugin.name),
      el("span", { className: "row-description" }, plugin.description || authors),
      plugin.error ? el("span", { className: "row-description plugin-error" }, plugin.error) : "",
      portedFromBadge(plugin.portedFrom)
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
    icon("settings")
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
      el("button", { className: "btn ghost close", type: "button", "aria-label": t("settings.close"), onClick: close }, icon("x"))
    ),
    el("div", { className: "settings-scroll" },
      section("settings.section.accounts", accountsSection()),
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
        ),
        toggleRow("settings.developerMode", "settings.developerMode.description", s.developerMode, next =>
          void patchSettings({ developerMode: next })
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
      section("settings.section.voice", voiceVideoSection()),
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
      section("settings.section.support", starRepoButton()),
      section("settings.section.credits", creditsSection())
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
