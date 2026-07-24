import emojiGroups from "unicode-emoji-json/data-by-group.json";
import { el, t } from "./ui";
import { applyTwemoji } from "./twemoji";

/**
 * An emoji picker: category tabs + search over the real Unicode emoji
 * dataset (unicode-emoji-json — MIT, no runtime deps, sourced from
 * unicode.org, not hand-typed codepoints), plus a real "This Server" tab
 * of a Stoat guild's own custom emoji when the caller has any (see
 * `stoat-session.ts`'s `fetchStoatServerEmojis` — real `GET
 * /servers/{id}/emojis`). Animated stickers aren't in scope here (same
 * reasoning the GIF picker used: build what's real now, not a guess at a
 * bigger system).
 *
 * Clicking a unicode emoji inserts the character itself; clicking a
 * custom one inserts its real `:id:` shortcode (Stoat's actual
 * message-content syntax for a custom emoji — see
 * `fillStoatMessageContent`'s rendering of the same syntax back into an
 * image). Either way this is an insert-into-composer action, not a send
 * — matches how every real emoji picker behaves. The caller (a message's
 * reaction-add button) that actually wants a *reaction* target strips
 * the surrounding colons back off since the real reaction endpoint takes
 * a bare id for a custom emoji, just like it takes a bare unicode
 * character for a standard one.
 */

interface EmojiEntry {
  emoji: string;
  name: string;
}

export interface CustomEmojiEntry {
  id: string;
  name: string;
  url: string;
}

const GROUPS: Array<{ slug: string; name: string; emojis: EmojiEntry[] }> = Object.values(emojiGroups).map(g => ({
  slug: g.slug,
  name: g.name,
  emojis: g.emojis.map(e => ({ emoji: e.emoji, name: e.name }))
}));

let openPicker: HTMLElement | null = null;

function closePicker(): void {
  openPicker?.remove();
  openPicker = null;
  document.removeEventListener("pointerdown", onOutsideClick, true);
  document.removeEventListener("keydown", onEscape, true);
}

function onOutsideClick(ev: PointerEvent): void {
  if (openPicker && !openPicker.contains(ev.target as Node)) closePicker();
}

function onEscape(ev: KeyboardEvent): void {
  if (ev.key === "Escape") closePicker();
}

function renderGrid(grid: HTMLElement, entries: EmojiEntry[], onPick: (emoji: string) => void): void {
  grid.replaceChildren();
  if (entries.length === 0) {
    grid.append(el("p", { className: "emoji-picker-empty" }, t("emojiPicker.empty")));
    return;
  }
  for (const entry of entries) {
    const tile = el(
      "button",
      { type: "button", className: "emoji-tile", title: entry.name, "aria-label": entry.name, onClick: () => onPick(entry.emoji) },
      entry.emoji
    );
    applyTwemoji(tile);
    grid.append(tile);
  }
}

function renderCustomGrid(grid: HTMLElement, entries: CustomEmojiEntry[], onPick: (emoji: string) => void): void {
  grid.replaceChildren();
  if (entries.length === 0) {
    grid.append(el("p", { className: "emoji-picker-empty" }, t("emojiPicker.empty")));
    return;
  }
  for (const entry of entries) {
    const tile = el(
      "button",
      {
        type: "button",
        className: "emoji-tile",
        title: `:${entry.name}:`,
        "aria-label": entry.name,
        onClick: () => onPick(`:${entry.id}:`)
      },
      el("img", { className: "custom-emoji", src: entry.url, alt: entry.name, loading: "lazy" })
    );
    grid.append(tile);
  }
}

export function openEmojiPicker(anchor: HTMLElement, onPick: (emoji: string) => void, customEmoji: CustomEmojiEntry[] = []): void {
  if (openPicker) {
    closePicker();
    return;
  }

  const searchInput = el("input", {
    type: "text",
    className: "emoji-picker-search",
    placeholder: t("emojiPicker.searchPlaceholder"),
    "aria-label": t("emojiPicker.searchPlaceholder")
  }) as HTMLInputElement;

  const grid = el("div", { className: "emoji-picker-grid" });

  const pick = (emoji: string): void => {
    onPick(emoji);
    closePicker();
  };

  const customTab =
    customEmoji.length > 0
      ? [
          el(
            "button",
            {
              type: "button",
              className: "emoji-tab",
              title: t("emojiPicker.serverTab"),
              "aria-label": t("emojiPicker.serverTab"),
              onClick: (ev: Event) => {
                document.querySelectorAll(".emoji-tab").forEach(b => b.classList.remove("is-active"));
                (ev.currentTarget as HTMLElement).classList.add("is-active");
                searchInput.value = "";
                renderCustomGrid(grid, customEmoji, pick);
              }
            },
            el("img", { className: "custom-emoji", src: customEmoji[0]!.url, alt: "" })
          )
        ]
      : [];

  const tabs = el(
    "div",
    { className: "emoji-picker-tabs", role: "tablist" },
    ...customTab,
    ...GROUPS.map((group, i) =>
      el(
        "button",
        {
          type: "button",
          className: i === 0 && customEmoji.length === 0 ? "emoji-tab is-active" : "emoji-tab",
          title: group.name,
          "aria-label": group.name,
          onClick: (ev: Event) => {
            document.querySelectorAll(".emoji-tab").forEach(b => b.classList.remove("is-active"));
            (ev.currentTarget as HTMLElement).classList.add("is-active");
            searchInput.value = "";
            renderGrid(grid, group.emojis, pick);
          }
        },
        group.emojis[0]?.emoji ?? "?"
      )
    )
  );

  const picker = el(
    "div",
    { className: "emoji-picker", role: "dialog", "aria-label": t("emojiPicker.title") },
    searchInput,
    tabs,
    grid
  );

  const rect = anchor.getBoundingClientRect();
  picker.style.right = `${window.innerWidth - rect.right}px`;
  picker.style.bottom = `${window.innerHeight - rect.top + 8}px`;

  document.body.append(picker);
  openPicker = picker;
  document.addEventListener("pointerdown", onOutsideClick, true);
  document.addEventListener("keydown", onEscape, true);

  searchInput.addEventListener("input", () => {
    const query = searchInput.value.trim().toLowerCase();
    if (!query) {
      document.querySelectorAll(".emoji-tab").forEach((b, i) => b.classList.toggle("is-active", i === 0));
      if (customEmoji.length > 0) renderCustomGrid(grid, customEmoji, pick);
      else renderGrid(grid, GROUPS[0]?.emojis ?? [], pick);
      return;
    }
    document.querySelectorAll(".emoji-tab").forEach(b => b.classList.remove("is-active"));
    const customMatches = customEmoji.filter(e => e.name.toLowerCase().includes(query));
    const unicodeMatches = GROUPS.flatMap(g => g.emojis).filter(e => e.name.includes(query));
    if (customMatches.length > 0) {
      grid.replaceChildren();
      renderCustomGrid(grid, customMatches, pick);
      const unicodeGrid = el("div", { className: "emoji-picker-grid" });
      renderGrid(unicodeGrid, unicodeMatches, pick);
      grid.append(...unicodeGrid.childNodes);
    } else {
      renderGrid(grid, unicodeMatches, pick);
    }
  });

  if (customEmoji.length > 0) renderCustomGrid(grid, customEmoji, pick);
  else renderGrid(grid, GROUPS[0]?.emojis ?? [], pick);
  searchInput.focus();
}
