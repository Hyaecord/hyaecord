const DATA_URL = "https://userpfp.github.io/UserPFP/source/data.json";
const CACHE_TTL_MS = 30 * 60 * 1000;

let cache: Record<string, string> | null = null;
let cacheFetchedAt = 0;
let inFlight: Promise<Record<string, string>> | null = null;

function isValidResponse(data: unknown): data is { avatars: Record<string, string> } {
  if (!data || typeof data !== "object") return false;
  const avatars = (data as { avatars?: unknown }).avatars;
  if (!avatars || typeof avatars !== "object") return false;
  return Object.values(avatars).every(v => typeof v === "string");
}

/**
 * UserPFP: a community database of custom "profile pictures" (mostly
 * animated, letting people have a Nitro-like avatar without Nitro),
 * keyed by Discord user ID. Verified live and working by curling it
 * directly rather than trusting the plugin's own docs page (which
 * doesn't actually state the endpoint) — the real source is the
 * Vencord-plugin implementation: a single JSON file, refetched at most
 * every 30 minutes and cached in memory between requests.
 */
export async function fetchUserPfpMap(): Promise<Record<string, string>> {
  if (cache && Date.now() - cacheFetchedAt < CACHE_TTL_MS) return cache;
  if (inFlight) return inFlight;
  inFlight = (async () => {
    try {
      const res = await fetch(DATA_URL);
      if (!res.ok) return cache ?? {};
      const data = await res.json();
      if (!isValidResponse(data)) return cache ?? {};
      cache = data.avatars;
      cacheFetchedAt = Date.now();
      return cache;
    } catch {
      return cache ?? {};
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}
