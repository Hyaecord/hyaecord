import type { HyaecordBridge, ThemeId } from "@shared/types";

declare global {
  interface Window {
    hyaecord: HyaecordBridge;
  }
}

let strings: Record<string, string> = {};

function t(key: string): string {
  return strings[key] ?? key;
}

function applyTheme(theme: ThemeId, prefersDark: boolean): void {
  const resolved = theme === "system" ? (prefersDark ? "dark" : "light") : theme;
  document.body.dataset.theme = resolved;
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

  strings = locale;

  document.documentElement.style.setProperty("--text-scale", String(settings.textScale));
  document.documentElement.style.setProperty("--ui-scale", String(settings.uiScale));
  if (settings.reducedMotion !== "system") {
    document.documentElement.dataset.reducedMotion = settings.reducedMotion;
  }

  applyTheme(settings.theme, de.prefersDark);
  api.onThemeChanged(prefersDark => applyTheme(settings.theme, prefersDark));

  renderPlaceholderShell();
}

init().catch(err => console.error("[hyaecord] renderer init failed:", err));
