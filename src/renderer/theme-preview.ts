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
 * Deliberately self-contained (inline styles + a handful of `tp-*` classes,
 * no dependency on the rest of the app's DOM) so this same function's
 * output — or the equivalent markup/CSS — can be reused on the marketing
 * website for "what Hyaecord looks like" previews filled with their own
 * placeholder content. That's a website-repo task, not something this
 * repo's build can do directly.
 */

const PLACEHOLDER_MESSAGES = [
  { name: "Nova", text: "gm hyaecord ✨" },
  { name: "Juniper", text: "this theme is so clean" }
];

const PLACEHOLDER_CHANNELS = ["general", "screenshots"];

const BASE_THEME_TOKENS: Record<"dark" | "light" | "amoled", CommunityThemeTokens> = {
  dark: {
    bgDeep: "#16130e",
    bgBase: "#1c1812",
    bgRaise: "#241f16",
    bgHover: "#2d271c",
    border: "#3a3325",
    text: "#f2f3f5",
    textDim: "#949ba4",
    accent: "#e8a962",
    accentStrong: "#f5cc9f",
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
    accent: "#835000",
    accentStrong: "#653e05",
    danger: "#a82231"
  },
  amoled: {
    bgDeep: "#000000",
    bgBase: "#000000",
    bgRaise: "#0d0b07",
    bgHover: "#1a160e",
    border: "#2a2416",
    text: "#f2f3f5",
    textDim: "#949ba4",
    accent: "#e8a962",
    accentStrong: "#f5cc9f",
    danger: "#fb5760"
  }
};

/** The built-in Light/Dark/AMOLED tokens for whichever base theme is currently resolved — used for the "no override" preview card. */
export function resolveBaseThemeTokens(): CommunityThemeTokens {
  const resolved = state.settings.theme === "system" ? (state.prefersDark ? "dark" : "light") : state.settings.theme;
  return BASE_THEME_TOKENS[resolved as "dark" | "light" | "amoled"] ?? BASE_THEME_TOKENS.dark;
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
