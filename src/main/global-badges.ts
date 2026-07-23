const BADGES_URL = "https://badges.vencord.dev/badges.json";
const CACHE_TTL_MS = 30 * 60 * 1000;

export interface GlobalBadge {
  icon: string;
  tooltip: string;
}

type BadgesResponse = Record<string, Array<{ badge: string; tooltip: string }>>;

let cache: BadgesResponse | null = null;
let cacheFetchedAt = 0;
let inFlight: Promise<BadgesResponse | null> | null = null;

function isValidResponse(data: unknown): data is BadgesResponse {
  if (!data || typeof data !== "object") return false;
  return Object.values(data as Record<string, unknown>).every(
    entries =>
      Array.isArray(entries) &&
      entries.every(
        e => e && typeof e === "object" && typeof (e as { badge?: unknown }).badge === "string" && typeof (e as { tooltip?: unknown }).tooltip === "string"
      )
  );
}

async function loadCache(): Promise<BadgesResponse | null> {
  if (cache && Date.now() - cacheFetchedAt < CACHE_TTL_MS) return cache;
  if (inFlight) return inFlight;
  inFlight = (async () => {
    try {
      const res = await fetch(BADGES_URL);
      if (!res.ok) return cache;
      const data = await res.json();
      if (!isValidResponse(data)) return cache;
      cache = data;
      cacheFetchedAt = Date.now();
      return cache;
    } catch {
      return cache;
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

/**
 * Vencord's real, publicly documented-by-code (not officially documented,
 * but a live, working, widely-relied-on endpoint every GlobalBadges-style
 * plugin uses) contributor/donor badge feed: a single JSON file, keyed by
 * Discord user ID, refetched at most every 30 minutes and cached in memory
 * between requests rather than re-fetched per profile view.
 */
export async function fetchGlobalBadges(userId: string): Promise<GlobalBadge[]> {
  const data = await loadCache();
  const entries = data?.[userId];
  if (!entries) return [];
  return entries.map(e => ({ icon: e.badge, tooltip: e.tooltip }));
}
