// Example Hyaecord plugin — demonstrates the plugin API end-to-end (a
// boolean setting, a message-send transform, a start/stop toast) rather
// than doing anything genuinely useful. Ships disabled by default, like
// every plugin (see manager.ts: enabling is always opt-in).
//
// See PLUGIN_GUIDELINES.md for the policy every plugin must follow, and
// sandbox.ts for exactly what API surface is available in here — there is
// no `require`, no filesystem/network access, nothing beyond what
// `definePlugin`'s `start(api)` argument exposes.

definePlugin({
  name: "Shrugify",
  description: "Appends ¯\\_(ツ)_/¯ to every message you send.",
  authors: ["Hyaecord"],
  settings: {
    enabled: {
      type: "boolean",
      label: "Append the shrug",
      description: "Turn off to keep the plugin loaded without changing anything.",
      default: true
    }
  },
  start(api) {
    api.onMessageSend(content => {
      if (!api.settings.enabled) return content;
      if (content.includes("¯\\_(ツ)_/¯")) return content; // don't double up
      return `${content} ¯\\_(ツ)_/¯`;
    });
    api.showToast("loaded");
  },
  stop(api) {
    api.showToast("unloaded");
  }
});
