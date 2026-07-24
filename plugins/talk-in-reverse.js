// Reimplementation of Equicord's "TalkInReverse" plugin
// (src/equicordplugins/talkInReverse/index.tsx) against Hyaecord's own
// plugin API — not the original code. See PLUGIN_PARITY.md.
//
// The original toggles per-message via a chat-bar button (React UI this
// sandbox has no access to build); this port uses a settings toggle
// instead, same net effect. Core transform is identical:
// `content.split("").reverse().join("")`.

definePlugin({
  name: "TalkInReverse",
  description: "Reverses the message content before sending it.",
  authors: ["Tolgchu (Equicord)", "Hyaecord"],
  portedFrom: {
    sources: ["equicord"],
    originalName: "TalkInReverse",
    url: "https://github.com/Equicord/Equicord/blob/main/src/equicordplugins/talkInReverse/index.tsx"
  },
  settings: {
    enabled: {
      type: "boolean",
      label: "Reverse outgoing messages",
      description: "Original used a chat-bar toggle button; this port uses a settings switch instead.",
      default: false
    }
  },
  start(api) {
    api.onMessageSend(content => {
      if (!api.settings.enabled) return content;
      return content.split("").reverse().join("");
    });
  }
});
