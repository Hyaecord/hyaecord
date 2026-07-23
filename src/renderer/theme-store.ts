import type { CommunityTheme } from "@shared/types";
import { el, patchSettings, showToast, state, t, trapFocus } from "./ui";
import { buildThemePreview, resolveBaseThemeTokens, resolveMode } from "./theme-preview";

const ISSUE_TEMPLATE_URL =
  "https://github.com/Hyaecord/hyaecord/issues/new?template=theme_submission.yml";
const DISCORD_URL = "https://hyaecord.vercel.app/discord";

/**
 * The Theme Store: fetches community-themes/registry.json (via the main
 * process, so no CSP headaches) and lets the user apply one. A theme is
 * only ever two sets of ten colour values (light + dark — see
 * COMMUNITY_TOKEN_PROPS in ui.ts), so there's no code-execution surface
 * here, just a palette swap. The existing light/dark/system setting picks
 * which of the two sets actually applies; there's no separate AMOLED mode.
 */
export function openThemeStore(): void {
  const close = () => {
    cleanup();
    overlay.remove();
  };

  const list = el("div", { className: "theme-store-list" }, el("p", { className: "step-hint" }, t("themeStore.loading")));

  const dialog = el(
    "div",
    { className: "modal theme-store", role: "dialog", "aria-modal": "true", "aria-labelledby": "theme-store-title" },
    el("div", { className: "settings-header" },
      el("h1", { id: "theme-store-title" }, t("themeStore.title")),
      el("button", { className: "btn ghost close", type: "button", "aria-label": t("settings.close"), onClick: close }, "✕")
    ),
    el("p", { className: "modal-subtitle" }, t("themeStore.subtitle")),
    list,
    el("div", { className: "theme-store-footer" },
      el("p", { className: "step-hint" }, t("themeStore.submit.body")),
      el("div", { className: "modal-actions" },
        el("button", {
          className: "btn primary",
          type: "button",
          onClick: () => void window.hyaecord.openExternal(ISSUE_TEMPLATE_URL)
        }, t("themeStore.submit.issue")),
        el("button", {
          className: "btn",
          type: "button",
          onClick: () => void window.hyaecord.openExternal(DISCORD_URL)
        }, t("themeStore.submit.discord"))
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

  void window.hyaecord.getCommunityThemes().then(themes => renderList(list, themes));
}

function renderList(container: HTMLElement, themes: CommunityTheme[]): void {
  container.replaceChildren();

  const noneCard = themeCard(null);
  container.append(noneCard);

  if (themes.length === 0) {
    container.append(el("p", { className: "step-hint" }, t("themeStore.empty")));
    return;
  }
  for (const theme of themes) container.append(themeCard(theme));
}

function themeCard(theme: CommunityTheme | null): HTMLElement {
  const isActive = theme ? state.settings.communityTheme?.id === theme.id : !state.settings.communityTheme;
  const preview = buildThemePreview(theme ? theme[resolveMode()] : resolveBaseThemeTokens());

  const button = el(
    "button",
    {
      type: "button",
      className: isActive ? "theme-card is-active" : "theme-card",
      onClick: () => void applyTheme(theme)
    },
    preview,
    el("span", { className: "theme-card-name" }, theme ? theme.name : t("themeStore.none")),
    theme ? el("span", { className: "theme-card-author" }, t("themeStore.byAuthor", { author: theme.author })) : ""
  );
  return button;
}

async function applyTheme(theme: CommunityTheme | null): Promise<void> {
  await patchSettings({ communityTheme: theme });
  showToast(theme ? t("themeStore.applied", { name: theme.name }) : t("themeStore.reverted"));
  document.querySelectorAll<HTMLElement>(".theme-card").forEach(card => card.classList.remove("is-active"));
  const active = [...document.querySelectorAll<HTMLElement>(".theme-card")].find(
    card => card.querySelector(".theme-card-name")?.textContent === (theme ? theme.name : t("themeStore.none"))
  );
  active?.classList.add("is-active");
}
