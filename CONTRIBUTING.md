# Contributing to Hyaecord

Thanks for your interest in contributing! Hyaecord is an original Discord client with an Equicord/Vencord plugin-API compatibility layer, and there's plenty to do.

## Getting set up

Prerequisites:

- **Node.js 22+**
- **pnpm 11+** (`corepack enable` or `npm i -g pnpm`)

```bash
git clone https://github.com/Hyaecord/hyaecord.git
cd hyaecord
pnpm install
pnpm build      # bundle main/preload/renderer into dist/
pnpm dev        # build + launch Electron
pnpm typecheck  # TypeScript, no emit
```

If Electron fails to launch in your dev environment with a sandbox error, run it with `--no-sandbox` (a local dev quirk when the chrome-sandbox helper isn't setuid root — packaged builds are unaffected).

## Project layout

| Path | What it is |
| --- | --- |
| `src/main/` | Electron main process: window, tray, settings store, DE/theme detection, i18n |
| `src/preload/` | Context bridge exposing the typed `window.hyaecord` API |
| `src/renderer/` | The UI shell (original DOM, not a Discord/Equicord reskin) |
| `src/shared/` | Types and constants shared across processes |
| `src/i18n/` | Externalized UI strings (English is the source of truth) |
| `scripts/build.mjs` | esbuild bundler |

## Ground rules

- **Read [BUILD_PROMPT.md](BUILD_PROMPT.md) first.** It defines V1 scope, what's deliberately out of scope, and open decisions. Don't implement V2/backlog items without discussing first.
- **Accessibility is not optional.** New UI needs ARIA semantics, keyboard navigation, and must respect reduced-motion and the text/UI scale settings. WCAG AA contrast is the baseline for any theme work.
- **UI work follows [DESIGN.md](DESIGN.md)** — semantic colour tokens (no raw hex in components), the spacing grid, motion tokens, and the review checklist at the bottom of that document.
- **All user-facing strings go through i18n** (`src/i18n/en.json`). No hardcoded UI text.
- **Motion uses the shared tokens** in `styles.css` — GPU-friendly properties (transform/opacity) only, and everything must respect `prefers-reduced-motion`.
- **Telemetry is minimal and honest.** One anonymous daily ping (random ID, version, OS, DE family) with a single opt-out, disclosed in the first-run wizard. Never add telemetry that touches message content, identifiers, or per-user behaviour, and never bypass the opt-out — everything goes through `src/main/telemetry.ts`.
- **Nothing that automates user actions** or crosses from cosmetic/QoL into abusive-behavior territory. This is a hard line.
- Don't copy code, assets, or wording from other clients. Plugin *API* compatibility with Equicord/Vencord is intentional; reuse of their client code is not.

## Pull requests

1. Fork and branch from `main`.
2. Keep PRs focused — one feature or fix per PR.
3. `pnpm typecheck && pnpm build` must pass (CI enforces this).
4. Describe *what* and *why*; screenshots for UI changes are appreciated.

## Reporting bugs / plugin incompatibilities

Open a GitHub issue. For plugins that don't work under Hyaecord's original GUI, please include the plugin name/source and what breaks — we track these as a known-issues compatibility list.

## Security issues

Please don't open public issues for vulnerabilities — see [SECURITY.md](SECURITY.md).

## License

By contributing you agree your contributions are licensed under the [Hyaecord Public License](LICENSE) (GPL-3.0-derived, non-commercial, copyleft). Brand assets are separately licensed — see `assets/branding/LICENSE.md` and [TRADEMARK.md](TRADEMARK.md).
