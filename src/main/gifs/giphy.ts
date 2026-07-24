import type { GifResult } from "@shared/types";

const API_BASE = "https://api.giphy.com/v1/gifs";

/**
 * Fallback GIF backend for when there's no logged-in Discord session to
 * proxy through (Discord's own `/gifs/search` needs a Discord token — see
 * discord/index.ts's searchGifs). Real Giphy v1 API, response shape
 * confirmed with a live `curl .../trending?api_key=...` rather than
 * guessed: `data[].images.original.{url,mp4,width,height}` is the
 * full-size rendition (used as the message content once picked — Discord
 * and Stoat both render a raw .gif URL as an image embed on their own),
 * `images.fixed_height` a smaller one better suited to the picker grid.
 *
 * Needs `GIPHY_API_KEY` in a local `.env` file (see env.ts) — never
 * hardcoded, since this is a personal, rate-limited (100 req/hour on the
 * free tier) key that shouldn't be committed to a public repo or shared
 * across every Hyaecord install.
 */

interface RawGiphyGif {
  id: string;
  title: string;
  images: {
    original: { url: string; mp4?: string; width: string; height: string };
    fixed_height: { url: string; width: string; height: string };
  };
}

interface RawGiphyResponse {
  data: RawGiphyGif[];
}

function toGifResult(raw: RawGiphyGif): GifResult {
  return {
    id: raw.id,
    url: raw.images.original.url,
    videoSrc: raw.images.original.mp4 ?? raw.images.original.url,
    width: Number(raw.images.fixed_height.width) || Number(raw.images.original.width),
    height: Number(raw.images.fixed_height.height) || Number(raw.images.original.height),
    title: raw.title
  };
}

export async function giphySearchGifs(query: string): Promise<GifResult[]> {
  const key = process.env.GIPHY_API_KEY;
  if (!key) return [];
  const endpoint = query.trim()
    ? `${API_BASE}/search?api_key=${key}&q=${encodeURIComponent(query.trim())}&limit=30&rating=pg-13`
    : `${API_BASE}/trending?api_key=${key}&limit=30&rating=pg-13`;
  try {
    const res = await fetch(endpoint);
    if (!res.ok) return [];
    const data = (await res.json()) as RawGiphyResponse;
    return data.data.map(toGifResult);
  } catch {
    return [];
  }
}
