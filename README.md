# Hyaecord

<p align="center">
  <a href="https://hyaecord.vercel.app">
    <img src="assets/branding/logo.svg" alt="Hyaecord Logo" width="128" height="128" />
  </a>
</p>

<p align="center">
  <em>A performance-focused, native-feeling Discord desktop client for Linux and Windows.</em>
</p>
<p align="center">
  <a href="LICENSE" style="text-decoration: none;"><img alt="License: GPLv3 (NC)" src="https://img.shields.io/badge/License-GPLv3_(NC)-f1e9d5?style=for-the-badge&logoColor=ffffff"></a>
  <img alt="GitHub Release" src="https://img.shields.io/github/v/release/hyaecord/hyaecord?include_prereleases&sort=date&display_name=release&style=for-the-badge&logo=github&logoColor=ffffff&color=%23e44550">
  <a href="https://hyaecord.vercel.app/discord" style="text-decoration: none;"><img alt="Discord" src="https://img.shields.io/discord/1529521295228928000?style=for-the-badge&logo=discord&logoColor=ffffff&color=c88633"></a>
</p>

Hyaecord is an original Discord desktop client that implements a
compatibility layer for the [Equicord](https://github.com/Equicord/Equicord)
and [Vencord](https://github.com/Vendicated/Vencord) plugin ecosystems,
alongside desktop-native visual integration, event-driven resource
management, and accessibility features. It is not a fork of either
codebase, and it does not include or redistribute Discord's proprietary
client code or assets.

You can join our [Discord server](https://hyaecord.vercel.app/discord) for
commits, changes, chatting, or support.

## Contents

- [Features](#features)
- [Feature Parity Checklist](#feature-parity-checklist)
- [Installation & Setup](#installation--setup)
- [Building from Source](#building-from-source)
- [Technical Specifications](#technical-specifications)
- [Contributing](#contributing)
- [Credits](#credits)
- [Star History](#star-history)
- [Disclaimer & Legal](#disclaimer--legal)
- [License](#license)

---

## Features

> Hyaecord is early alpha. The list below is deliberately honest about
> what's actually built versus still planned — see the
> [Feature Parity Checklist](#feature-parity-checklist) for the
> unvarnished per-feature status, updated as things ship rather than
> written up front and left stale.

### Multi-Platform

- **Stoat.chat support started**: a real, separate integration talking to Stoat's own public REST/WebSocket API (`api.stoat.chat`, `events.stoat.chat`) — not a guess, verified against Stoat's own published OpenAPI spec and protocol docs. Login (real embedded stoat.chat page, same trustworthy pattern as Discord's), server/channel listing, and plain-text messaging work today. Connect an account from Settings → Accounts; a "Merge accounts into one sidebar" toggle shows Discord and Stoat servers together, each with a small platform badge, or lets you view one platform at a time. Fluxer support is not started yet. See `BUILD_PROMPT.md` for exactly what's built vs. deliberately deferred (DMs, friends, reactions, voice, and more of Stoat's real feature set).

### Ecosystem & Plugins

- **A real plugin API**, sandboxed via Node `vm` with a restricted API surface — ergonomically modeled on Vencord's `definePlugin` shape so a simple message-hook plugin ports easily, but **not** a byte-compatible runner for existing Equicord/Vencord plugin files (those patch Discord's real webpack bundle, which this client's original GUI doesn't have). See [Plugin Guidelines](PLUGIN_GUIDELINES.md) and `src/main/plugins/` for exactly what's supported today.
- **Bundled plugins ported from Equicord/Vencord**: TalkInReverse, WriteUpperCase, Signature, and PolishWording (partial) are real, from-scratch reimplementations of those plugins' behaviour, each shown in Settings with a dual-logo attribution badge linking back to the original. See [PLUGIN_PARITY.md](PLUGIN_PARITY.md) for a full audit of Equicord's entire 361-plugin catalogue — what's ported, what's plausible, and what's architecturally impossible and why.
- **GlobalBadges, UserPFP, UsrBG, RPC Bridge**: all four are live, not just Settings toggles — real community-database avatar/banner overrides, and a real local Rich Presence socket for external apps. See the checklist below.
- **Plugin policy:** Strict no-paywall rule with support for creator donation links. See [Plugin Guidelines](PLUGIN_GUIDELINES.md).

### Desktop Integration & Visuals

- **Native OS look and feel:** Interfaces designed around GTK4/Libadwaita and KDE Plasma visual standards rather than generic web containers.
- **Automatic DE theme matching:** Auto-detects GNOME and KDE theme settings on launch, with support for manual overrides.
- **Theme Store:** WCAG AA-compliant Light and Dark themes built in, plus a growing set of community themes (each shipping both a light and dark version, no separate AMOLED mode) via the in-app Theme Store.
- **Real server banners:** Guild banners render as a full backdrop behind the server name instead of Discord's own tiny cropped sliver.
- **Platform icon integration:** Multi-resolution `.ico`, `.png`, and `.svg` branding assets for system tray and taskbar rendering.

### Performance & Behavior

- **Event-driven resource engine:** Replaces background polling loops with event listeners to minimize CPU and RAM usage — verified throughout (gateway heartbeats, Gaming Mode's `xprop -spy` watcher, no polling timers anywhere in the codebase).
- **Gaming Mode:** Event-driven fullscreen detection on X11/XWayland (no portable Wayland-native equivalent exists yet), keeping mention/DM/call notifications live while backgrounded.
- **Motion system:** A shared set of easing/duration CSS tokens used consistently across the app (hover states, hold-to-confirm fills, the channel-list proximity effect), zeroed out under `prefers-reduced-motion` or the in-app override. Not a FLIP-based reflow system — nothing in the client currently needs one.

### Accessibility & Utilities

- Screen reader support with semantic ARIA markup throughout.
- Keyboard-first navigation: focus trapping in modals, Escape handling, logical tab order.
- Independent text and UI scale controls.
- Native Chromium spellcheck and IME composition for non-Latin input — this comes from Electron/Chromium's own text-input handling, not custom Hyaecord code.

---

## Feature Parity Checklist

An honest status table, not an aspirational one — updated as features actually ship rather than written once and left stale:

| Feature                              |     Status      | Notes                                                                 |
| :------------------------------------ | :--------------: | :---------------------------------------------------------------------- |
| Sending/receiving messages, DMs       |    Supported     | REST + gateway, live message stream                                     |
| Server folders                        |    Supported     | Local to this client only — doesn't sync to Discord's real account settings |
| Member list                           |    Supported     | First 100 entries per channel, gateway lazy-loading protocol            |
| Profile popout, GlobalBadges          |    Supported     |                                                                           |
| GIF picker                            |    Supported     | Real Discord GIF search, not a separate Tenor integration               |
| Avatar upload                         |    Supported     |                                                                           |
| Native system tray & notifications    |    Supported     | Mentions and DMs only, suppressed while the window is focused           |
| Spellcheck & IME input                | Native (Chromium) | Free from Electron, not custom-built                                    |
| Message search                        |    Supported     | Finds a message and switches to its channel; doesn't jump to the exact message within that channel's history yet |
| Browsing a channel's pinned messages  |    Supported     | 📌 button by the chat header; real pins API, pin/unpin from the panel or a message's own context menu |
| Self-pin auto-fade                    |    Supported     | Other people's pin notices stay visible — no "hide others' pins" toggle exists yet |
| Joining a voice channel               |    Supported     | Real voice gateway handshake (join/leave, who's connected, live speaking indicators) — see the note below |
| Voice/video audio-video transport, screen share to a call, Go Live | Not yet built | Actually sending/receiving audio or video needs Discord's real media transport (UDP or WebRTC-to-SFU with exact SDP/codec handling plus end-to-end encryption) — a project of its own, not started. See `BUILD_PROMPT.md` |
| Camera / microphone / screen-source tests | Supported | Settings → Voice & Video — real device pickers with a genuine local preview (not connected to a call yet) |
| Push-to-talk                          |   Not yet built   | Depends on voice support above                                          |
| Emoji picker                          |    Supported     | Search-and-browse picker backed by real Unicode emoji data              |
| Sticker picker                        |    Supported     | Real standard sticker packs; Lottie (vector-animated) stickers send correctly but preview as a name-only tile, no animation |
| Friends list (add/accept/decline/block/remove) | Supported | Real relationships API; the friend/pending/blocked list itself is fetched fresh on open, not kept live |
| Friend online status                  |    Supported     | Real gateway PRESENCE_UPDATE tracking for friends (not guild members you haven't opened) — Online tab and status dots update live even while the list is open |
| Built-in text commands (`/shrug`, `/tableflip`, `/unflip`, `/me`) | Supported | Discord's own real built-in commands, reimplemented locally |
| Plugin-registered slash commands              |    Supported     | `api.registerCommand()`; merges into the same "/name" autocomplete as the built-ins above |
| Multi-account switching               |   Not yet built   |                                                                           |
| Auto-updater                          |   Not yet built   |                                                                           |
| Session import (Discord/Vesktop/Equibop) | Declined for now | Requires decrypting another app's local session storage — see `BUILD_PROMPT.md` for why this is a deliberate hold, not an oversight |
| UserPFP, UsrBG                        |    Supported     | Real community avatar/banner databases, applied wherever an avatar or the profile banner renders |
| RPC Bridge                            |    Supported     | Real local Discord-RPC-compatible socket server; verified against a live handshake + SET_ACTIVITY exchange |
| Equicord Cloud Saves                  |   Not yet built   |                                                                           |

---

## Installation & Setup

### Package Formats

Hyaecord supports standard Linux packaging:

- **Flatpak:** `flatpak install io.github.Hyaecord.Hyaecord` *(or build locally from the manifest in `flatpak/`)*
- **AppImage / `.deb` / `.rpm`:** Available on the [Releases page](https://github.com/hyaecord/hyaecord/releases)
- **AUR (Arch Linux):** `hyaecord-bin` or `hyaecord-git`

Windows builds are available on the Releases page as a secondary target
(see [Technical Specifications](#technical-specifications)).

### First-Run Wizard

On initial launch, Hyaecord opens a setup wizard to:

1. Detect your desktop environment and select matching default themes.
2. Log in with the real Discord login page (session import from Vesktop/Equibop/Discord is a placeholder step for now — see the [Feature Parity Checklist](#feature-parity-checklist)).
3. Configure optional features and privacy toggles in plain language.

---

## Building from Source

### Prerequisites

- [Node.js](https://nodejs.org/) (v18 or higher)
- `pnpm` (recommended) or `npm`
- C/C++ build tools (`build-essential`, `python3`, `pkg-config`, `libsecret-1-dev`)

### Quickstart

```bash
# Clone the repository
git clone https://github.com/hyaecord/hyaecord.git
cd hyaecord

# Install dependencies
pnpm install

# Run in development mode
pnpm dev

# Build production binaries
pnpm build
```

---

## Technical Specifications

- **Core Framework:** Electron, with an original client shell and GUI; plugin support is Hyaecord's own sandboxed API (`src/main/plugins/`), ergonomically modeled on [Equicord](https://github.com/Equicord/Equicord)/[Vencord](https://github.com/Vendicated/Vencord)'s `definePlugin` shape — not a byte-compatible runner for their actual plugin files, which rely on patching Discord's real webpack bundle that this client's original GUI doesn't have. See `PLUGIN_GUIDELINES.md` for exactly what that means for porting a plugin.
- **Target Platforms:** Linux (primary, v1), Windows (secondary).
- **Networking & Split-Tunneling:** Compatible with Mullvad's split tunneling — for the Flatpak build, `mullvad-exclude flatpak run io.github.Hyaecord.Hyaecord` (the app ID alone isn't the right syntax; `mullvad-exclude` wraps a command to run, and for Flatpak apps that command is `flatpak run <id>`).
- **Localization:** Externalized string bundles (`src/i18n/`) with RTL layout support.

---

## Contributing

Issues and pull requests are welcome on the
[main repository](https://github.com/hyaecord/hyaecord). Before submitting
a plugin, please read the [Plugin Guidelines](PLUGIN_GUIDELINES.md). For
anything involving the Hyaecord name or logo — including fork names and
custom builds — check the [Trademark Policy](TRADEMARK.md) first; forks
must be rebranded before public distribution.

---

## Credits

Thank you to the [Equicord](https://github.com/Equicord/Equicord) team and
to [Vendicated](https://github.com/Vendicated), creator of
[Vencord](https://github.com/Vendicated/Vencord), for designing and
maintaining the plugin API that Hyaecord's compatibility layer targets,
and for the plugin ecosystem that makes it worth targeting.

---

## Star History

<a href="https://star-history.com/#hyaecord/hyaecord&Timeline">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=hyaecord/hyaecord&type=Timeline&theme=dark" />
    <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/svg?repos=hyaecord/hyaecord&type=Timeline" />
    <img alt="Star History Chart" src="https://api.star-history.com/svg?repos=hyaecord/hyaecord&type=Timeline" />
  </picture>
</a>

---

## Disclaimer & Legal

- **Discord ToS:** Hyaecord is a third-party client modification. Using client modifications is against Discord's Terms of Service. Use at your own discretion.
- **Anti-abuse policy:** Hyaecord does not contain tools for automation, self-bots, spamming, or scraping. Features that enable disruptive or abusive behavior are strictly out of scope.
- **Branding & logo usage:** Hyaecord's source code is source-available under the [Hyaecord Public License](LICENSE) (GPL-3.0-derived, non-commercial), but the logo, mascot, and project branding are protected separately. See the [Trademark Policy](TRADEMARK.md).
- **Plugin guidelines:** Plugins must remain free of paywalls and subscription locks. See the [Plugin Guidelines](PLUGIN_GUIDELINES.md).
- **Trademarks:** "Discord" is a registered trademark of Discord Inc. Hyaecord is not affiliated with or endorsed by Discord Inc.

<details>
<summary>More about the Discord ToS risk</summary><br>

Client modifications are against Discord's Terms of Service.

In practice, Discord has historically been fairly indifferent about client
mods, and there are no widely known cases of users being banned solely for
using one. You should generally be fine as long as you avoid plugins that
implement abusive behavior. All plugins bundled by default with Hyaecord
are safe to use in this regard.

That said, if your account matters a lot to you and losing access would be
a serious problem, you should probably avoid client mods altogether — not
just Hyaecord, but any of them — to be safe. It's also a good idea to avoid
posting screenshots of Hyaecord in servers where that could get you banned.

</details>

---

## License

Hyaecord's source code is source-available under the
[Hyaecord Public License](LICENSE) — a GPL-3.0-derived license with two
conditions on top of the GPL: **no commercial use** (no selling, paywalling,
or charging access fees for the software, forks, or plugins; voluntary tips
and donations are fine) and **no closing the source** (forks and derivatives
must stay open and carry the same license terms).

For rules regarding logos, branding, and third-party extensions, see:

- [TRADEMARK.md](TRADEMARK.md) — Branding and trademark usage guidelines
- [PLUGIN_GUIDELINES.md](PLUGIN_GUIDELINES.md) — Extension rules and monetization policy
- [PLUGIN_PARITY.md](PLUGIN_PARITY.md) — Audit of Equicord/Vencord's plugin catalogue against what's feasible in Hyaecord's own plugin API
- [assets/branding/LICENSE.md](assets/branding/LICENSE.md) — Brand assets are **not** covered by the source license; all rights reserved
