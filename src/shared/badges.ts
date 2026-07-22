/**
 * Built-in profile badges, rendered by the GlobalBadges integration alongside
 * the badges it fetches from the GlobalBadges API (Vencord/Equicord
 * contributor badges etc.).
 *
 * Hyaecord adds its own badge on top of that set: "Hyaecord Contributor",
 * whose icon is simply the Hyaecord logo.
 */

export interface BadgeDefinition {
  id: string;
  /** i18n key for the badge tooltip/label */
  labelKey: string;
  /** Path to the badge icon, relative to the app root */
  icon: string;
  /**
   * Where the list of users holding this badge comes from.
   * "github-contributors" — everyone with a commit in the given repos.
   */
  source: { kind: "github-contributors"; repos: string[] };
}

export const HYAECORD_CONTRIBUTOR_BADGE: BadgeDefinition = {
  id: "hyaecord-contributor",
  labelKey: "badge.hyaecordContributor",
  icon: "assets/icons/hyaecord-64.png",
  source: {
    kind: "github-contributors",
    repos: ["Hyaecord/hyaecord", "Hyaecord/website"]
  }
};

export const BUILTIN_BADGES: readonly BadgeDefinition[] = [
  HYAECORD_CONTRIBUTOR_BADGE
];
