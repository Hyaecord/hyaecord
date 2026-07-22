# Hyaecord

<p align="center">
  <a href="https://hyraecord.vercel.app">
    <img src="assets/branding/logo.svg" alt="Hyaecord Logo" width="128" height="128" />
  </a>
</p>

<p align="center">
  <em>A performance-focused, native-feeling Discord desktop client for Linux and Windows.</em>
</p>

<p align="center">
  <img alt="GitHub License" src="https://img.shields.io/github/license/hyaecord/hyaecord?style=for-the-badge&logoColor=ffffff&color=f1e9d5">
  <img alt="GitHub Release" src="https://img.shields.io/github/v/release/hyaecord/hyaecord?include_prereleases&sort=date&display_name=release&style=for-the-badge&logo=github&logoColor=ffffff&color=%23e44550">
  <a href="PLUGIN_GUIDELINES.md">
  <img alt="Discord" src="https://img.shields.io/discord/1529521295228928000?style=for-the-badge&logo=discord&logoColor=ffffff&color=c88633&link=https%3A%2F%2Fhyaecord.vercel.app%2Fdiscord">

</p>

Hyaecord is a fork of [Equicord](https://github.com/Equicord/Equicord) that
offers full Vencord and Equicord plugin ecosystem compatibility alongside
desktop-native visual integration, event-driven resource management, and
accessibility features.

You can join our [Discord server](https://hyaecord.vercel.app/discord) for
commits, changes, chatting, or support.
*(Replace this link and the badge above with your project's real
server invite and Discord server ID before publishing.)*

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

### Ecosystem & Plugins

- **Full Equicord & Vencord compatibility:** Load standard plugin ecosystems natively without extra wrappers.
- **Equicord Cloud Saves:** Synchronize client settings and plugin configurations across devices.
- **Integrated extensions:** Built-in support for UserPFP, UsrBG, GlobalBadges, and RPC Bridge.
- **Plugin policy:** Strict no-paywall rule with support for creator donation links. See [Plugin Guidelines](PLUGIN_GUIDELINES.md).

### Desktop Integration & Visuals

- **Native OS look and feel:** Interfaces designed around GTK4/Libadwaita and KDE Plasma visual standards rather than generic web containers.
- **Automatic DE theme matching:** Auto-detects GNOME and KDE theme settings on launch, with support for manual overrides.
- **Stock accessible themes:** Bundles WCAG AA-compliant Light, Dark, and AMOLED themes.
- **Expanded media rendering:** Server banners and icons render at full source resolution without stock crop masks.
- **Platform icon integration:** Multi-resolution `.ico`, `.png`, and `.svg` branding assets for system tray and taskbar rendering.

### Performance & Behavior

- **Event-driven resource engine:** Replaces background polling loops with event listeners to minimize CPU and RAM usage.
- **Gaming Mode:** Focus-aware background monitoring across multi-monitor setups. Minimizes client resource consumption during gameplay while preserving mentions, DMs, voice calls, and Push-To-Talk (PTT).
- **Motion system:** GPU-accelerated FLIP layout animations that respect system and client reduced-motion preferences.
- **Auto-fading self-pins:** Client-side cleanup that fades self-pinned messages after ~10 seconds with smooth layout reflow.

### Accessibility & Utilities

- Screen reader support with semantic ARIA markup.
- Keyboard-first navigation across all client surfaces.
- Independent text and UI scale controls.
- Non-color-dependent notification cues.
- Resilient auto-updater with fallback to the last known-good build on failure.

---

## Feature Parity Checklist

Hyaecord maintains full functional parity with stock client operations:

| Feature                          | Status    | Notes                                  |
| :-------------------------------- | :-------: | :-------------------------------------- |
| Search & Pinned Messages          | Supported | Includes auto-fade for self-pins        |
| Voice, Video, Screen Share & Go-Live | Supported | WebRTC stack                         |
| Push-To-Talk (PTT)                | Supported | Operates uninterrupted under Gaming Mode |
| Spellcheck & Input Methods        | Supported | Non-Latin IME input supported           |
| Emoji, GIF & Sticker Pickers       | Supported | Standard picker support                 |
| Multi-Account Switching           | Supported | Fast account toggle menu                |
| Native System Tray & Notifications | Supported | Native OS notification bridge          |

---

## Installation & Setup

### Package Formats

Hyaecord supports standard Linux packaging:

- **Flatpak:** `flatpak install org.hyaecord.Hyaecord` *(or build locally from manifest)*
- **AppImage / `.deb` / `.rpm`:** Available on the [Releases page](https://github.com/hyaecord/hyaecord/releases)
- **AUR (Arch Linux):** `hyaecord-bin` or `hyaecord-git`

Windows builds are available on the Releases page as a secondary target
(see [Technical Specifications](#technical-specifications)).

### First-Run Wizard

On initial launch, Hyaecord opens a setup wizard to:

1. Detect your desktop environment and select matching default themes.
2. Import existing session tokens and settings from Vesktop, Equibop, or Discord.
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

- **Core Framework:** Electron (forked from [Equicord](https://github.com/Equicord/Equicord)).
- **Target Platforms:** Linux (primary, v1), Windows (secondary).
- **Networking & Split-Tunneling:** Compatible with `mullvad-exclude` using application ID `org.hyaecord.Hyaecord`.
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

Thank you to the [Equicord](https://github.com/Equicord/Equicord) team for
the fork base Hyaecord builds on, and to
[Vendicated](https://github.com/Vendicated) for creating
[Vencord](https://github.com/Vendicated/Vencord), which Equicord — and by
extension Hyaecord — is itself built on top of.

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
- **Branding & logo usage:** Hyaecord's source code is open source under GPL-3.0, but the logo, mascot, and project branding are protected separately. See the [Trademark Policy](TRADEMARK.md).
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

Hyaecord's source code is licensed under the
[GNU General Public License v3.0](LICENSE).

For rules regarding logos, branding, and third-party extensions, see:

- [TRADEMARK.md](TRADEMARK.md) — Branding and trademark usage guidelines
- [PLUGIN_GUIDELINES.md](PLUGIN_GUIDELINES.md) — Extension rules and monetization policy