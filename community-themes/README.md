# Community Themes

This is Hyaecord's Theme Store registry — a plain JSON file, hosted for free
on GitHub, with no separate backend or hosting cost. The client fetches
[`registry.json`](registry.json) (via GitHub's raw-content CDN) whenever
someone opens Settings → Appearance → Community Themes, lists what's here,
and lets them apply one.

## How theme application works (and why it's safe)

A theme entry is **only a set of ten colour values** — never CSS, never
markup, never a script. The client reads the `tokens` object and applies
each value as an inline CSS custom property on the app root
(`style.setProperty('--bg-deep', tokens.bgDeep)`, etc.). There is no code
execution surface here: a malicious registry entry can, at worst, pick ugly
or hard-to-read colours, which is exactly what maintainer review (see
below) exists to catch before a submission is merged.

## Submitting a theme

Two ways in, both free:

1. **Open an issue** using the [theme submission
   template](https://github.com/Hyaecord/hyaecord/issues/new?template=theme_submission.yml)
   — fill in the name, your name/handle, and the ten colour values. A
   maintainer reviews it for contrast and adds it to `registry.json` for
   you.
2. **Open a PR yourself** — add an entry to `registry.json` following the
   schema below and open a pull request. Faster if you're comfortable with
   GitHub.

You can also post in the `#themes` channel of the [Discord
server](https://hyaecord.vercel.app/discord) if you'd rather not use GitHub
at all — a maintainer will file the submission on your behalf.

## Schema

```json
{
  "id": "kebab-case-unique-id",
  "name": "Display Name",
  "author": "Your name or handle",
  "tokens": {
    "bgDeep": "#hex",
    "bgBase": "#hex",
    "bgRaise": "#hex",
    "bgHover": "#hex",
    "border": "#hex",
    "text": "#hex",
    "textDim": "#hex",
    "accent": "#hex",
    "accentStrong": "#hex",
    "danger": "#hex"
  }
}
```

All ten tokens are required — the picker applies the full set, not a
partial override, so there's no ambiguity about what falls back to what.

## Review bar

Same as every other surface in this project — see
[DESIGN.md](../DESIGN.md#24-verified-contrast-computed-wcag-2x`). Before a
theme is merged:

- `text` on `bgBase` ≥ 4.5:1 (body text, WCAG AA)
- `textDim` on `bgBase` ≥ 4.5:1
- `accent` on `bgBase` ≥ 3:1 (it's used for focus rings and large UI, not body text)
- `bgDeep` on `accent` ≥ 4.5:1 (button labels are drawn in `bgDeep` over an `accent` fill)
- `danger` on `bgBase` ≥ 4.5:1

Submissions that don't clear these are asked to adjust and resubmit, not
rejected outright — most of the time it's one or two values that need
darkening or lightening.
