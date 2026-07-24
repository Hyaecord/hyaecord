// Partial reimplementation of Vencord's "SendTimestamps" plugin
// (src/plugins/sendTimestamps/index.tsx) against Hyaecord's own plugin
// API — not the original code. See PLUGIN_PARITY.md.
//
// Only the auto-replace-on-send half is ported: type a time wrapped in
// backticks (`3:51`, `17:59`, `0:13PM`) and it becomes a real Discord
// timestamp (<t:...:t>) that renders as a live, timezone-aware relative
// time for everyone who sees it. The original's chat-bar button + date
// picker modal isn't ported (no chat-bar-button or modal API in the
// sandbox) — this is the self-contained regex-and-Date half of the file,
// copied faithfully (parseTime's logic is unchanged).

function parseTime(time) {
  const cleanTime = time.slice(1, -1).replace(/(\d)(AM|PM)$/i, "$1 $2");
  let ms = new Date(`${new Date().toDateString()} ${cleanTime}`).getTime() / 1000;
  if (isNaN(ms)) return time;
  if (Date.now() / 1000 > ms) ms += 86400; // time already passed today -> assume tomorrow
  return `<t:${Math.round(ms)}:t>`;
}

definePlugin({
  name: "SendTimestamps",
  description: "Type a time in backticks (`3:51`, `17:59`, `0:13PM`) and it becomes a real Discord timestamp.",
  authors: ["Ven, Tyler, Grzesiek11 (Vencord)", "Hyaecord"],
  portedFrom: {
    sources: ["vencord", "equicord"],
    originalName: "SendTimestamps",
    url: "https://github.com/Equicord/Equicord/blob/main/src/plugins/sendTimestamps/index.tsx"
  },
  settings: {
    enabled: {
      type: "boolean",
      label: "Replace backtick-wrapped times",
      description: "Original also had a chat-bar date-picker button; not ported (no modal API here).",
      default: true
    }
  },
  start(api) {
    api.onMessageSend(content => {
      if (!api.settings.enabled) return content;
      return content.replace(/`\d{1,2}:\d{2} ?(?:AM|PM)?`/gi, parseTime);
    });
  }
});
