import { app } from "electron";
import { mkdirSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { join } from "node:path";

export interface PluginState {
  enabled: boolean;
  settings: Record<string, boolean | number | string>;
}

type PluginStateMap = Record<string, PluginState>;

let cached: PluginStateMap | null = null;

function storePath(): string {
  return join(app.getPath("userData"), "plugins.json");
}

export function loadPluginState(): PluginStateMap {
  if (cached) return cached;
  try {
    cached = JSON.parse(readFileSync(storePath(), "utf8")) as PluginStateMap;
  } catch {
    cached = {};
  }
  return cached;
}

export function savePluginState(map: PluginStateMap): void {
  cached = map;
  const path = storePath();
  mkdirSync(join(path, ".."), { recursive: true });
  const tmp = path + ".tmp";
  writeFileSync(tmp, JSON.stringify(map, null, 2), "utf8");
  renameSync(tmp, path);
}
