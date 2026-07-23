import type { GifResult } from "@shared/types";
import { el, t } from "./ui";

/**
 * The GIF picker: a search box over a masonry grid, backed by Discord's own
 * `/gifs/search` and `/gifs/trending-gifs` (proxied Tenor results, no
 * separate API key needed — see docs.discord.food/resources/integration).
 * Masonry is plain CSS `columns` rather than a layout library; at picker
 * scale (a couple dozen tiles) there's no reflow cost worth optimizing for.
 */

const SEARCH_DEBOUNCE_MS = 350;

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

function renderGrid(grid: HTMLElement, gifs: GifResult[], onPick: (url: string) => void): void {
  grid.replaceChildren();
  if (gifs.length === 0) {
    grid.append(el("p", { className: "gif-picker-empty" }, t("gifPicker.empty")));
    return;
  }
  for (const gif of gifs) {
    const tile = el("button", {
      type: "button",
      className: "gif-tile",
      style: `aspect-ratio: ${gif.width} / ${gif.height};`,
      title: gif.title,
      "aria-label": gif.title,
      onClick: () => {
        onPick(gif.url);
        closePicker();
      }
    });
    const video = el("video", {
      src: gif.videoSrc,
      autoplay: true,
      loop: true,
      muted: true,
      playsinline: true,
      "aria-hidden": "true"
    });
    tile.append(video);
    grid.append(tile);
  }
}

export function openGifPicker(anchor: HTMLElement, onPick: (url: string) => void): void {
  if (openPicker) {
    closePicker();
    return;
  }

  const searchInput = el("input", {
    type: "text",
    className: "gif-picker-search",
    placeholder: t("gifPicker.searchPlaceholder"),
    "aria-label": t("gifPicker.searchPlaceholder")
  }) as HTMLInputElement;
  const grid = el("div", { className: "gif-picker-grid" });
  const picker = el(
    "div",
    { className: "gif-picker", role: "dialog", "aria-label": t("gifPicker.title") },
    searchInput,
    grid
  );

  const rect = anchor.getBoundingClientRect();
  picker.style.right = `${window.innerWidth - rect.right}px`;
  picker.style.bottom = `${window.innerHeight - rect.top + 8}px`;

  document.body.append(picker);
  openPicker = picker;
  document.addEventListener("pointerdown", onOutsideClick, true);
  document.addEventListener("keydown", onEscape, true);

  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let requestId = 0;
  const runSearch = (query: string) => {
    const thisRequest = ++requestId;
    void window.hyaecord.searchGifs(query).then(gifs => {
      if (openPicker !== picker || thisRequest !== requestId) return;
      renderGrid(grid, gifs, onPick);
    });
  };

  searchInput.addEventListener("input", () => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => runSearch(searchInput.value), SEARCH_DEBOUNCE_MS);
  });

  grid.append(el("p", { className: "gif-picker-empty" }, t("gifPicker.loading")));
  runSearch("");
  searchInput.focus();
}
