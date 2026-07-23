#!/usr/bin/env bash
# Launcher for the Flatpak build. org.electronjs.Electron2.BaseApp supplies
# a shared Electron runtime under /app/main via zypak; apps built on it
# invoke that shared binary against their own app directory rather than
# bundling Electron themselves.
#
# ⚠ Not verified against a real flatpak-builder run yet (this sandbox has
# neither flatpak-builder nor network access to fetch the freedesktop
# runtime/BaseApp extension) — the exact shared-binary path below
# (/app/main/electron) is the documented convention, not something tested
# here. Confirm it against org.electronjs.Electron2.BaseApp's own README
# before relying on this for a real Flathub submission.
zypak-wrapper /app/main/electron /app/hyaecord/dist/main/index.js "$@"
