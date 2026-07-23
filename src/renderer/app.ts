import type { HyaecordBridge } from "@shared/types";
import { applySettingsToDocument, showToast, state, t } from "./ui";
import { maybeShowWizard } from "./wizard";
import { mountSettingsButton } from "./settings-ui";
import { initSession } from "./session";
import { initModeratorView } from "./moderator";
import { loadAvatarOverrides } from "./avatar-overrides";
import { applyDirection } from "./rtl";
import { refreshPluginCommands } from "./slash-commands";
import { icon, type IconName } from "./icons";

declare global {
  interface Window {
    hyaecord: HyaecordBridge;
  }
}

function renderChrome(): void {
  document.getElementById("server-header")!.textContent = t("app.name");
  const input = document.getElementById("composer-input") as HTMLInputElement;
  input.placeholder = t("shell.chat.placeholder");

  // Static HTML buttons that previously held an emoji character as a
  // makeshift icon — swapped for the real SVG icon set (icons.ts) here
  // since these specific buttons live in index.html, not built dynamically.
  const iconButtons: Array<[string, IconName]> = [
    ["message-search-button", "search"],
    ["pins-button", "pin"],
    ["silent-toggle-button", "bell-off"],
    ["emoji-picker-button", "smile"],
    ["sticker-picker-button", "tag"]
  ];
  for (const [id, name] of iconButtons) {
    const button = document.getElementById(id);
    button?.replaceChildren(icon(name));
  }
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
  void refreshPluginCommands();

  renderChrome();
  mountSettingsButton();
  initSession();
  initModeratorView();
  maybeShowWizard(de);
}

init().catch(err => console.error("[hyaecord] renderer init failed:", err));
