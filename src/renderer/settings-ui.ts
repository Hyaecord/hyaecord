import type { ThemeId } from "@shared/types";
import { el, patchSettings, state, t, toggleRow, trapFocus } from "./ui";

/**
 * Settings panel (modal). Every control applies live via patchSettings.
 * Turning a built-in feature off goes through the confirmation modal
 * required by the brief; turning one on never asks.
 */

const INTEGRATION_KEYS = ["userPFP", "usrBG", "globalBadges", "rpcBridge"] as const;

export function mountSettingsButton(): void {
  const rail = document.getElementById("server-rail")!;
  const button = el(
    "button",
    { className: "settings-button", type: "button", "aria-label": t("settings.open"), title: t("settings.title"), onClick: openSettings },
    "⚙"
  );
  rail.append(button);
}

/** Ask before disabling a built-in feature; resolves true if the user confirms. */
function confirmDisable(featureKey: (typeof INTEGRATION_KEYS)[number]): Promise<boolean> {
  return new Promise(resolve => {
    const close = (confirmed: boolean) => {
      cleanup();
      overlay.remove();
      resolve(confirmed);
    };
    const dialog = el(
      "div",
      { className: "modal confirm", role: "alertdialog", "aria-modal": "true", "aria-labelledby": "confirm-title" },
      el("h2", { id: "confirm-title" }, t("settings.disableFeature.title", { feature: t(`feature.${featureKey}`) })),
      el("p", {}, t("settings.disableFeature.body")),
      el("div", { className: "modal-actions" },
        el("button", { className: "btn ghost", type: "button", onClick: () => close(false) }, t("settings.disableFeature.cancel")),
        el("button", { className: "btn danger", type: "button", onClick: () => close(true) }, t("settings.disableFeature.confirm"))
      )
    );
    const overlay = el("div", { className: "overlay" }, dialog);
    overlay.addEventListener("keydown", ev => {
      if (ev.key === "Escape") close(false);
    });
    const cleanup = trapFocus(overlay);
    document.body.append(overlay);
    (dialog.querySelector("button") as HTMLButtonElement).focus();
  });
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
          toggleRow(`feature.${key}`, `feature.${key}.description`, s.integrations[key], async next => {
            if (!next && !(await confirmDisable(key))) return false;
            await patchSettings({ integrations: { ...state.settings.integrations, [key]: next } });
          })
        )
      ),
      section("settings.section.privacy",
        toggleRow("settings.telemetry", "settings.telemetry.description", s.telemetry.enabled, next =>
          void patchSettings({ telemetry: { ...state.settings.telemetry, enabled: next } })
        )
      )
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
