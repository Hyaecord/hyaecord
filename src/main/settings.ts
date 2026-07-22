import { app } from "electron";
import { mkdirSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { join } from "node:path";
import type { HyaecordSettings } from "@shared/types";
import { DEFAULT_SETTINGS } from "@shared/constants";

let cached: HyaecordSettings | null = null;

function settingsPath(): string {
  return join(app.getPath("userData"), "settings.json");
}

export function loadSettings(): HyaecordSettings {
  if (cached) return cached;
  try {
    const raw = readFileSync(settingsPath(), "utf8");
    cached = { ...structuredClone(DEFAULT_SETTINGS), ...JSON.parse(raw) } as HyaecordSettings;
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
