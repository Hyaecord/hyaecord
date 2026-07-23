import { el } from "./ui";

/**
 * Discord's own classic built-in text commands (/shrug, /tableflip,
 * /unflip, /me) — not a Vencord/Equicord plugin feature at all, these
 * ship in Discord's real official client and were simply never built
 * here. Their exact transforms aren't documented on docs.discord.food
 * (they're client-side UI behaviour, not a REST/gateway concept), so
 * verified against multiple independent descriptions of long-observed,
 * unchanged Discord behaviour rather than a single guessed source:
 * /shrug and /tableflip/unflip append a fixed string (word-for-word
 * matching, not approximated), /me wraps the message in Discord's own
 * italics markdown (a single pair of asterisks).
 *
 * This is Hyaecord's own local reimplementation — a real Discord
 * webpack-patched slash-command *picker UI* is what Vencord's
 * CommandsAPI actually hooks into (confirmed by reading its source: it
 * grabs option shapes off Discord's own internal `BUILT_IN` command
 * list, it doesn't define the commands itself), which doesn't exist in
 * this app's original GUI. What's built here is a new, small, original
 * autocomplete + transform system that reproduces the same *end result*
 * for these four specific commands, not a port of anyone's code.
 */

export interface SlashCommand {
  name: string;
  description: string;
  transform: (rest: string) => string;
}

export const BUILT_IN_COMMANDS: SlashCommand[] = [
  {
    name: "shrug",
    description: "Appends ¯\\_(ツ)_/¯ to your message.",
    transform: rest => (rest ? `${rest} ¯\\_(ツ)_/¯` : "¯\\_(ツ)_/¯")
  },
  {
    name: "tableflip",
    description: "Appends (╯°□°）╯︵ ┻━┻ to your message.",
    transform: rest => (rest ? `${rest} (╯°□°）╯︵ ┻━┻` : "(╯°□°）╯︵ ┻━┻")
  },
  {
    name: "unflip",
    description: "Appends ┬─┬ ノ( ゜-゜ノ) to your message.",
    transform: rest => (rest ? `${rest} ┬─┬ ノ( ゜-゜ノ)` : "┬─┬ ノ( ゜-゜ノ)")
  },
  {
    name: "me",
    description: "Sends your message in italics.",
    transform: rest => (rest ? `*${rest}*` : rest)
  }
];

/**
 * Plugin-registered commands (via `api.registerCommand`, see
 * PLUGIN_GUIDELINES.md/sandbox.ts) merge into the same autocomplete and
 * "/name" syntax as the built-ins above — the composer doesn't care which
 * kind it's running. Fetched once at startup and cached; a plugin toggled
 * on/off mid-session won't be reflected until `refreshPluginCommands()`
 * is called again (wired from settings-ui.ts's plugin enable/disable
 * handler) — a deliberate, small staleness window rather than an IPC
 * round trip on every keystroke.
 */
let pluginCommands: Array<{ name: string; description: string }> = [];

export async function refreshPluginCommands(): Promise<void> {
  pluginCommands = await window.hyaecord.getPluginCommands();
}

export type SlashCommandResult = { handled: false } | { handled: true; content: string | null };

/**
 * If `content` starts with a known "/command" (own word, i.e. followed by
 * a space or end-of-string), runs it. `handled: false` means it wasn't a
 * recognised command at all — send the original text as-is. `handled:
 * true, content: null` means a plugin command matched but explicitly
 * declined to produce a message (same convention as onMessageSend's
 * cancel-by-null) — don't send anything. Built-ins resolve locally;
 * plugin commands round-trip to the main process where the plugin's
 * function actually lives.
 */
export async function tryExecuteSlashCommand(content: string): Promise<SlashCommandResult> {
  const match = content.match(/^\/(\S+)(?:\s+([\s\S]*))?$/);
  if (!match) return { handled: false };
  const [, name = "", rest = ""] = match;
  const lower = name.toLowerCase();
  const builtIn = BUILT_IN_COMMANDS.find(c => c.name === lower);
  if (builtIn) return { handled: true, content: builtIn.transform(rest.trim()) };
  if (pluginCommands.some(c => c.name === lower)) {
    return { handled: true, content: await window.hyaecord.runPluginCommand(lower, rest.trim()) };
  }
  return { handled: false };
}

/** Commands whose name starts with `query` (the text typed after "/" so far) — built-ins first, then plugin commands. */
export function matchCommands(query: string): Array<{ name: string; description: string }> {
  const q = query.toLowerCase();
  return [...BUILT_IN_COMMANDS, ...pluginCommands].filter(c => c.name.startsWith(q));
}

let suggestionsEl: HTMLElement | null = null;

export function closeSlashSuggestions(): void {
  suggestionsEl?.remove();
  suggestionsEl = null;
}

/** Shows a small suggestion list above the composer for commands matching what's typed after "/" so far. `onPick` receives the chosen command's name. */
export function showSlashSuggestions(anchor: HTMLElement, query: string, onPick: (name: string) => void): void {
  const matches = matchCommands(query);
  closeSlashSuggestions();
  if (matches.length === 0) return;

  const list = el(
    "div",
    { className: "slash-suggestions", role: "listbox" },
    ...matches.map(cmd =>
      el(
        "button",
        { type: "button", className: "slash-suggestion", role: "option", onClick: () => onPick(cmd.name) },
        el("span", { className: "slash-suggestion-name" }, `/${cmd.name}`),
        el("span", { className: "slash-suggestion-desc" }, cmd.description)
      )
    )
  );

  const rect = anchor.getBoundingClientRect();
  list.style.left = `${rect.left}px`;
  list.style.bottom = `${window.innerHeight - rect.top + 8}px`;

  document.body.append(list);
  suggestionsEl = list;
}
