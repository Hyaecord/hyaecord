// Reimplementation of Equicord's "WriteUpperCase" plugin
// (src/equicordplugins/writeUpperCase/index.ts) against Hyaecord's own
// plugin API — not the original code. See PLUGIN_PARITY.md.
//
// Sentence-splitting regex and capitalization logic ported as-is; the
// blocked-words list setting is the same idea, just a Hyaecord string
// setting instead of Vencord's OptionType.STRING.

definePlugin({
  name: "WriteUpperCase",
  description: "Changes the first letter of each sentence in your messages to uppercase.",
  authors: ["Samwich (Vencord)", "KrystalSkull (Equicord)", "Hyaecord"],
  portedFrom: {
    sources: ["equicord"],
    originalName: "WriteUpperCase",
    url: "https://github.com/Equicord/Equicord/blob/main/src/equicordplugins/writeUpperCase/index.ts"
  },
  settings: {
    blockedWords: {
      type: "string",
      label: "Words not to capitalise",
      description: "Comma-separated (e.g. http, https, ok) — a sentence starting with one of these is left alone.",
      default: "http, https, ok"
    }
  },
  start(api) {
    api.onMessageSend(content => {
      const blocked = api.settings.blockedWords.split(",").map(w => w.trim().toLowerCase()).filter(Boolean);
      const sentences = content.split(/(?<=[.!?]+['")\]]*)(\s+)/);
      return sentences
        .map((part, i) => {
          if (i % 2 === 1) return part; // whitespace separator, untouched
          if (blocked.some(word => part.toLowerCase().startsWith(word))) return part;
          return part.charAt(0).toUpperCase() + part.slice(1);
        })
        .join("");
    });
  }
});
