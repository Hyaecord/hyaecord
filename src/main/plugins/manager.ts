import { app } from "electron";
import { existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { evaluatePluginSource, PluginLoadError, type PluginDefinition, type PluginRuntimeApi } from "./sandbox";
import { loadPluginState, savePluginState } from "./store";

export interface LoadedPlugin {
  id: string;
  def: PluginDefinition;
  enabled: boolean;
  error: string | null;
  api: PluginRuntimeApi;
  sendHooks: Array<(content: string, channelId: string) => string | null | Promise<string | null>>;
  createHooks: Array<(message: unknown) => void>;
}

export interface PluginInfo {
  id: string;
  name: string;
  description: string;
  authors: string[];
  enabled: boolean;
  error: string | null;
  settingsSchema: PluginDefinition["settings"];
  settingsValues: Record<string, boolean | number | string>;
  portedFrom: PluginDefinition["portedFrom"] | null;
}

let plugins: LoadedPlugin[] = [];
let toastFn: (message: string) => void = () => {};

/** Bundled example plugins shipped with the app, plus anything the user drops in userData/plugins. Both are plain .js files, one plugin per file, id = filename without extension. */
function pluginDirs(): string[] {
  return [join(app.getAppPath(), "plugins"), join(app.getPath("userData"), "plugins")];
}

function buildApi(id: string, schema: PluginDefinition["settings"], state: () => Record<string, boolean | number | string>): PluginRuntimeApi {
  const plugin = () => plugins.find(p => p.id === id)!;
  return {
    get settings() {
      const values = state();
      const merged: Record<string, boolean | number | string> = {};
      for (const [key, entry] of Object.entries(schema ?? {})) merged[key] = values[key] ?? entry.default;
      return merged;
    },
    showToast: message => toastFn(`${plugin().def.name}: ${message}`),
    onMessageSend: fn => plugin().sendHooks.push(fn),
    onMessageCreate: fn => plugin().createHooks.push(fn),
    getData: key => loadPluginState()[id]?.data?.[key],
    setData: (key, value) => {
      const map = loadPluginState();
      const current = map[id] ?? { enabled: false, settings: {}, data: {} };
      map[id] = { ...current, data: { ...current.data, [key]: value } };
      savePluginState(map);
    }
  };
}

/** Scans both plugin directories, evaluates each .js file, and starts every enabled one. Call once at app startup, after settings are available. */
export function loadPlugins(onToast: (message: string) => void): void {
  toastFn = onToast;
  const state = loadPluginState();
  const seen = new Set<string>();
  const next: LoadedPlugin[] = [];

  for (const dir of pluginDirs()) {
    mkdirSync(dir, { recursive: true });
    let files: string[];
    try {
      files = readdirSync(dir).filter(f => f.endsWith(".js"));
    } catch {
      continue;
    }
    for (const file of files) {
      const id = file.slice(0, -3);
      if (seen.has(id)) continue; // userData/plugins wins if an id collides with a bundled one
      seen.add(id);

      const savedState = state[id];
      const enabled = savedState?.enabled ?? false; // opt-in: never auto-run a newly dropped-in plugin
      let def: PluginDefinition;
      let error: string | null = null;
      try {
        def = evaluatePluginSource(readFileSync(join(dir, file), "utf8"), file);
      } catch (err) {
        error = err instanceof PluginLoadError ? err.message : String(err);
        def = { name: id, description: "", authors: [] };
      }

      const entry: LoadedPlugin = {
        id,
        def,
        enabled: enabled && !error,
        error,
        sendHooks: [],
        createHooks: [],
        api: null as unknown as PluginRuntimeApi
      };
      entry.api = buildApi(id, def.settings, () => loadPluginState()[id]?.settings ?? {});
      next.push(entry);

      if (entry.enabled) startPlugin(entry);
    }
  }
  plugins = next;
}

function startPlugin(plugin: LoadedPlugin): void {
  try {
    plugin.def.start?.(plugin.api);
  } catch (err) {
    plugin.enabled = false;
    plugin.error = err instanceof Error ? err.message : String(err);
  }
}

function stopPlugin(plugin: LoadedPlugin): void {
  try {
    plugin.def.stop?.(plugin.api);
  } catch {
    // stop() failing shouldn't block disabling the plugin
  }
  plugin.sendHooks = [];
  plugin.createHooks = [];
}

export function listPlugins(): PluginInfo[] {
  const state = loadPluginState();
  return plugins.map(p => ({
    id: p.id,
    name: p.def.name,
    description: p.def.description ?? "",
    authors: p.def.authors ?? [],
    enabled: p.enabled,
    error: p.error,
    settingsSchema: p.def.settings,
    settingsValues: state[p.id]?.settings ?? {},
    portedFrom: p.def.portedFrom ?? null
  }));
}

export function setPluginEnabled(id: string, enabled: boolean): boolean {
  const plugin = plugins.find(p => p.id === id);
  if (!plugin || plugin.error) return false;

  const state = loadPluginState();
  state[id] = { enabled, settings: state[id]?.settings ?? {}, data: state[id]?.data ?? {} };
  savePluginState(state);

  if (enabled && !plugin.enabled) {
    plugin.enabled = true;
    startPlugin(plugin);
  } else if (!enabled && plugin.enabled) {
    plugin.enabled = false;
    stopPlugin(plugin);
  }
  return true;
}

export function setPluginSetting(id: string, key: string, value: boolean | number | string): boolean {
  const plugin = plugins.find(p => p.id === id);
  if (!plugin?.def.settings?.[key]) return false;

  const state = loadPluginState();
  state[id] = {
    enabled: state[id]?.enabled ?? false,
    settings: { ...state[id]?.settings, [key]: value },
    data: state[id]?.data ?? {}
  };
  savePluginState(state);
  return true;
}

/** Runs every enabled plugin's onMessageSend hooks in load order; a hook returning null cancels the send. */
export async function runMessageSendHooks(content: string, channelId: string): Promise<string | null> {
  let current = content;
  for (const plugin of plugins) {
    if (!plugin.enabled) continue;
    for (const hook of plugin.sendHooks) {
      try {
        const result = await hook(current, channelId);
        if (result === null) return null;
        current = result;
      } catch {
        // a misbehaving hook shouldn't block sending
      }
    }
  }
  return current;
}

export function runMessageCreateHooks(message: unknown): void {
  for (const plugin of plugins) {
    if (!plugin.enabled) continue;
    for (const hook of plugin.createHooks) {
      try {
        hook(message);
      } catch {
        // same as above — isolate one plugin's failure from the rest
      }
    }
  }
}
