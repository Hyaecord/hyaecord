Hyaecord — Build Prompt (for Claude Code)


This document is meant to be handed to Claude Code as a working brief. Decisions that were open in earlier drafts have been resolved where possible and marked below. Where something is still genuinely undecided, it's flagged [OPEN] — stop and ask rather than guessing.

How to use this doc

Build V1 scope first, in the order it's listed. Treat V2 / Later as backlog — don't implement unless explicitly asked to.
Anything marked [OPEN] is a real decision point, not a detail to improvise. Ask before building it.
Anything marked ⚠ verify is a technical claim (API shape, CLI syntax, platform behavior) that needs to be checked against current docs before being relied on in code — it may be stale or approximate.
Everything here is additive on top of standard Discord functionality (see the Feature Parity Checklist) — no core Discord feature should be lost while building the custom stuff.

Naming — resolved

Product name: Hyaecord (hyena family). This replaces the earlier placeholder "Felicord" everywhere — repo name, window title, .desktop file, package names, tray tooltip, first-run wizard copy, etc. If any scaffolding was already generated under the old name, it needs a global rename pass, not just a display-string swap (check package.json name, build config app IDs, icon filenames, and any hardcoded strings before assuming a find-and-replace caught everything).

This unblocks part of one previously-open item below (Flatpak app ID) but not all of it — see that entry.

Mascot design is still separate and still open (see below). A hyena mascot is a natural direction given the name, but that's a call for whoever's doing the visual design, not something to bake into the build.

Confirmed Tech Direction

Framework: Electron. **Hyaecord is a complete overhaul, not a literal fork of Equicord's codebase.** The client shell, GUI, resource management, and desktop integration are original work built from scratch. The one piece that deliberately mirrors Equicord is the plugin system: Hyaecord implements its own compatibility layer against the Equicord/Vencord plugin API so that **most** existing plugins run without modification. Full, guaranteed 1:1 compatibility with every plugin in both ecosystems is *not* a hard requirement — plugins that reach into Equicord/Vencord-specific internals, private APIs, or DOM structure that Hyaecord's original GUI doesn't replicate may need porting or may simply not work, and that's an acceptable tradeoff for the rebuild. Rationale for keeping the plugin API compatible at all: the existing Equicord/Vencord plugin ecosystem is large, and rebuilding that ecosystem from zero would be a much bigger undertaking than building a compatibility layer against an existing, well-understood plugin API.

Because the GUI is original rather than a themed pass over Equicord's DOM, expect a nonzero set of plugins — especially ones that patch specific UI components or rely on Equicord/Discord's stock class names and component tree — to need adaptation. Track this as a real category of work (a compatibility matrix / known-issues list), not an edge case to ignore.

Platforms:

Linux — primary, v1 target
Windows — planned, build OS-detection generically now so this doesn't require re-architecting later
macOS — not planned

System tray / taskbar icon: must show Hyaecord's actual branded icon (proper multi-resolution .ico/.png/.svg icon set per platform) from day one — not a placeholder or the default Electron window icon. This needs real icon assets wired into the packaging step early, not bolted on right before release. Icon assets need to exist under the new name before this ships — don't package placeholder or leftover Felicord-named files.

V1 Scope — build this first

Plugin compatibility layer — supports most Equicord (and by extension Vencord) plugins unmodified via a compatibility layer against the plugin API, not via reuse of Equicord's client code; Equicord Cloud Saves for settings sync. Maintain a known-issues/compatibility list for plugins that don't work out of the box.
Built-in integrations (not plugins): UserPFP, UsrBG, GlobalBadges, RPC Bridge.
Custom GUI base — server list → channel list → chat → member list, familiar structure, fully redesigned visuals and original DOM/component structure (not a CSS reskin of Discord's or Equicord's DOM). Native-OS-adjacent visual direction: lean on GTK4/Libadwaita and KDE Plasma for spacing/controls/system feel, but give Hyaecord-specific surfaces their own distinct identity.
Platform-native theming — auto-detect GNOME/KDE on first launch, default to matching theme, manual override in settings, graceful fallback elsewhere.
Built-in default themes — Light, Dark, AMOLED, meeting WCAG AA contrast as the baseline bar.
Server banner/icon rendering — give Discord's already-high-res uploads more visual room instead of the cropped stock display. ⚠ verify before hardcoding: current public write-ups of Discord's upload specs are inconsistent with each other (server banner upload target is variously reported as 960×540 vs. 1920×1080; free-tier file size cap is reported anywhere from 8MB to 10MB depending on source and date). Don't trust a blog post here — pull the actual behavior from Discord's own developer docs or by testing an upload directly, and record what you find so it doesn't need re-deriving later.
Performance core — fast startup, event-driven resource management (not polling), Gaming Mode (event-driven detection, focus-aware behavior across monitors, minimal always-on listener for mentions/DMs/calls).
Accessibility baseline — screen reader semantics/ARIA, full keyboard navigation, reduced-motion setting (respecting OS-level pref + in-app override), independent text/UI scaling, non-color-dependent notification cues.
Frictionless setup — Flatpak/AppImage/deb/rpm/AUR, no terminal required; first-run wizard (DE detection → theme, import existing Discord/Vesktop/Equibop login, plain-language explanation of opt-in features).
Feature parity checklist — verify nothing core is lost: search, pins, history, calls/screen share/go-live, spellcheck + non-Latin input, emoji/GIF/sticker picker, native notifications, tray/dock integration, multi-account, keybinds, auto-update, push-to-talk + device switching unaffected by Gaming Mode.
Legal/privacy/security basics — plain ToS disclosure (client mods violate Discord ToS; no observed ban pattern for mod use — ⚠ verify this is still accurate before publishing), trademark disclaimer, no telemetry by default, basic plugin sandboxing/permission boundaries where feasible.
Motion/animation system — one shared set of easing curves/durations (FLIP-style reflow for scrollable views), GPU-accelerated (transform/opacity), fully respects reduced-motion.
Pinned-message cleanup — self-pin fades after ~10s (configurable), other-user pins auto-hidden client-side, smooth reflow (no layout jump), setting to disable.
Auto-update — resilient to failed/interrupted updates, falls back to last known-good version.
Disable-built-in-feature confirmation modal — for UserPFP/UsrBG/GlobalBadges/RPC Bridge toggles.
Localization scaffolding — all UI strings externalized from the start, English-complete, fallback-to-English for missing strings, RTL-aware base layout — even if only English ships translated at launch.

Website — separate repo, build alongside V1

The project website lives in its own repository under the Hyaecord GitHub organisation: Hyaecord/website. It is deployed on Vercel at https://hyaecord.vercel.app (custom domain may come later — don't hardcode the vercel.app hostname anywhere that's painful to change).

Requirements:

Landing page — static, fast, no framework required. Presents the project (name, logo, tagline, feature highlights), links to the GitHub org/repo, downloads/releases, and the Discord server. Uses the branding assets from the main repo (assets/branding/), keeps to the brand palette already used in the README badges (cream #f1e9d5, red #e44550, amber #c88633), respects prefers-color-scheme and prefers-reduced-motion — the accessibility bar for the client applies to the website too.
/discord redirect — https://hyaecord.vercel.app/discord must redirect to the Discord server. The invite URL is NOT hardcoded: a Vercel serverless function fetches the server widget at request time (https://discord.com/api/guilds/1529521295228928000/widget.json, server ID 1529521295228928000) and 302-redirects to its instant_invite field, so the link keeps working if the widget invite rotates. Hardcode the last-known invite only as a fallback for when the widget fetch fails. Requires the server widget to stay enabled in Discord server settings — note this in the website README.
All links in the main repo (README badges, "join our Discord" copy) point at https://hyaecord.vercel.app/discord, never at a raw discord.gg invite, so the invite can rotate without touching the main repo.

V2 / Later — don't build yet

Theme Store (Themes / Layouts / Catboxes, including the "Discord Vanilla" catbox) and its moderation/review pipeline
Stat integrations beyond the first three (Steam, RetroAchievements, Last.fm) — build the generic "stat provider" framework, but validate it against these three before calling it done; Trakt/AniList/osu!/Strava/Chess.com etc. are backlog
Sponsorship nudge popups
Beta/canary release channel
Community translation contribution pipeline (Crowdin/Weblate-style) — the scaffolding is V1, the actual pipeline is V2
Credits screen with scroll/reveal animation
Section 27 ideas (custom notification sounds, DND scheduling, local search indexing, keybind customization UI, draft sync) — none of these are committed scope, revisit after V1 ships
A published plugin compatibility matrix / known-issues tracker for plugins that don't run cleanly under the new GUI — start the list in V1 as issues surface, but a polished public-facing version is V2

Explicitly Out of Scope

macOS support
Nintendo Switch client — if this ever happens, it's a separate, much smaller companion app (rich presence / lightweight chat only), not a port of Hyaecord itself. Native Electron/Chromium apps don't run on Switch homebrew at all.
Anything that automates actions, spams, or otherwise crosses from "cosmetic/QoL" into abusive-behavior territory — this is the one thing that meaningfully raises real ToS risk
Reusing Equicord's client codebase wholesale — the GUI and internals are being rebuilt; only the plugin API surface is intentionally kept compatible

Still Open — resolve before touching the relevant feature

[OPEN] Final product name — resolved: Hyaecord
[OPEN] Mascot name/visual design (logo being made separately by project owner) — hyena-themed is the obvious lane given the name, but not decided or built yet
[OPEN] VPN providers to support beyond Mullvad (ProtonVPN, NordVPN, WireGuard-based setups) — prioritize by overlap with the Discord-modding userbase
[OPEN] Theme Store moderation model (maintainer-reviewed vs. community-voted vs. hybrid) — decide once V2 starts
[OPEN] Whether the self-pin auto-fade should have a brief "undo" window before disappearing
[OPEN] Flatpak app ID / .desktop command — the product name is now locked, which unblocks picking an ID (e.g. reverse-DNS style, something like org.hyaecord.Hyaecord, pending confirmation of who/what owns the domain or namespace this actually publishes under). Still open: the mullvad-exclude command syntax needs to be re-verified against whatever ID is finalized, since it's currently written against Equibop's — don't assume the syntax carries over 1:1 just because the ID pattern is similar.
[OPEN] Scope and format of the plugin compatibility/known-issues list — how it's tracked during V1 (issue labels vs. a doc) and what "supported" vs. "unsupported" means precisely, given the GUI is original rather than reused

⚠ Claims to verify before relying on in code

Exact Steam Web API (ISteamUserStats/GetPlayerAchievements) and RetroAchievements API request/response shapes
mullvad-exclude command syntax and how it adapts to Hyaecord's own Flatpak ID (currently written against Equibop's, and the ID itself isn't finalized yet — see above)
Discord's current upload-size recommendations for banners/icons/emoji — public sources on this disagree with each other as of writing (see item 6 above); go to primary sources, not aggregator blog posts
Current accuracy of "no observed ban pattern for client mod use" before it goes in any public-facing FAQ
Which specific Equicord/Vencord plugin API surfaces (patch points, context menus, message/component injection hooks) the original GUI needs to expose identically for compatibility to hold in practice — this needs to be enumerated against Hyaecord's actual component tree, not assumed from Equicord's

Reference: full original brief

The complete, unabbreviated project brief (all 27 sections plus research notes) is preserved separately — this document is the condensed, build-ordered version of it for Claude Code to work from. If Claude Code needs the full rationale/detail behind any V1 item, ask and the source section can be provided.
