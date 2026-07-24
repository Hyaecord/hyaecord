import { app } from "electron";
import { mkdirSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { join } from "node:path";
import type { HyaecordSettings } from "@shared/types";
import { DEFAULT_SETTINGS } from "@shared/constants";

let cached: HyaecordSettings | null = null;

function settingsPath(): string {
  return join(app.getPath("userData"), "settings.json");
}

// One-level-deep merge: a plain top-level spread lets an old saved settings
// file's stale shape for a nested object (e.g. chomper's `hiddenGuildIds`
// before it became `hidden`) silently replace the *entire* default nested
// object, dropping fields the current code assumes always exist. Found live
// this way: a real on-disk settings.json predating that rename crashed the
// whole Settings dialog on open (`chomper.hidden` was undefined).
function mergeSettings(saved: Record<string, unknown>): HyaecordSettings {
  const merged: Record<string, unknown> = structuredClone(DEFAULT_SETTINGS);
  for (const [key, value] of Object.entries(saved)) {
    const defaultValue = merged[key];
    if (
      defaultValue && typeof defaultValue === "object" && !Array.isArray(defaultValue) &&
      value && typeof value === "object" && !Array.isArray(value)
    ) {
      merged[key] = { ...(defaultValue as object), ...(value as object) };
    } else {
      merged[key] = value;
    }
  }
  return merged as unknown as HyaecordSettings;
}

export function loadSettings(): HyaecordSettings {
  if (cached) return cached;
  try {
    const raw = readFileSync(settingsPath(), "utf8");
    cached = mergeSettings(JSON.parse(raw));
  } catch {
    cached = structuredClone(DEFAULT_SETTINGS) as unknown as HyaecordSettings;
  }
  return cached;
}

export function saveSettings(patch: Partial<HyaecordSettings>): HyaecordSettings {
  const next = { ...loadSettings(), ...patch } as HyaecordSettings;
  cached = next;
  const path = settingsPath();
  mkdirSync(join(path, ".."), { recursive: true });
  // Write-then-rename so a crash mid-write can't corrupt the settings file.
  const tmp = path + ".tmp";
  writeFileSync(tmp, JSON.stringify(next, null, 2), "utf8");
  renameSync(tmp, path);
  return next;
}
