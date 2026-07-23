const REGISTRY_URL =
  "https://raw.githubusercontent.com/Hyaecord/hyaecord/main/community-themes/registry.json";

const REQUIRED_TOKEN_KEYS = [
  "bgDeep", "bgBase", "bgRaise", "bgHover", "border",
  "text", "textDim", "accent", "accentStrong", "danger"
] as const;

type TokenSet = Record<(typeof REQUIRED_TOKEN_KEYS)[number], string>;

export interface CommunityTheme {
  id: string;
  name: string;
  author: string;
  light: TokenSet;
  dark: TokenSet;
}

const HEX_RE = /^#[0-9a-fA-F]{3,8}$/;

function isValidTokenSet(tokens: unknown): tokens is TokenSet {
  if (!tokens || typeof tokens !== "object") return false;
  const t = tokens as Record<string, unknown>;
  return REQUIRED_TOKEN_KEYS.every(key => typeof t[key] === "string" && HEX_RE.test(t[key] as string));
}

function isValidTheme(entry: unknown): entry is CommunityTheme {
  if (!entry || typeof entry !== "object") return false;
  const e = entry as Record<string, unknown>;
  if (typeof e.id !== "string" || typeof e.name !== "string" || typeof e.author !== "string") return false;
  return isValidTokenSet(e.light) && isValidTokenSet(e.dark);
}

/**
 * Fetches the community theme registry — a static JSON file on GitHub's raw
 * content CDN (community-themes/registry.json in the main repo). No custom
 * backend, no hosting cost. Every entry is validated defensively: a theme is
 * only ever twenty hex colour values (a light set and a dark set — every
 * theme ships both, there's no separate AMOLED mode), never CSS or code, so
 * the worst a bad registry entry can do is look ugly, not do anything unsafe.
 */
export async function fetchCommunityThemes(): Promise<CommunityTheme[]> {
  try {
    const res = await fetch(REGISTRY_URL);
    if (!res.ok) return [];
    const data = await res.json();
    if (!Array.isArray(data)) return [];
    return data.filter(isValidTheme);
  } catch {
    return [];
  }
}
