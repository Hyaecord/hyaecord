# Hyaecord Trademark & Branding Policy

Hyaecord's source code is open-source under the GNU General Public License
v3.0 (GPL-3.0). **The Hyaecord name and brand assets are licensed separately
and are not covered by the GPL.** This document explains what that means in
practice.

## 1. What Is Covered

* The name **Hyaecord**, in text or stylized form, and confusingly similar
  variants (e.g. "Hyaecord+", "HyaeCord", "Hyae-cord").
* The official logo, app icon, mascot artwork, and all vector/raster brand
  assets under `assets/branding/`.
* The `org.hyaecord.Hyaecord` application identifier and associated visual
  identity (color palette, wordmark, splash screens).

## 2. Uses That Don't Require Permission

* **Unmodified redistribution.** Packaging and distributing *unmodified*
  Hyaecord builds (Flatpak, AUR, AppImage, `.deb`/`.rpm`, etc.), including
  under a different package name required by a repository's conventions
  (e.g. `hyaecord-bin` on the AUR), as long as the app itself is unmodified
  and clearly attributed.
* **Descriptive reference.** Naming or depicting Hyaecord in articles,
  videos, screenshots, comparisons, or discussions, provided this doesn't
  imply endorsement by the project.
* **Compatibility statements.** Stating that your plugin, theme, or tool is
  "compatible with Hyaecord" or "built for Hyaecord," provided your project
  name and branding remain clearly distinct from ours.

## 3. Uses That Require Written Permission

> **Relationship to the GPL:** Nothing in this policy limits the rights
> granted by the GPL-3.0 over Hyaecord's source code. You may always fork,
> modify, and redistribute the code. This policy governs only the Hyaecord
> **name and brand assets** — a fork never needs permission to exist, only
> to keep our branding. Rebranded forks need no permission at all.

* **Forks and derivative builds.** Any publicly distributed build that
  modifies Hyaecord's source code, configuration, or default branding beyond
  cosmetic theming — including custom builds, "debloated" variants, or
  region-specific forks — must be rebranded before distribution. This means:
  removing the Hyaecord name from the app title, replacing the logo/icon/
  splash assets, and using a distinct application identifier (not
  `org.hyaecord.Hyaecord`).
* **Implying affiliation.** Using Hyaecord's name, logo, or mascot in a way
  that suggests official endorsement, partnership, or sponsorship where
  none exists.
* **Commercial or promotional use.** Using Hyaecord branding on merchandise,
  in advertising, or in the name of a commercial product or service.

If you're unsure whether your use case needs permission, ask first — see
Section 5.

## 4. Code Attribution (Separate From Branding)

Porting plugins, features, or UI components from Hyaecord into another
project is permitted under GPL-3.0, provided you:

1. Keep the ported code open-source under GPL-3.0 (or a GPL-3.0-compatible
   license, per the terms of the GPL itself).
2. Give clear, visible credit to Hyaecord and the original authors in your
   project's documentation or about page.
3. Remove all Hyaecord branding assets (logo, wordmark, mascot, name) from
   the ported code and its packaging.

Code attribution and branding permission are independent: satisfying the
attribution requirement never grants a right to use Hyaecord's name or
logo, and vice versa.

## 5. Requesting Permission

To request permission for a fork name, logo variant, or any other branded
use not covered above, open a `branding-request` issue on the main
repository or contact the maintainers directly. Include:

* A short description of your project and how you intend to use the name
  or assets.
* Whether the use is commercial or non-commercial.
* A link to the project if it already exists.

We aim to respond to branding requests within a reasonable time; requests
that go unanswered are not implicitly approved.

## 6. Enforcement

Uses that violate this policy may be asked to rebrand or cease distribution.
Repeated or willful violations, or uses that risk confusing users about a
project's origin or safety, may be escalated to the relevant distribution
platform (e.g. Flathub, the AUR, app stores).
