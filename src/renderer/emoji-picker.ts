import emojiGroups from "unicode-emoji-json/data-by-group.json";
import { el, t } from "./ui";

/**
 * A unicode emoji picker: category tabs + search over the real Unicode
 * emoji dataset (unicode-emoji-json — MIT, no runtime deps, sourced from
 * unicode.org, not hand-typed codepoints). Custom server emoji and
 * animated stickers aren't in scope here (same reasoning the GIF picker
 * used: build what's real now, not a guess at a bigger system) — this is
 * the unicode-only half of the "emoji/GIF/sticker picker" V1 checklist
 * item.
 *
 * Clicking an emoji inserts it into the composer at the cursor rather
 * than sending immediately (unlike the GIF picker) — matches how every
 * real emoji picker behaves; you're still typing a message, not posting
 * one attachment.
 */

interface EmojiEntry {
  emoji: string;
  name: string;
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
    grid.append(tile);
  }
}

export function openEmojiPicker(anchor: HTMLElement, onPick: (emoji: string) => void): void {
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

  const tabs = el(
    "div",
    { className: "emoji-picker-tabs", role: "tablist" },
    ...GROUPS.map((group, i) =>
      el(
        "button",
        {
          type: "button",
          className: i === 0 ? "emoji-tab is-active" : "emoji-tab",
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

  const pick = (emoji: string): void => {
    onPick(emoji);
    closePicker();
  };

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
      renderGrid(grid, GROUPS[0]?.emojis ?? [], pick);
      return;
    }
    document.querySelectorAll(".emoji-tab").forEach(b => b.classList.remove("is-active"));
    const matches = GROUPS.flatMap(g => g.emojis).filter(e => e.name.includes(query));
    renderGrid(grid, matches, pick);
  });

  renderGrid(grid, GROUPS[0]?.emojis ?? [], pick);
  searchInput.focus();
}
