# Hyaecord Design System

The design philosophy for everything Hyaecord ships: the desktop client, the website, and any future surface. [BRANDING.md](assets/branding/BRANDING.md) covers the logo and brand voice; this document covers how interfaces are built. Every colour recommendation in here was computed and contrast-verified, not eyeballed — the numbers are real WCAG ratios.

## 1. Principles

1. **Clarity beats decoration.** Every visual element must earn its place by helping someone read, find, or do something. Modern ≠ busy: the most contemporary-feeling interfaces (Linear, Vercel, GNOME's own apps) are the *quietest* ones.
2. **Neutrals do the work, brand colours do the talking.** Roughly 60% of any screen is neutral surface, 30% is secondary structure (borders, dim text, raised panels), and no more than 10% is saturated brand colour. When everything is loud, nothing is.
3. **Flat and honest.** Solid fills, visible borders, real edges — the sticker aesthetic from the brand. Depth comes from surface steps and restrained shadows, never from gradients, gloss, or blur-heavy glassmorphism (which costs GPU and readability).
4. **Accessibility is the floor, not a feature.** WCAG AA contrast, visible focus, keyboard everything, reduced-motion respected. An inaccessible screen is a broken screen, however pretty.
5. **Native-adjacent.** Follow the platform's spacing, control sizes, and restraint (GTK4/Libadwaita, KDE Plasma) while keeping Hyaecord's own identity through colour and shape.
6. **Tokens, not values.** Code never contains a raw hex. Everything routes through the semantic tokens below so themes stay consistent and future themes are cheap.

## 2. Colour

### 2.1 Why these colours

The palette derives entirely from the logo (see BRANDING.md). But brand anchors alone can't build an interface — you need *ramps*: graduated steps of each hue for backgrounds, borders, text, and states. Naively lightening/darkening hex values in sRGB produces steps that look uneven, because sRGB lightness is not perceptual. These ramps were generated in **OKLCH** colour space (perceptually uniform lightness, constant hue) with chroma tapered at the extremes so light steps don't look neon and dark steps don't look muddy.

### 2.2 The ramps

**Amber** (brand anchor `#c88633` sits between 300–400):

| 50 | 100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900 |
|---|---|---|---|---|---|---|---|---|---|
| `#fff3e6` | `#fbe3cb` | `#f5cc9f` | `#e8a962` | `#d0851d` | `#aa6a00` | `#835000` | `#653e05` | `#453119` | `#302110` |

**Red** (brand anchor `#e44550` sits between 400–500):

| 50 | 100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900 |
|---|---|---|---|---|---|---|---|---|---|
| `#fff1f1` | `#ffdfde` | `#ffc3c0` | `#ff9593` | `#fb5760` | `#d73142` | `#a82231` | `#7c252a` | `#532626` | `#391919` |

**Pink** (brand anchor `#d4495f` sits between 400–500):

| 50 | 100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900 |
|---|---|---|---|---|---|---|---|---|---|
| `#fff1f2` | `#ffdfe0` | `#ffc2c6` | `#ff939d` | `#f16075` | `#ce3e57` | `#a02d42` | `#762a35` | `#50282b` | `#371a1d` |

**Warm neutral** (spot-brown hue at very low chroma — this is what most of every screen is made of; pure grey next to warm brand colours looks dead, so the neutrals carry a trace of the brown):

| 50 | 100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900 |
|---|---|---|---|---|---|---|---|---|---|
| `#fff9f5` | `#fcede2` | `#eadbd0` | `#d0c1b7` | `#aa9b92` | `#85776e` | `#62554c` | `#463a32` | `#2f241c` | `#1b110a` |

### 2.3 Semantic tokens

Never reference ramp steps directly in component code — reference these:

| Token | Dark (default) | Light | AMOLED | Role |
|---|---|---|---|---|
| `--bg-deep` | `#16130e` | `#e3e5e8` | `#000000` | window chrome, rails |
| `--bg-base` | `#1c1812` | `#ffffff` | `#000000` | main content surface |
| `--bg-raise` | `#241f16` | `#f2f3f5` | `#0d0b07` | cards, inputs, popovers |
| `--bg-hover` | `#2d271c` | `#e3e5e8` | `#1a160e` | hover/selected fills |
| `--border` | `#3a3325` | `#d4d7dc` | `#2a2416` | hairlines, outlines |
| `--text` | `#f1e9d5` | `#060607` | `#f1e9d5` | primary text |
| `--text-dim` | `#b3a98d` | `#5c5e66` | `#a89e83` | secondary text |
| `--accent` | `#c88633` | `#835000` | `#c88633` | brand accent, focus rings |
| `--accent-strong` | `#e8a962` | `#653e05` | `#e8a962` | links, emphasized accent text |
| `--danger` | `#fb5760` | `#a82231` | `#fb5760` | destructive, errors |
| `--danger-text` | `#ff9593` | `#a82231` | `#ff9593` | error copy on base surfaces |

> **Light surfaces are true neutral grey, never the brand cream.** Cream (`#f1e9d5`) is reserved for the website's chrome accents — as a *client* background it read dated and heavy, and the owner asked it be dropped from the app entirely (23 July 2026). The client's light theme now uses the same neutral scale as the website's Discord-modeled light theme, so the two surfaces agree on what "light mode" looks like even though their component systems are separate.

Notes on why these work:

- **Prefer near-black/near-white over pure black-on-white where the choice is ours** — 21:1 contrast causes halation for astigmatic readers (a large minority) — but the client's light theme deliberately breaks this rule to match Discord's own light theme exactly (`#060607` text on `#ffffff`, ~19:1), because "looks like Discord's light mode" was an explicit requirement and users already tolerate that choice in the app they're switching from.
- **The accent shifts per theme.** Raw brand amber (`#c88633`) reads beautifully on dark (5.82:1) but fails at body-text size on light backgrounds (2.9:1 on white). Light mode substitutes amber-600 (`#835000`, 6.75:1+ on white). Same identity, correct contrast — this per-theme remapping is the single most common thing naive theming gets wrong.
- **AMOLED is not "dark but blacker".** True-black base for OLED power savings, but raised surfaces still step up in lightness, otherwise nothing has edges.

### 2.4 Verified contrast (computed, WCAG 2.x)

| Pair | Ratio | Passes |
|---|---|---|
| text on base (dark) | 14.60 | AAA |
| dim text on base (dark) | 7.55 | AAA |
| link amber-300 on base (dark) | 8.65 | AAA |
| brand amber on base (dark) | 5.82 | AA |
| danger text red-300 on base (dark) | 8.39 | AAA |
| button label brown on amber-400 | 5.43 | AA |
| white on red-600 button | 7.09 | AAA |
| text on white (light) | 20.25 | AAA |
| dim text on white (light) | 6.47 | AA |
| amber-600 text on white (light) | 6.75 | AA |
| red-600 link on white (light) | 7.15 | AAA |
| text on black (AMOLED) | 17.36 | AAA |
| focus ring on deep (dark) | 9.07 | ≥3:1 non-text |
| focus ring amber-600 on bg-deep (light) | 5.35 | ≥3:1 non-text |

**Rules derived from the numbers:**

- Body text: ≥ 4.5:1 always. Large text (≥ 24px, or ≥ 18.7px bold): ≥ 3:1. Non-text UI (borders of inputs, focus rings, icons that carry meaning): ≥ 3:1.
- amber-500 and brighter fail body-text contrast on light backgrounds — on light surfaces they are **fill/border/large-heading colours only**.
- Never pair saturated brand colours with each other for text (red on amber, pink on red, amber on light body copy). Saturated-on-saturated vibrates.
- **Colour is never the only signal.** Errors get an icon + text, not just redness; unread states get a dot/weight change, not just a hue shift; links inside prose get underlines.

### 2.5 Using colour meaningfully

- **One accent per view does the pointing.** The primary action is amber; everything else on that screen is neutral. Two competing primary buttons means the design hasn't decided what it wants the user to do.
- **Red is spent carefully.** It marks destruction and errors. If red also decorates, users stop flinching at it. (The brand's red sticker-shadow is decoration — that's fine *in branding*; in UI chrome, red = danger, full stop.)
- **Pink is the "fun" secondary** — mentions, celebratory moments, the odd highlight — used sparingly so it stays special.
- **States map to ramps predictably:** hover = one surface step up; active/pressed = one step down or 10% darker fill; selected = `--bg-hover` + accent indicator; disabled = 40% opacity on the whole control (not a colour swap, which breaks contrast math).

## 3. Typography

- **System font stack** (`system-ui, -apple-system, "Segoe UI", Roboto, Cantarell, sans-serif`): free, instant-loading, and automatically native-feeling on every platform. Web fonts are a cost (layout shift, weight, privacy) the project doesn't need. If a display face is ever added for the website hero, it must be self-hosted and `font-display: swap`.
- **Scale:** a 1.2 (minor third) modular scale from a 16px base — 12.8, 16, 19.2, 23, 27.6, 33.2, 39.8. In the client this multiplies by `--text-scale`, which is exactly why the scale is defined in `rem`.
- **Line height:** 1.5–1.65 for body, 1.1–1.25 for headings. **Line length:** 45–75 characters (`max-width: 65ch` on prose); nothing kills readability faster than 200-character lines on a wide monitor.
- **Weights:** 400 body, 600 UI labels/emphasis, 700–800 headings, 900 reserved for the hero. Never fake bold/italic on fonts that lack the face.
- Letter-spacing: slightly negative on large headings (−0.02em), slightly positive on ALL-CAPS labels (+0.06em). Never track body text.
- Numbers in tabular contexts (member counts, timestamps) get `font-variant-numeric: tabular-nums` so columns don't dance.

## 4. Spacing, layout, density

- **A 4px base grid.** All padding/margins/gaps are multiples of 4 (favouring 8, 12, 16, 24, 32). Consistent rhythm is what makes an interface feel "designed" before anyone can say why.
- **Group by proximity.** Related things sit closer than unrelated things; if a divider is needed to separate groups, the spacing probably failed first. Prefer whitespace over rules; prefer rules over boxes; prefer boxes over boxes-in-boxes.
- **Content max-widths:** prose 65ch; settings/forms ~640px; marketing sections ~1060px. Full-bleed only for the chat log and hero surfaces.
- **Density is a spectrum, chosen per surface:** the channel list is compact (32px rows), settings are comfortable (44px+ rows), marketing is generous. Don't average them into uniform mush.
- **Hit targets:** minimum 24×24px pointer, 44×44px for anything a thumb might touch. Padding counts; visuals can be smaller than the target.
- **Alignment:** one left edge per panel. Ragged label/control alignment reads as broken even when spacing is right.

## 5. Shape & depth

- **Radius tokens:** 6px (small controls), 10px (inputs, buttons, cards), 16px (modals, pills). Radius communicates hierarchy — bigger surface, bigger radius. Never mix radii on the same element class within a view.
- **Depth = surface steps first, shadow second.** A raised panel is `--bg-raise` + `--border`. Shadows, when used (modals, popovers), are soft, low, and single-source: `0 8px 24px rgb(0 0 0 / 0.35)` dark, `0 8px 24px rgb(90 70 30 / 0.12)` light. No stacked/coloured/glowing shadows.
- **In dark themes, elevation = lightness.** Higher surfaces are *lighter*, never darker; shadows barely read on dark backgrounds, so lightness carries the hierarchy.
- Borders are hairline (1px) and always from `--border` — 2px is reserved for focus and selected states so thickness stays meaningful.

## 6. Motion

Already encoded as client tokens; the same values apply to the website.

- **Durations:** 120ms (hover/small state), 200ms (reveals, toggles), 320ms (modals, page-level). Anything above ~400ms feels sluggish; anything below ~80ms reads as a glitch.
- **Easing:** `cubic-bezier(0.2, 0, 0, 1)` (fast out, gentle settle) for entrances and state changes; reverse for exits, exits faster than entrances.
- **Only `transform` and `opacity` animate** — they're GPU-composited and don't trigger layout. Never animate width/height/top/left; for reflow (a pin fading out of a list) use FLIP: measure, apply the end state, invert with a transform, play.
- **Motion must be interruptible and informative.** It shows where something came from or went — it is never a decoration you wait through. If a screenshot communicates the same thing, the animation isn't needed.
- **`prefers-reduced-motion` zeroes all durations** (already wired via the token pattern), and the in-app override wins in both directions. Opacity fades may remain at reduced settings; movement may not.

## 7. Interaction states

Every interactive element has all five states, always:

| State | Treatment |
|---|---|
| rest | quietest version |
| hover | surface one step up + optional 1px translate-Y lift |
| focus-visible | 2px `--accent` ring, 2px offset — **never removed, never colour-only** |
| active | pressed: step down / scale 0.98 |
| disabled | 40% opacity, `cursor: default`, still readable |

- `:focus-visible`, not `:focus` — keyboard users get rings, mouse users aren't nagged.
- Focus order follows visual order; modals trap focus and return it on close (already implemented in the client — keep it that way).
- Destructive actions: red **only at the moment of destruction** (the confirm button in the dialog), not on the innocuous button that opens the dialog.

## 8. Components

- **Buttons:** one primary (amber fill, brown label) per view; secondary = outlined neutral; ghost = borderless for low-stakes actions; danger = red-600 fill with white label, only inside confirmation contexts. Labels are verbs ("Turn off", "Get started"), never "OK/Yes".
- **Forms:** labels above inputs (not placeholders-as-labels — they vanish on input and fail recall); helper text below in `--text-dim`; errors in `--danger-text` **with an icon and specific guidance**, shown on blur or submit, never while someone is still typing. Inputs are `--bg-raise` + `--border`, focus ring on the ring token.
- **Modals:** max 560–640px, one purpose each, Esc + outside-click to dismiss (except flows that would lose data — then ask). Never stack more than two layers.
- **Empty states teach:** what this area is, why it's empty, one action to fill it — with the mascot allowed here (this is where brand personality lives, not in the chrome).
- **Toasts/notices:** border-left accent in the semantic colour + icon + text; auto-dismiss informational ones, persist errors.
- **Loading:** skeletons that match final layout for content; spinners only for sub-second, unknown-shape waits. Show *something* within 100ms or acknowledge the click.

## 9. Applying this: website vs client

**Website:** dark-first with `prefers-color-scheme` light support; hero uses brand anchors at full saturation (large text passes at 3:1); marketing may be more generous with colour-coded accents (the card top-border cycling amber/red/pink) because scan-reading, not hours-long use, is the job. Static HTML, no framework, no external fonts/scripts — speed *is* a design feature, and the accessibility bar is identical to the client's.

**Client:** people live in it for hours, so it sits closer to the quiet end — neutrals everywhere, amber only on the active/selected/primary, pink for mentions, red for danger. Long-session comfort beats first-glance wow: when in doubt, remove colour from the chrome and let message content be the most colourful thing on screen. Theme accents may later remap `--accent` to the user's GNOME/KDE accent colour — the semantic-token layer exists precisely so that's a five-line change.

## 10. Review checklist

Before shipping any UI:

- [ ] All colours via semantic tokens; zero raw hex in components
- [ ] Text ≥ 4.5:1 (or ≥ 3:1 large); non-text indicators ≥ 3:1 — *measured, not guessed*
- [ ] Works in Light, Dark, AMOLED without per-theme hacks
- [ ] Meaning never carried by colour alone
- [ ] Keyboard: reachable, visible focus, logical order, Esc behaves
- [ ] Reduced-motion produces a fully usable, non-janky experience
- [ ] Text/UI scale at 1.6× doesn't clip or overlap
- [ ] Spacing on the 4px grid; one alignment edge per panel
- [ ] Motion only transform/opacity; nothing above 320ms
- [ ] The primary action is unambiguous at a squint
