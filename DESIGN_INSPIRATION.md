# Design inspiration catalogue — `uisnippets.txt`

The owner dropped a ~4,600-line file (`uisnippets.txt`, gitignored — it's
scratch reference material, not something to ship as-is) of React/Tailwind/
Motion/GSAP/OGL component source from kokonutui.com and React Bits, each
tied to a specific feature idea. None of it can be used verbatim — this
app has no React, no Tailwind, no bundler for those npm packages; every
one of these is source material to reimplement in the project's own
vanilla-DOM style (`el()`, plain CSS), the same way `burstParticles()`
(`ui.ts`) already did for the Particle Button snippet, not code to copy in.

This document exists so a future pass doesn't have to re-read the whole
file cold. What's in it, matched against what Hyaecord actually has today:

## Already covered by an existing real feature
- **"Attract Button" / "Hold Button" / mass-delete-channels idea** ("add a
  feature to mass delete discord channels in a row in a mode we can call
  moderator view... started with shift + m... maybe make it hyena
  related") — this is **already built**: `moderator.ts`, Shift+M, real
  `canManageChannels` gating, hold-to-confirm delete, and a hyena-themed
  "chomp into the den" animation instead of the snippet's literal
  trash-can pull. Different animation, same real feature and same spirit
  of the ask (hyena-themed, hold-to-confirm). Nothing further needed here.
- **"Particle Button"** — `burstParticles()` (`ui.ts`), already used on
  the Settings "Star on GitHub" button.
- **"CircularGallery... for the themes area... add a search bar"** —
  implemented the actual ask (a real, filterable theme search) in
  `theme-store.ts` without pulling in the snippet's `ogl` (WebGL)
  dependency for a circular carousel — that's a heavy, riskier addition
  for what the owner's own text framed as the goal ("select themes
  easily... add a search bar"), not the carousel motion specifically.

## Real, not-yet-built ideas worth a future pass (in rough value order)
- **LineSidebar** — inspiration for the channel-list sidebar. Hyaecord's
  current channel list is plain `<li>` rows; this snippet's animated
  connecting-line-between-items treatment could be adapted as pure CSS
  (no bundled dependency) if a future pass wants that specific visual
  language. Not started.
- **Team Selector (animated)** — explicitly noted for "when showing
  plugin contributors" — could enhance Settings → Credits' contributor
  grid (item 66) with a similar hover/selection animation. Not started;
  the current grid is a plain static tile layout.
- **Dynamic Text** — generic animated-text component, no specific feature
  tied to it in the source notes. No obvious current use.
- **Social Button** — generic button style, no specific feature tied to
  it in the source notes.
- **Avatar Picker** — a gallery of stylised, procedurally-colored default
  avatars to choose from. Doesn't map cleanly onto Discord's or Stoat's
  *real* avatar system (both are "upload an image or use the platform's
  own generated default," not "pick from a fixed local design set") —
  worth a real product decision (what would selecting one of these
  actually *do*?) before building it, not a guess.
- **CardNav, Stack, Masonry** — general-purpose layout/navigation
  components with no specific Hyaecord feature noted against them in the
  source text. Flagged here for completeness; no concrete plan.

## Why the rest wasn't attempted in one overnight pass
Porting eight-plus GSAP/Motion/OGL-driven components to this app's vanilla
DOM/CSS approach, correctly, is real per-component design and engineering
work — rushing several of them low-effort and unsupervised risks shipping
half-broken visual polish, which is worse than not touching them yet. Real
completeness/correctness work (Stoat feature parity, live message events,
reactions, attachments — see `BUILD_PROMPT.md` items 63–68) took priority
this pass; this catalogue is the honest, deliberate hand-off for whichever
of these gets picked up next; picking one and doing it properly beats
rushing all of them.
