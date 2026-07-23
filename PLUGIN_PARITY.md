# Plugin parity audit — Vencord/Equicord vs Hyaecord

Owner ask: go through the real Equicord (and by extension Vencord, since
Equicord bundles all of Vencord's plugins plus its own) plugin catalogue,
work out what's actually feasible to port, build what's feasible, and be
honest about what isn't rather than shipping fake disabled toggles for
things that will never run.

## The architectural constraint, stated once, plainly

Vencord and Equicord plugins mostly work by **patching Discord's own
official webpack bundle** — string-matching internal module code and
injecting React component patches (`Vencord.Webpack.findByProps`,
`replace`/`before`/`after`/`instead` patches on Discord's real,
minified client code). Hyaecord's UI is original code with no Discord
webpack bundle anywhere in it — there is nothing for that kind of patch
to attach to, sandboxed or not. This was already corrected once in this
project (see `BUILD_PROMPT.md` item 32): an earlier draft of the docs
claimed Hyaecord "runs most Vencord/Equicord plugins unmodified," which
isn't achievable and was walked back.

What Hyaecord actually has is its **own** plugin API
(`src/main/plugins/sandbox.ts`), deliberately modeled on `definePlugin`'s
shape for familiarity, running in a locked-down `node:vm` context with a
narrow surface: `settings`, `showToast`, `onMessageSend` (transform or
cancel an outgoing message), `onMessageCreate` (read-only, every incoming
message). No DOM, no webpack, no React, no network, no filesystem.

So "port a plugin" here means: **read what the plugin actually does,
reimplement that same end-user behaviour from scratch against Hyaecord's
own API**, not copy code that will never execute. Every port is credited
in-app with a dual-logo "Ported from Equicord/Vencord + Hyaecord" badge
(`plugins.portedFrom` in Settings → Plugins) linking back to the original
source file.

## Method

Cloned `Equicord/Equicord` (which is Vencord's own `src/plugins` — 163
plugins — plus Equicord's own exclusive `src/equicordplugins` — 198
plugins — 361 total) and grepped every plugin's `index.ts(x)` for a
`patches:` array, the single clearest signal of "this touches Discord's
real webpack bundle and cannot run here."

- **239 of 361** declare `patches:` — architecturally not portable,
  full stop. No further individual triage is useful for these; the
  reason is the same for all of them.
- **122 of 361** declare no `patches:` array. These are the real
  candidates — but "no patches" is necessary, not sufficient. Most of
  these still depend on Vencord APIs Hyaecord doesn't have and isn't
  going to reimplement wholesale: Flux stores (live Discord state
  outside what the gateway dispatch already gives this app), the
  `ContextMenu` patch API, chat-bar buttons, slash commands, modals,
  audio playback, or `fetch` (the plugin sandbox has none — that's a
  deliberate security boundary, not an oversight, see `sandbox.ts`).

## Ported so far (real, in `plugins/`, opt-in like every plugin)

| Hyaecord plugin | Original | Source | Notes |
| --- | --- | --- | --- |
| `talk-in-reverse.js` | TalkInReverse (Equicord) | [source](https://github.com/Equicord/Equicord/blob/main/src/equicordplugins/talkInReverse/index.tsx) | Identical transform (`split("").reverse().join("")`); settings toggle instead of the original's chat-bar button (no chat-bar-button API here) |
| `write-upper-case.js` | WriteUpperCase (Equicord) | [source](https://github.com/Equicord/Equicord/blob/main/src/equicordplugins/writeUpperCase/index.ts) | Sentence-split + capitalize logic ported as-is |
| `signature.js` | Signature (Equicord) | [source](https://github.com/Equicord/Equicord/blob/main/src/equicordplugins/signature/index.tsx) | Core "append header + text" behaviour; original's random-pick-from-list variant not ported |
| `polish-wording.js` | PolishWording (Equicord) | [source](https://github.com/Equicord/Equicord/blob/main/src/equicordplugins/polishWording/index.ts) | Only "fix apostrophes" + "expand contractions" ported (self-contained find/replace against a fixed map); "capitalize sentences" and "add periods" use more involved sentence-boundary regexes, left out this pass rather than risking a subtly-wrong port |
| `send-timestamps.js` | SendTimestamps (Vencord) | [source](https://github.com/Equicord/Equicord/blob/main/src/plugins/sendTimestamps/index.tsx) | Only the regex-auto-replace half ported; the chat-bar date-picker modal wasn't (no modal API) |

All four verified with a standalone Node harness that loads each file
through the same `node:vm` evaluation `sandbox.ts` uses, force-enables
their settings, and runs a sample message through their `onMessageSend`
hooks — not just typechecked. (Full in-app screenshot verification
blocked by this session's sandbox GPU instability — see recent
`BUILD_PROMPT.md` entries; the plugin logic itself doesn't touch
Electron/GPU at all, so this is a real, adjacent limitation, not a gap
in verifying the actual feature.)

## Triage of the remaining 118 no-`patches:` candidates

First-pass categorization by reading each plugin's `description:` field
(and source for a few ambiguous ones) — not yet a full read of every
file, so treat this as a real starting point to re-verify against as
each is actually attempted, not a final verdict.

### Category A — plausible future ports (pure message-content transform, no missing API)
Same shape as the four already shipped: touches only outgoing message
text via something equivalent to `onBeforeMessageSend`.
- `googleThat` — mis-triaged in the original pass; actually reads its source now: it's a **slash command** (`/googlethat <query>`), not a content transform at all. Hyaecord has no application-command registration mechanism whatsoever — reclassified to Category D, and a much bigger one than most entries there (a whole new feature area, not a small hook addition).
- ~~`unsuppressEmbeds`~~ — ✅ built, but as a **native message context-menu item**, not a plugin: confirmed it's a real REST call (`PATCH /channels/{channel.id}/messages/{message.id}` with `flags`, docs.discord.food) toggling the `SUPPRESS_EMBEDS` bit, which the plugin API's content-only `onMessageSend` can't do. Only offered when a message has embeds or is already suppressed (matches the original's own visibility condition), and only when the current user can actually do it — own messages always allowed; other users' need `MANAGE_MESSAGES` in that channel, confirmed as the exact real permission requirement via docs.discord.food's edit-message notes, reusing the same `Permission`/`hasPermission` machinery Moderator View already built for `MANAGE_CHANNELS`.
- ~~`copyUserMention`, `copyUserURLs`~~ — ✅ built as native context-menu items (`mentionItem`/`userUrlItem`, `src/renderer/context-menu.ts`), reusing the same right-click infra Developer Mode's "Copy ID" already built, on message authors/member rows/profile popouts. Not gated behind Developer Mode (unlike Copy ID) since there's no real-Discord equivalent feature to match the "off by default" precedent against.
- ~~`copyProfileColors`~~ — ✅ built as a native context-menu item on the profile popout (`profileColorsItem`, `context-menu.ts`), only shown when a profile actually has theme colours set. Required extending `UserProfile`/`RawUserProfile` with Discord's real `theme_colors` field (a premium-only two-colour gradient, distinct from the older single `accent_color` — confirmed via docs.discord.food's Profile Metadata Object, not assumed) all the way from `rest.ts` through to the renderer.
- `copyEmojiMarkdown`, `copyStickerLinks` — same "native context-menu item, not a plugin" shape, just not built yet: both need a right-click target on rendered emoji/stickers in message content, and messages render as plain text today with no per-token interactivity.

### Category B — needs a plugin-API extension that doesn't exist yet, but is a reasonable one to add
- ~~`silentMessageToggle`~~ — ✅ built, but as a **native composer feature**, not a plugin: the plugin API's `onMessageSend` can only transform the content *string*, and this needed to set the real `flags` field on the REST request (`SUPPRESS_NOTIFICATIONS`, `1 << 12`) — confirmed via docs.discord.food that this is genuine request-body surface, not the `"@silent "` content-prefix trick the original plugin uses (that trick only works because Discord's *own* official composer parses and strips it client-side before building the request; a client hitting the REST API directly, like this one, has to set the real flag). A 🔕 toggle button next to the composer sets it for the next message only, auto-disabling after send (matches the original's default `autoDisable: true`; its optional cross-channel/cross-restart persistence wasn't ported — no state store for it).
- ~~`sendTimestamps`~~ — ✅ built (`plugins/send-timestamps.js`): the auto-replace-on-send half (`onBeforeMessageSend`'s regex + `parseTime`, both self-contained and independent of the file's `PickerModal` UI) ported faithfully. Type a time in backticks (`` `3:51` ``, `` `17:59` ``, `` `0:13PM` ``) and it becomes a real `<t:...:t>` timestamp. The chat-bar date-picker button/modal isn't ported (no modal API in the sandbox).
- ~~A plugin key-value store~~ — ✅ built: `api.getData(key)`/`api.setData(key, value)`, persisted alongside settings in the same `plugins.json` write-then-rename file. Re-checked the four plugins this was meant to unlock, by actually reading their source rather than assuming from the description — the picture was less clean than it first looked:
  - `messageBurst` — needs to change how messages *render* (grouping consecutive ones, hiding repeated avatars), not just track state. No message-render hook exists; reclassified to Category D.
  - `streaks` — actually calls a live third-party API (`streaks.equicord.org`, with its own OAuth flow) for cross-device sync, not local computation. Reclassified to Category C (network) — the original mis-triage here just went off the description, not the source.
  - `lastActive`, `pingNotifications` — both read Discord's internal webpack stores directly (`RelationshipStore` for the friends list, `UserGuildSettingsStore` for mute state, `PresenceStore`), none of which Hyaecord's gateway parsing currently exposes as a concept (there's no "friends list" anywhere in this app yet). Reclassified: blocked on that missing data model, not on storage.
  
  So the four original targets didn't pan out, but the store itself is real, tested infrastructure now — available to any future bundled port *and* to third-party plugins dropped into `userData/plugins`, not just the four that motivated building it.

### Category C — needs a capability the plugin sandbox deliberately doesn't grant
Not a gap to close casually — network/audio/filesystem access would weaken
the actual security boundary the sandbox exists for (see `sandbox.ts`'s
own comment). Would need a deliberate, scoped, opt-in capability grant
per plugin if ever revisited, not a blanket unlock.
- `clearURLs` — fetches a live tracking-rules JSON at startup (network)
- `translate`, `translatePlus` — call an external translation API (network)
- `triviaAI` — calls an AI backend (network)
- `streaks` — calls a live third-party API (`streaks.equicord.org`) with its own OAuth flow, not local computation (see Category B note above — this was mis-triaged from its description alone originally, corrected after reading the actual source)
- `animalese`, `keyboardSounds`, `moyai`, `soggy`, `partyMode`, `snowfall`, `cursorBuddy` — audio/visual effects (no audio API, no arbitrary DOM overlay API in the sandbox)
- `autoZipper`, `downloadAllAttachments` — filesystem access
- `lastActive`, `pingNotifications` — read Discord's internal webpack stores (`RelationshipStore`, `UserGuildSettingsStore`, `PresenceStore`) for data that's now *partially* available: a real friends list exists (`src/renderer/friends.ts`, see "Next candidates" below), but `UserGuildSettingsStore` (mute state) and `PresenceStore` (online status) still aren't. Still blocked, just on a smaller remaining gap than before.

### Category D — needs UI Hyaecord doesn't have a hook for (not "impossible," just not built)
Modals, custom settings panes beyond boolean/number/string, chat-bar
buttons beyond a plain toggle, context-menu injection beyond the
existing Copy-ID system, command-palette-style overlays, slash-command
registration, or a message-render hook (grouping/annotating how a
message displays, not just its outgoing content):
`googleThat` (needs slash-command registration — Hyaecord has no
application-command mechanism at all, a genuinely new feature area, not
a small hook), `commandPalette`, `keyboardNavigation`, `previewMessage`, `quoter`,
`petpet`, `expressionCloner`, `iconViewer`, `messageBurst` (needs to
change how consecutive messages render, not just their content — no
message-render hook exists), `themeLibrary` (Hyaecord already has its
own real Theme Store, see `BUILD_PROMPT.md` item 17),
`friendInvites`, `inRole`, `serverSearch`, `jumpTo` (Hyaecord's message
search already covers part of this, see item 44), `reviewDB`,
`richPresence` (Hyaecord's own RPC Bridge, item 40, already covers the
"let other apps set Rich Presence" half of this).

### Category E — makes no sense outside the real Discord/Vesktop desktop app or is already covered
`fixSpotifyEmbeds`, `appleMusic`, `musicRichPresence`, `steamStatusSync`,
`songLink`, `webKeybinds`, `youtubeAdblock`, `xsOverlay`,
`screenRecorder` (voice/screen-share isn't built at all, see README),
`globalBadges` (Hyaecord already has its own real GlobalBadges
integration, item 26/40 — this is the same feature, not a gap),
`equicordToolbox`, `newPluginsManager`, `devCompanion`,
`userpluginInstaller` (Equicord/Vencord's own meta-tooling, not
applicable to a different plugin system).

## What this means for "make disabled ones show as disabled"

Deliberately **not** doing this: shipping ~350 fake plugin entries that
are permanently greyed out and can never be enabled is dead UI with no
path to ever becoming real — the project's own standing principle (see
`README.md`/`BUILD_PROMPT.md`'s repeated "no dead UI" pattern, e.g. item
41's "right-click does nothing when the setting is off, matching 'no
dead UI'"). Instead: this document is the honest, browsable "why not"
for anyone asking "where's plugin X" — linked from `PLUGIN_GUIDELINES.md`
— and the *real* plugins ship for real, with real dual-logo attribution,
the moment they're actually built.

## Next candidates, roughly in order of value vs effort

1. ~~Native "Copy Mention" / "Copy User URL" context-menu items~~ — ✅ done, see Category A above.
2. ~~`silentMessageToggle`~~ — ✅ done, see Category B above.
3. ~~Re-read `sendTimestamps` closely for a modal-free auto-replace path~~ — ✅ done, see the ported-plugins table above.
4. ~~A plugin key-value store API addition~~ — ✅ built (`api.getData`/`api.setData`); the four plugins that motivated it didn't pan out on closer inspection (see Category B), but the primitive is real and available now.
5. ~~A "friends list" data model~~ — ✅ built (`src/renderer/friends.ts`, real relationships API, not the READY payload) as a standalone Friends feature in its own right, not just plugin plumbing — see README's checklist. `lastActive`/`pingNotifications` are now only blocked on presence/mute-state data, not the friends concept itself; still not unblocked outright, since Chomper's mute tracking is Hyaecord's own local model (item 16/21) and doesn't read `UserGuildSettingsStore`'s mute state the way the original plugins expect, and there's still no presence tracking outside an open guild's member list.
6. ~~`unsuppressEmbeds`~~ — ✅ done, see Category A above.
7. Slash-command registration is now the single biggest lever left — it alone would unblock `googleThat` and several others across the full 361-plugin list that weren't itemized individually here, not just one plugin. Worth scoping as its own feature before picking off more one-plugin-at-a-time wins.
