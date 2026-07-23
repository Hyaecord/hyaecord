import twemoji from "@twemoji/api";

/**
 * Renders emoji as Twemoji images instead of relying on the OS's own
 * emoji font — the same approach Discord's real official client uses,
 * for the same reason: consistent appearance across Windows/Linux/macOS
 * regardless of what emoji font (or lack of one) the system has. Real
 * package (`@twemoji/api`, MIT + CC-BY-4.0, the maintained continuation
 * of Twitter's original `twemoji` after it was archived), not a
 * hand-rolled codepoint-to-URL scheme — getting that mapping exactly
 * right (variation selectors, ZWJ sequences, flag pairs) is exactly the
 * kind of thing worth using a real, tested library for instead of
 * guessing.
 *
 * Safe to call on already-rendered content: `twemoji.parse()` walks an
 * element's existing text nodes looking for emoji substrings and splices
 * in `<img>` elements for matches — it never interprets the text as HTML,
 * so this doesn't weaken the "message content must never become HTML"
 * rule elsewhere in the renderer (session.ts). Call it *after* setting
 * `.textContent`, never as a replacement for that.
 */
export function applyTwemoji(el: HTMLElement): void {
  twemoji.parse(el, { className: "emoji", size: "72x72" });
}
