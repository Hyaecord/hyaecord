# Hyaecord Plugin & Extension Policy

Hyaecord is committed to keeping the entire client experience free,
accessible, and open. Hyaecord has its own plugin API, run in a sandboxed
Node `vm` context — ergonomically modeled on Vencord's `definePlugin`
shape (name/description/authors/settings/start/stop) so a simple plugin
feels familiar to port, but it is **not** byte-compatible with real
Vencord/Equicord plugin files. Those rely on patching Discord's own
webpack bundle at runtime (`Vencord.Webpack.findByProps`, direct component
patches); Hyaecord's client GUI is original code, not a webpack bundle, so
there's nothing for that kind of patch to attach to, sandboxed or not. A
plugin that only needs message-level hooks (intercepting/transforming
outgoing messages, reacting to incoming ones) can be ported with minor
changes; a plugin that reaches into Discord's real component tree cannot
run here regardless of effort. See `src/main/plugins/sandbox.ts` for the
exact API surface. To maintain a fair and safe ecosystem, all plugins
submitted to or bundled with Hyaecord must adhere to these guidelines.

See `PLUGIN_PARITY.md` for a real, plugin-by-plugin audit of Equicord's
full catalogue (all 361 Vencord + Equicord-exclusive plugins) against
what's actually feasible here — which ones have already been ported,
which are plausible future ports, and which are architecturally
impossible and why, rather than a guess or a blanket claim either way.

## 1. No Paywalls or Commercial Features

* **100% free access:** Plugins must provide all functionality free of
  charge, with no reduced-functionality "free tier."
* **No license keys:** Plugins may not require activation keys, paid
  subscriptions, or paid-tier unlocks of any kind.
* **No in-app monetization:** Plugins may not prompt users for payment
  inside the client, show ads, or gate features behind a paywall.

## 2. Creator Donations Are Encouraged ❤️

We want creators to get paid for their work — just not by monetizing the
plugin's functionality itself.

* **Allowed:** Links to Ko-fi, Patreon, GitHub Sponsors, Open Collective,
  Liberapay, or a custom donation page, shown in the plugin manifest or
  settings panel.
* **Allowed:** A single, non-intrusive "Support the Developer" button or
  link in the plugin's configuration UI.
* **Not allowed:** Donation prompts that block, delay, or nag the user
  during normal use (e.g. modal popups, cooldown timers tied to donation
  status).

## 3. Open Source & Safety

* **Open code:** All plugins must be open-source, publicly reviewable, and
  buildable from source — no obfuscated or minified-only submissions.
* **No telemetry without consent:** Plugins must not collect or transmit
  user data unless the user has given explicit, opt-in consent, and must
  clearly disclose what is collected and why.
* **No hidden network calls:** Any external network requests a plugin makes
  should be disclosed in its manifest or documentation.
* **ToS compliance:** Plugins that automate user actions, facilitate
  self-botting, mass-DMing, spamming, or other disruptive/abusive behavior
  will be permanently banned from the registry — no appeal.

## 4. Submission Process

1. Open a pull request against the plugin registry with your plugin's
   source code, a manifest (name, author, description, permissions,
   external requests), and any donation links.
2. A maintainer reviews the submission against Sections 1–3 above. Expect
   review comments on manifest completeness, permission scope, and code
   quality before merging.
3. Once merged, your plugin appears in the official index and is available
   to all Hyaecord users.

## 5. Ongoing Compliance & Removal

* Plugins are subject to periodic re-review as Hyaecord updates.
* If a plugin is found to violate this policy after being listed, it will
  be removed from the official index immediately, and the maintainer will
  be notified with the specific violation.
* **Appeals:** Maintainers who believe a removal was made in error, or who
  have fixed the underlying issue, may reopen the relevant issue or open a
  new one referencing it to request re-review. Removals for self-botting,
  spam, or other ToS-violating automation (Section 3) are not eligible for
  appeal.

## 6. Scope

These guidelines apply to plugins distributed through the official Hyaecord
registry. Plugins installed manually from outside the registry are not
reviewed or endorsed by the Hyaecord project, and users install them at
their own risk.
