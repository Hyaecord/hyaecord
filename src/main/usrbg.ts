const API_URL = "https://usrbg.is-hardly.online/users";
const CACHE_TTL_MS = 30 * 60 * 1000;

interface UsrbgResponse {
  endpoint: string;
  bucket: string;
  prefix: string;
  users: Record<string, string>;
}

let cache: Record<string, string> | null = null;
let cacheFetchedAt = 0;
let inFlight: Promise<Record<string, string>> | null = null;

function isValidResponse(data: unknown): data is UsrbgResponse {
  if (!data || typeof data !== "object") return false;
  const d = data as Record<string, unknown>;
  if (typeof d.endpoint !== "string" || typeof d.bucket !== "string" || typeof d.prefix !== "string") return false;
  if (!d.users || typeof d.users !== "object") return false;
  return Object.values(d.users).every(v => typeof v === "string");
}

/**
 * UsrBG: a community database of custom profile *banners* (the Nitro-only
 * banner feature, for people without Nitro), keyed by Discord user ID.
 * Verified live by curling it directly — matches the real Vencord USRBG
 * plugin's implementation exactly: the API returns object-storage
 * metadata (endpoint/bucket/prefix) plus a map of user ID to a cache-
 * busting etag, and the actual image URL is built from those pieces
 * rather than being returned directly. Cached in memory for 30 minutes.
 */
export async function fetchUserBgMap(): Promise<Record<string, string>> {
  if (cache && Date.now() - cacheFetchedAt < CACHE_TTL_MS) return cache;
  if (inFlight) return inFlight;
  inFlight = (async () => {
    try {
      const res = await fetch(API_URL);
      if (!res.ok) return cache ?? {};
      const data = await res.json();
      if (!isValidResponse(data)) return cache ?? {};
      const map: Record<string, string> = {};
      for (const [userId, etag] of Object.entries(data.users)) {
        map[userId] = `${data.endpoint}/${data.bucket}/${data.prefix}${userId}?${etag}`;
      }
      cache = map;
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
