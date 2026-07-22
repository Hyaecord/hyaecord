import type { DesktopEnvironmentInfo, ThemeId } from "@shared/types";
import { el, patchSettings, state, t, toggleRow, trapFocus } from "./ui";

/**
 * First-run wizard. Shown once (until firstRunCompleted is saved), collects
 * theme choice, built-in feature toggles, and the telemetry opt-out, and shows
 * the plain-language ToS disclosure. Everything is keyboard-navigable and the
 * chosen theme applies live so the user sees what they're picking.
 */

interface WizardChoices {
  theme: ThemeId;
  integrations: { userPFP: boolean; usrBG: boolean; globalBadges: boolean; rpcBridge: boolean };
  telemetryEnabled: boolean;
}

export function maybeShowWizard(de: DesktopEnvironmentInfo): void {
  if (state.settings.firstRunCompleted) return;

  const choices: WizardChoices = {
    theme: state.settings.theme,
    integrations: { ...state.settings.integrations },
    telemetryEnabled: state.settings.telemetry.enabled
  };

  let stepIndex = 0;

  const body = el("div", { className: "wizard-body" });
  const stepLabel = el("span", { className: "wizard-step-label", "aria-live": "polite" });
  const backBtn = el("button", { className: "btn ghost", type: "button", onClick: () => go(-1) }, t("wizard.back"));
  const nextBtn = el("button", { className: "btn primary", type: "button", onClick: () => go(1) });

  const dialog = el(
    "div",
    { className: "modal wizard", role: "dialog", "aria-modal": "true", "aria-labelledby": "wizard-title" },
    el("h1", { id: "wizard-title" }, t("wizard.title")),
    el("p", { className: "modal-subtitle" }, t("wizard.subtitle")),
    body,
    el("div", { className: "modal-footer" }, stepLabel, el("div", { className: "modal-actions" }, backBtn, nextBtn))
  );
  const overlay = el("div", { className: "overlay" }, dialog);

  const steps: Array<() => HTMLElement> = [themeStep, importStep, integrationsStep, telemetryStep, tosStep];

  function themeStep(): HTMLElement {
    const detectedKey =
      de.family === "gnome"
        ? "wizard.theme.detected.gnome"
        : de.family === "kde"
          ? "wizard.theme.detected.kde"
          : "wizard.theme.detected.other";
    const options: ThemeId[] = ["system", "light", "dark", "amoled"];
    const group = el("div", { className: "theme-options", role: "radiogroup", "aria-label": t("wizard.theme.title") });
    for (const theme of options) {
      const input = el("input", { type: "radio", name: "wizard-theme", value: theme }) as HTMLInputElement;
      input.checked = choices.theme === theme;
      input.addEventListener("change", () => {
        choices.theme = theme;
        state.settings = { ...state.settings, theme };
        document.body.dataset.theme =
          theme === "system" ? (state.prefersDark ? "dark" : "light") : theme;
      });
      group.append(
        el("label", { className: "theme-option", "data-theme-preview": theme }, input,
          el("span", {}, t(`settings.theme.${theme === "system" ? "system" : theme}`)))
      );
    }
    return el("section", {},
      el("h2", {}, t("wizard.theme.title")),
      el("p", { className: "step-hint" }, t(detectedKey)),
      group
    );
  }

  function importStep(): HTMLElement {
    return el("section", {},
      el("h2", {}, t("wizard.import.title")),
      el("p", {}, t("wizard.import.body")),
      el("p", { className: "step-hint" }, t("wizard.import.soon"))
    );
  }

  function integrationsStep(): HTMLElement {
    const section = el("section", {},
      el("h2", {}, t("wizard.integrations.title")),
      el("p", {}, t("wizard.integrations.body"))
    );
    const keys = ["userPFP", "usrBG", "globalBadges", "rpcBridge"] as const;
    for (const key of keys) {
      section.append(
        toggleRow(`feature.${key}`, `feature.${key}.description`, choices.integrations[key], next => {
          choices.integrations[key] = next;
        })
      );
    }
    return section;
  }

  function telemetryStep(): HTMLElement {
    return el("section", {},
      el("h2", {}, t("wizard.telemetry.title")),
      el("p", {}, t("wizard.telemetry.body")),
      toggleRow("wizard.telemetry.toggle", null, choices.telemetryEnabled, next => {
        choices.telemetryEnabled = next;
      })
    );
  }

  function tosStep(): HTMLElement {
    return el("section", {},
      el("h2", {}, t("wizard.tos.title")),
      el("p", {}, t("wizard.tos.body"))
    );
  }

  function render(): void {
    const step = steps[stepIndex];
    if (!step) return;
    body.replaceChildren(step());
    stepLabel.textContent = t("wizard.step", { current: stepIndex + 1, total: steps.length });
    backBtn.style.visibility = stepIndex === 0 ? "hidden" : "visible";
    nextBtn.textContent = stepIndex === steps.length - 1 ? t("wizard.finish") : t("wizard.continue");
    nextBtn.focus();
  }

  async function go(delta: number): Promise<void> {
    if (delta > 0 && stepIndex === steps.length - 1) {
      await patchSettings({
        firstRunCompleted: true,
        theme: choices.theme,
        integrations: choices.integrations,
        telemetry: { ...state.settings.telemetry, enabled: choices.telemetryEnabled }
      });
      cleanup();
      overlay.remove();
      return;
    }
    stepIndex = Math.min(steps.length - 1, Math.max(0, stepIndex + delta));
    render();
  }

  const cleanup = trapFocus(overlay);
  document.body.append(overlay);
  render();
}
