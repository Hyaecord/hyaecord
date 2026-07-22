# Hyaecord Brand Guidelines

How to use the Hyaecord name, logo, and palette. For *whether* you may use them at all, see [LICENSE.md](LICENSE.md) (brand assets are all-rights-reserved, separate from the code's GPL) and the repo's [TRADEMARK.md](../../TRADEMARK.md).

## Philosophy

Hyaecord's brand is a **laughing hyena on a sticker** — playful, loud, a little feral, but friendly. The design language that follows from that:

- **Flat and bold.** Solid colours, chunky shapes, thick outlines. No gradients, no gloss, no soft glows. If it wouldn't survive being printed as a die-cut sticker, it's off-brand.
- **Honest and readable.** The same bar the client holds itself to (WCAG AA contrast, plain language) applies to anything carrying the brand. Never put brand colours together in ways that make text hard to read.
- **Scrappy, not corporate.** The mascot grins with its tongue out. Copy and visuals can be cheeky; they shouldn't be sterile.

## The logo

`logo.svg` is the primary mark: the "HC" hyena monogram with its bone, on the white sticker outline with the red offset shadow. Use it as-is whenever possible.

### Monochrome / recolourable versions

For contexts where the full-colour mark doesn't work (single-colour print, embossing, favicons on busy backgrounds, themed UI):

| File | What it is |
| --- | --- |
| `logo-mono.svg` | Solid silhouette of the full sticker shape |
| `logo-lineart.svg` | Spots-and-features line art (no shadow) |
| `logo-mono-{black,white}-1024.png` | Pre-rendered silhouette |
| `logo-lineart-{black,white}-1024.png` | Pre-rendered line art |

Both SVGs are filled with **`currentColor`**, so they inherit whatever CSS `color` is set on them or an ancestor — recolour with one line:

```html
<img src="logo-mono.svg" ...>                <!-- renders black by default -->
<div style="color:#c88633"><svg-inline/></div> <!-- inline the SVG and it renders amber -->
```

When recolouring, use a single flat colour — preferably one from the palette below — and keep at least 4.5:1 contrast against the background.

### Do

- Keep the mark's proportions; scale uniformly.
- Give it clear space: at least the width of the bone on all sides.
- Put the full-colour mark on backgrounds where the white sticker outline stays visible.

### Don't

- Stretch, rotate, outline, add effects (shadows beyond the built-in one, glows, gradients), or recolour individual parts of the full-colour mark.
- Redraw or restyle the hyena, or combine the mark with other logos.
- Use the mark or name to imply affiliation with, or endorsement by, the Hyaecord project or Discord Inc. (see TRADEMARK.md).

## Palette

Every brand colour comes from the logo itself:

| Name | Hex | Source in the logo | Typical use |
| --- | --- | --- | --- |
| Amber | `#c88633` | hyena coat | primary accent, buttons, highlights |
| Spot brown | `#2e1d11` | spots, outlines | dark text, dark backgrounds |
| Sticker white | `#fefefe` | sticker border, teeth | light surfaces, text on dark |
| Shadow red | `#e44550` | offset shadow, eye | attention, CTAs, warnings |
| Tongue pink | `#d4495f` | tongue | secondary accent |
| Cream | `#f1e9d5` | brand paper tone | light backgrounds, text on dark |

Contrast notes (WCAG AA is the floor):

- On **spot brown / dark** backgrounds: cream, sticker white, and amber all pass for text.
- On **cream / light** backgrounds: use spot brown for text. Amber and red **fail AA for body text on cream** — use them there only for large/bold headings, borders, and fills, or darken them (e.g. amber → `#8a5a17`, red → `#a03340`) when they must carry small text.
- Never set red on amber, pink on red, or amber on cream body text.

## Voice

Plain language, up front about trade-offs (the ToS disclosure lives on the landing page, not in a footnote), no dark patterns, no fake urgency. Jokes are welcome; dishonesty is not.
