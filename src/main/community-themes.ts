const REGISTRY_URL =
  "https://raw.githubusercontent.com/Hyaecord/hyaecord/main/community-themes/registry.json";

const REQUIRED_TOKEN_KEYS = [
  "bgDeep", "bgBase", "bgRaise", "bgHover", "border",
  "text", "textDim", "accent", "accentStrong", "danger"
] as const;

export interface CommunityTheme {
  id: string;
  name: string;
  author: string;
  tokens: Record<(typeof REQUIRED_TOKEN_KEYS)[number], string>;
}

const HEX_RE = /^#[0-9a-fA-F]{3,8}$/;

function isValidTheme(entry: unknown): entry is CommunityTheme {
  if (!entry || typeof entry !== "object") return false;
  const e = entry as Record<string, unknown>;
  if (typeof e.id !== "string" || typeof e.name !== "string" || typeof e.author !== "string") return false;
  if (!e.tokens || typeof e.tokens !== "object") return false;
  const tokens = e.tokens as Record<string, unknown>;
  return REQUIRED_TOKEN_KEYS.every(key => typeof tokens[key] === "string" && HEX_RE.test(tokens[key] as string));
}

/**
 * Fetches the community theme registry — a static JSON file on GitHub's raw
 * content CDN (community-themes/registry.json in the main repo). No custom
 * backend, no hosting cost. Every entry is validated defensively: a theme is
 * only ever ten hex colour values, never CSS or code, so the worst a bad
 * registry entry can do is look ugly, not do anything unsafe.
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
