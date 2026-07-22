import type { HyaecordBridge } from "@shared/types";
import { applySettingsToDocument, state, t } from "./ui";
import { maybeShowWizard } from "./wizard";
import { mountSettingsButton } from "./settings-ui";

declare global {
  interface Window {
    hyaecord: HyaecordBridge;
  }
}

function renderPlaceholderShell(): void {
  const rail = document.getElementById("server-rail")!;
  for (let i = 0; i < 3; i++) {
    const pill = document.createElement("div");
    pill.className = "server-pill";
    pill.setAttribute("role", "button");
    pill.tabIndex = 0;
    rail.appendChild(pill);
  }

  document.getElementById("server-header")!.textContent = t("app.name");
  document.getElementById("chat-header")!.textContent = t("shell.status.connecting");

  const channels = document.getElementById("channels")!;
  for (const name of ["general", "development", "support"]) {
    const li = document.createElement("li");
    li.textContent = `# ${name}`;
    li.tabIndex = 0;
    channels.appendChild(li);
  }
  channels.firstElementChild?.setAttribute("aria-current", "true");

  const input = document.getElementById("composer-input") as HTMLInputElement;
  input.placeholder = t("shell.chat.placeholder");
}

async function init(): Promise<void> {
  const api = window.hyaecord;
  const [settings, de, locale] = await Promise.all([
    api.getSettings(),
    api.getDesktopEnvironment(),
    api.getLocaleStrings()
  ]);

  state.settings = settings;
  state.prefersDark = de.prefersDark;
  state.strings = locale;

  applySettingsToDocument();
  api.onThemeChanged(prefersDark => {
    state.prefersDark = prefersDark;
    applySettingsToDocument();
  });

  renderPlaceholderShell();
  mountSettingsButton();
  maybeShowWizard(de);
}

init().catch(err => console.error("[hyaecord] renderer init failed:", err));
