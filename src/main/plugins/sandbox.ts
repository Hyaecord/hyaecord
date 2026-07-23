import vm from "node:vm";

/**
 * Executes one plugin file's source in a restricted vm.Context — no
 * `require`, no `process`, no filesystem/network access, no reference to
 * anything outside the small `Hyaecord` API object this module hands in.
 * This is the actual security boundary: a plugin can only do what the
 * exposed API lets it do, not "whatever Node can do".
 *
 * ⚠ Scope, stated plainly: this is Hyaecord's own plugin API, ergonomically
 * modeled on Vencord's `definePlugin` shape (name/description/authors/
 * settings/start/stop) so porting a *simple* plugin is familiar — it is
 * NOT byte-compatible with real Vencord/Equicord plugin files. Those rely
 * on patching Discord's own webpack bundle (`Vencord.Webpack.findByProps`,
 * DOM/component patches) and Hyaecord's GUI is original code, not a
 * webpack bundle — there is nothing for that kind of patch to attach to.
 * A plugin that only uses message-level hooks (the "onMessageSend"/
 * "onMessageCreate" style below) can be ported with minor changes; a
 * plugin that reaches into Discord's real component tree cannot run here
 * at all, sandboxed or not. See PLUGIN_GUIDELINES.md and BUILD_PROMPT.md
 * for the corrected claim — earlier drafts overstated this as "runs most
 * plugins unmodified," which isn't accurate for what's actually built.
 */

export type SettingType = "boolean" | "number" | "string";

export interface SettingSchemaEntry {
  type: SettingType;
  label: string;
  description?: string;
  default: boolean | number | string;
  min?: number;
  max?: number;
  step?: number;
}

export interface PluginRuntimeApi {
  /** Current values for this plugin's declared settings (schema defaults merged with any saved overrides). */
  settings: Record<string, boolean | number | string>;
  /** A brief, non-blocking status message in the renderer — same toast used elsewhere in the app. */
  showToast(message: string): void;
  /** Registers a transform run on every outgoing message before it's sent; return null to cancel the send. Multiple plugins' transforms compose in load order. */
  onMessageSend(fn: (content: string, channelId: string) => string | null | Promise<string | null>): void;
  /** Registers a read-only callback for every incoming MESSAGE_CREATE dispatch (the raw Discord payload). */
  onMessageCreate(fn: (message: unknown) => void): void;
}

export interface PluginDefinition {
  name: string;
  description: string;
  authors: string[];
  settings?: Record<string, SettingSchemaEntry>;
  start?: (api: PluginRuntimeApi) => void;
  stop?: (api: PluginRuntimeApi) => void;
}

export class PluginLoadError extends Error {}

/**
 * Runs `source` (one plugin file's contents) inside a fresh vm.Context and
 * returns whatever it passed to the injected `definePlugin()` — throws
 * PluginLoadError on a syntax error, a missing/duplicate `definePlugin`
 * call, or an exception during the file's top-level evaluation.
 */
export function evaluatePluginSource(source: string, filename: string): PluginDefinition {
  let captured: PluginDefinition | null = null;

  const sandbox: Record<string, unknown> = {
    definePlugin(def: PluginDefinition) {
      if (captured) throw new Error("definePlugin() called more than once");
      if (!def || typeof def !== "object" || typeof def.name !== "string") {
        throw new Error("definePlugin() requires at least a { name } object");
      }
      captured = def;
      return def;
    },
    console: {
      log: (...args: unknown[]) => console.log(`[plugin:${filename}]`, ...args),
      warn: (...args: unknown[]) => console.warn(`[plugin:${filename}]`, ...args),
      error: (...args: unknown[]) => console.error(`[plugin:${filename}]`, ...args)
    }
  };

  const context = vm.createContext(sandbox, {
    codeGeneration: { strings: false, wasm: false }
  });

  try {
    const script = new vm.Script(source, { filename });
    script.runInContext(context, { timeout: 2000 });
  } catch (err) {
    throw new PluginLoadError(err instanceof Error ? err.message : String(err));
  }

  if (!captured) {
    throw new PluginLoadError("plugin file never called definePlugin(...)");
  }
  return captured;
}

/**
 * ⚠ Known limitation, not solved here: the `timeout` option above only
 * guards the plugin file's initial top-level evaluation. Once `start()`/
 * `stop()`/a hook function is captured, later calls to it are ordinary
 * cross-realm function calls — vm.Script's timeout doesn't wrap them, so a
 * plugin with an infinite loop inside `start()` or a message hook can still
 * hang the main process. A real fix needs each call to go through a fresh
 * timed vm.Script, or moving plugin execution to a Worker thread that can
 * be terminated — neither is done here. Don't treat this sandbox as a
 * defense against a plugin that's actively trying to hang the app, only
 * against one reaching outside its intended API surface.
 */
