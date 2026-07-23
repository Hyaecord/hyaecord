import type { CommunityThemeTokens } from "@shared/types";
import { el, state } from "./ui";

/**
 * A miniature, live-rendered mock of the actual Hyaecord shell — rail dots,
 * a couple of channel rows, two placeholder messages — built from the same
 * kind of markup as the real UI and styled purely through CSS custom
 * properties scoped to this one element. Used by the Theme Store so a
 * preview shows what the theme will actually look like instead of a static
 * screenshot (which also can't be used at all here, since a real screenshot
 * would risk showing a real server's/DM's content). All names/messages
 * below are placeholder text, never live data.
 *
 * Deliberately self-contained (a handful of `tp-*` classes, no dependency
 * on the rest of the app's DOM) — the same approach (different class names,
 * `ap-*`) is now live on the marketing website's homepage as a "See it
 * before you install it" section, built independently since the website is
 * a static HTML/CSS site with no JS component system to share this file
 * with directly.
 */

const PLACEHOLDER_MESSAGES = [
  { name: "Nova", text: "gm hyaecord ✨" },
  { name: "Juniper", text: "this theme is so clean" }
];

const PLACEHOLDER_CHANNELS = ["general", "screenshots"];

const BASE_THEME_TOKENS: Record<"dark" | "light", CommunityThemeTokens> = {
  dark: {
    bgDeep: "#1e1f22",
    bgBase: "#25262a",
    bgRaise: "#2b2d31",
    bgHover: "#35373c",
    border: "#3f4249",
    text: "#f2f3f5",
    textDim: "#949ba4",
    accent: "#2dd4bf",
    accentStrong: "#5eead4",
    danger: "#fb5760"
  },
  light: {
    bgDeep: "#e3e5e8",
    bgBase: "#ffffff",
    bgRaise: "#f2f3f5",
    bgHover: "#e3e5e8",
    border: "#d4d7dc",
    text: "#060607",
    textDim: "#5c5e66",
    accent: "#115e59",
    accentStrong: "#0d4f4a",
    danger: "#a82231"
  }
};

/** "system" resolved against the OS preference — the same light/dark split every theme (built-in or community) is shown through. */
export function resolveMode(): "light" | "dark" {
  return state.settings.theme === "system" ? (state.prefersDark ? "dark" : "light") : state.settings.theme;
}

/** The built-in Light/Dark tokens for whichever mode is currently resolved — used for the "Default" preview card. */
export function resolveBaseThemeTokens(): CommunityThemeTokens {
  return BASE_THEME_TOKENS[resolveMode()];
}

const TOKEN_CSS_VARS: Record<keyof CommunityThemeTokens, string> = {
  bgDeep: "--tp-bg-deep",
  bgBase: "--tp-bg-base",
  bgRaise: "--tp-bg-raise",
  bgHover: "--tp-bg-hover",
  border: "--tp-border",
  text: "--tp-text",
  textDim: "--tp-text-dim",
  accent: "--tp-accent",
  accentStrong: "--tp-accent-strong",
  danger: "--tp-danger"
};

export function buildThemePreview(tokens: CommunityThemeTokens): HTMLElement {
  const rail = el(
    "div",
    { className: "tp-rail" },
    el("span", { className: "tp-dot tp-dot-accent" }),
    el("span", { className: "tp-dot" }),
    el("span", { className: "tp-dot" })
  );

  const channels = el(
    "div",
    { className: "tp-channels" },
    ...PLACEHOLDER_CHANNELS.map((name, i) =>
      el("div", { className: i === 0 ? "tp-channel is-active" : "tp-channel" }, `# ${name}`)
    )
  );

  const chat = el(
    "div",
    { className: "tp-chat" },
    ...PLACEHOLDER_MESSAGES.map((msg, i) =>
      el(
        "div",
        { className: "tp-msg" },
        el("span", { className: i === 0 ? "tp-avatar tp-avatar-accent" : "tp-avatar" }),
        el(
          "div",
          {},
          el("span", { className: "tp-author" }, msg.name),
          el("span", { className: "tp-text" }, msg.text)
        )
      )
    )
  );

  const preview = el("div", { className: "theme-preview" }, rail, el("div", { className: "tp-main" }, channels, chat));
  // Inline style="" attributes are blocked by this app's CSP (style-src
  // 'self', no unsafe-inline); per-property CSSOM sets like this aren't,
  // so each token becomes its own setProperty call rather than one string.
  for (const key of Object.keys(TOKEN_CSS_VARS) as Array<keyof CommunityThemeTokens>) {
    preview.style.setProperty(TOKEN_CSS_VARS[key], tokens[key]);
  }
  return preview;
}
