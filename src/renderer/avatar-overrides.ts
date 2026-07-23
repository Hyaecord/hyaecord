/**
 * UserPFP (custom avatars) and UsrBG (custom banners) — community
 * databases keyed by Discord user ID, fetched once as a full map and
 * cached here rather than doing an IPC round trip per avatar rendered
 * (a message list can show dozens of avatars at once). Main process
 * returns an empty map when the corresponding integration is off, so
 * "off means off" holds all the way down to zero network requests.
 */

let pfpMap: Record<string, string> = {};
let bgMap: Record<string, string> = {};

export async function loadAvatarOverrides(): Promise<void> {
  const [pfp, bg] = await Promise.all([window.hyaecord.getUserPfpMap(), window.hyaecord.getUserBgMap()]);
  pfpMap = pfp;
  bgMap = bg;
}

export function getPfpOverride(userId: string): string | null {
  return pfpMap[userId] ?? null;
}

export function getBgOverride(userId: string): string | null {
  return bgMap[userId] ?? null;
}
