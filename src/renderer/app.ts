import type { HyaecordBridge } from "@shared/types";
import { applySettingsToDocument, showToast, state, t } from "./ui";
import { maybeShowWizard } from "./wizard";
import { mountSettingsButton } from "./settings-ui";
import { initSession } from "./session";
import { initModeratorView } from "./moderator";
import { loadAvatarOverrides } from "./avatar-overrides";
import { applyDirection } from "./rtl";

declare global {
  interface Window {
    hyaecord: HyaecordBridge;
  }
}

function renderChrome(): void {
  document.getElementById("server-header")!.textContent = t("app.name");
  const input = document.getElementById("composer-input") as HTMLInputElement;
  input.placeholder = t("shell.chat.placeholder");
}

async function init(): Promise<void> {
  const api = window.hyaecord;
  const [settings, de, locale, localeCode] = await Promise.all([
    api.getSettings(),
    api.getDesktopEnvironment(),
    api.getLocaleStrings(),
    api.getLocale()
  ]);

  state.settings = settings;
  state.prefersDark = de.prefersDark;
  state.strings = locale;

  applyDirection(localeCode);
  applySettingsToDocument();
  api.onThemeChanged(prefersDark => {
    state.prefersDark = prefersDark;
    applySettingsToDocument();
  });
  api.onGamingModeState(s => {
    state.gamingModeState = s;
  });
  api.onPluginToast(showToast);

  void loadAvatarOverrides();

  renderChrome();
  mountSettingsButton();
  initSession();
  initModeratorView();
  maybeShowWizard(de);
}

init().catch(err => console.error("[hyaecord] renderer init failed:", err));
