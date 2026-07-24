// Reimplementation of Equicord's "Signature" plugin
// (src/equicordplugins/signature/index.tsx) against Hyaecord's own plugin
// API — not the original code. See PLUGIN_PARITY.md.
//
// The original's `textProcessing` also supports random per-message picks
// from a list and a couple of other header styles this port doesn't
// replicate; kept to the core "append header + signature" behaviour that
// the plugin's description and default settings centre on.

definePlugin({
  name: "Signature",
  description: "Appends a signature to the end of your messages.",
  authors: ["Ven, Rini, ImBanana (Vencord)", "KrystalSkull (Equicord)", "Hyaecord"],
  portedFrom: {
    sources: ["equicord"],
    originalName: "Signature",
    url: "https://github.com/Equicord/Equicord/blob/main/src/equicordplugins/signature/index.tsx"
  },
  settings: {
    enabled: {
      type: "boolean",
      label: "Enabled",
      default: true
    },
    text: {
      type: "string",
      label: "Signature text",
      default: "a chronic discord user"
    },
    textHeader: {
      type: "string",
      label: "Header",
      description: "Prefixes the signature on its own line.",
      default: ">"
    }
  },
  start(api) {
    api.onMessageSend(content => {
      if (!api.settings.enabled) return content;
      const header = api.settings.textHeader ? `${api.settings.textHeader} ` : "";
      return `${content}\n${header}${api.settings.text}`;
    });
  }
});
