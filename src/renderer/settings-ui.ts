import type { ThemeId } from "@shared/types";
import { burstParticles, el, holdToggleRow, patchSettings, state, t, toggleRow, trapFocus } from "./ui";
import { renderRail } from "./session";

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
    { value: "dark", labelKey: "settings.theme.dark" },
    { value: "amoled", labelKey: "settings.theme.amoled" }
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
      section("settings.section.appearance",
        selectRow("settings.theme", themeOptions, s.theme, value => void patchSettings({ theme: value as ThemeId }))
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
        toggleRow("settings.selfPinFade", "settings.selfPinFade.description", s.selfPinFade.enabled, next =>
          void patchSettings({ selfPinFade: { ...state.settings.selfPinFade, enabled: next } })
        )
      ),
      section("settings.section.integrations",
        ...INTEGRATION_KEYS.map(key =>
          holdToggleRow(`feature.${key}`, `feature.${key}.description`, s.integrations[key], DISABLE_HOLD_MS, next =>
            void patchSettings({ integrations: { ...state.settings.integrations, [key]: next } })
          )
        )
      ),
      section("settings.section.privacy",
        toggleRow("settings.telemetry", "settings.telemetry.description", s.telemetry.enabled, next =>
          void patchSettings({ telemetry: { ...state.settings.telemetry, enabled: next } })
        )
      ),
      section("settings.section.chomper",
        el("p", { className: "row-description" }, t("settings.chomper.count", { count: s.chomper.hiddenGuildIds.length })),
        toggleRow("settings.chomper.showHidden", "settings.chomper.showHidden.description", s.chomper.showHidden, async next => {
          await patchSettings({ chomper: { ...state.settings.chomper, showHidden: next } });
          // Toggling the visibility override also flips the mute state of
          // every guild Chomper is tracking — showing them again means
          // un-muting, hiding them again re-mutes the same set.
          for (const guildId of state.settings.chomper.hiddenGuildIds) {
            void window.hyaecord.muteGuild(guildId, !next);
          }
          renderRail();
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
