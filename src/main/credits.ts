/**
 * Real GitHub contributor data for the in-app Credits section (Settings)
 * — `GET /repos/{owner}/{repo}/contributors`, GitHub's own public REST
 * API, unauthenticated (works fine for a public repo, same 60 req/hour
 * per-IP limit any anonymous caller gets — acceptable for a value that's
 * cached for the whole process lifetime, same pattern GlobalBadges
 * already uses for its own slow-moving feed). GitHub's API only ever
 * gives a GitHub avatar/profile — there's no way to source someone's
 * Discord avatar from it, so that's honestly all this shows; not every
 * contributor uses the same picture everywhere, and this app has no
 * general way to look up "this GitHub user's Discord avatar" for anyone
 * who hasn't explicitly linked one.
 */

interface RawContributor {
  login: string;
  avatar_url: string;
  html_url: string;
  contributions: number;
  type: string;
}

export interface CreditsContributor {
  username: string;
  avatarUrl: string;
  profileUrl: string;
  contributions: number;
}

const REPO = "Hyaecord/hyaecord";
const CACHE_MS = 30 * 60 * 1000;

let cached: CreditsContributor[] | null = null;
let cachedAt = 0;

export async function getHyaecordContributors(): Promise<CreditsContributor[]> {
  if (cached && Date.now() - cachedAt < CACHE_MS) return cached;
  try {
    const res = await fetch(`https://api.github.com/repos/${REPO}/contributors?per_page=50`, {
      headers: { accept: "application/vnd.github+json" }
    });
    if (!res.ok) return cached ?? [];
    const raw = (await res.json()) as RawContributor[];
    cached = raw
      .filter(c => c.type === "User")
      .map(c => ({ username: c.login, avatarUrl: c.avatar_url, profileUrl: c.html_url, contributions: c.contributions }));
    cachedAt = Date.now();
    return cached;
  } catch {
    return cached ?? [];
  }
}
