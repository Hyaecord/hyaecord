// Reimplementation of Equicord's "GoogleThat" plugin
// (src/equicordplugins/googleThat/index.ts) against Hyaecord's own
// plugin API — not the original code. See PLUGIN_PARITY.md.
//
// The original registers a real Discord slash command via Vencord's
// CommandsAPI (which itself hooks into Discord's own internal built-in
// command list through webpack — nothing this app has). This port uses
// Hyaecord's own local `/name` command system instead (registerCommand,
// see sandbox.ts) — same end result (typing "/googlethat query" sends a
// search link), different mechanism. Only the default Google engine is
// ported; the original's engine picker and custom-URL setting aren't
// (Hyaecord's plugin settings don't have a SELECT type to match with).

definePlugin({
  name: "GoogleThat",
  description: "Adds a /googlethat command that sends a Google search link.",
  authors: ["Samwich (Vencord)", "KrystalSkull (Equicord)", "Hyaecord"],
  portedFrom: {
    sources: ["equicord"],
    originalName: "GoogleThat",
    url: "https://github.com/Equicord/Equicord/blob/main/src/equicordplugins/googleThat/index.ts"
  },
  settings: {
    hyperlink: {
      type: "boolean",
      label: "Hyperlink the query",
      description: "Show the query text as a clickable label instead of a bare, embeddable link.",
      default: false
    }
  },
  start(api) {
    api.registerCommand("googlethat", "Send a Google search link.", query => {
      if (!query) return null;
      const url = `https://www.google.com/search?q=${encodeURIComponent(query)}`;
      return api.settings.hyperlink ? `[${query}](<${url}>)` : `<${url}>`;
    });
  }
});
