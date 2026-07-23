import type { StickerPackSummary, StickerSummary } from "@shared/types";
import { el, t } from "./ui";

/**
 * The sticker picker — real standard Discord sticker packs
 * (`GET /sticker-packs`, docs.discord.food/resources/sticker), not a
 * guessed or third-party source. Sending a sticker is a real message
 * with `sticker_ids: [id]` instead of text content (see rest.ts's
 * sendSticker) — the composer input is untouched, matching how the real
 * client's sticker picker behaves (click to send immediately, same as
 * this app's own GIF picker).
 *
 * PNG/APNG/GIF stickers render as real images (the documented CDN/media
 * URL patterns). LOTTIE stickers (vector animations — a real, common
 * standard-sticker format) render as a name-only tile instead of an
 * animation: Discord doesn't expose a static raster fallback for them
 * over the CDN (confirmed in the docs, not assumed), and pulling in a
 * full Lottie player just for picker previews wasn't worth it for this
 * pass. They're still fully real, clickable, and send correctly —
 * only this app's own preview of them is simplified.
 */

const FORMAT_GIF = 4;
const FORMAT_LOTTIE = 3;

let openPicker: HTMLElement | null = null;
let packsCache: StickerPackSummary[] | null = null;

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

function stickerUrl(sticker: StickerSummary): string {
  return sticker.formatType === FORMAT_GIF
    ? `https://media.discordapp.net/stickers/${sticker.id}.gif`
    : `https://cdn.discordapp.com/stickers/${sticker.id}.png`;
}

function renderGrid(grid: HTMLElement, stickers: StickerSummary[], onPick: (id: string) => void): void {
  grid.replaceChildren();
  if (stickers.length === 0) {
    grid.append(el("p", { className: "sticker-picker-empty" }, t("stickerPicker.empty")));
    return;
  }
  for (const sticker of stickers) {
    const pick = () => onPick(sticker.id);
    if (sticker.formatType === FORMAT_LOTTIE) {
      grid.append(
        el("button", { type: "button", className: "sticker-tile sticker-tile-lottie", title: sticker.name, onClick: pick }, sticker.name)
      );
      continue;
    }
    const tile = el("button", { type: "button", className: "sticker-tile", title: sticker.name, "aria-label": sticker.name, onClick: pick });
    tile.append(el("img", { src: stickerUrl(sticker), alt: "", loading: "lazy" }));
    grid.append(tile);
  }
}

export function openStickerPicker(anchor: HTMLElement, onPick: (id: string) => void): void {
  if (openPicker) {
    closePicker();
    return;
  }

  const grid = el("div", { className: "sticker-picker-grid" }, el("p", { className: "sticker-picker-empty" }, t("stickerPicker.loading")));
  const tabs = el("div", { className: "sticker-picker-tabs", role: "tablist" });
  const picker = el(
    "div",
    { className: "sticker-picker", role: "dialog", "aria-label": t("stickerPicker.title") },
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

  const pick = (id: string) => {
    onPick(id);
    closePicker();
  };

  void (async () => {
    packsCache ??= await window.hyaecord.listStickerPacks();
    if (openPicker !== picker) return; // closed while loading
    if (packsCache.length === 0) {
      grid.replaceChildren(el("p", { className: "sticker-picker-empty" }, t("stickerPicker.empty")));
      return;
    }
    packsCache.forEach((pack, i) => {
      const tab = el(
        "button",
        {
          type: "button",
          className: i === 0 ? "sticker-tab is-active" : "sticker-tab",
          title: pack.name,
          onClick: (ev: Event) => {
            tabs.querySelectorAll(".sticker-tab").forEach(b => b.classList.remove("is-active"));
            (ev.currentTarget as HTMLElement).classList.add("is-active");
            renderGrid(grid, pack.stickers, pick);
          }
        },
        pack.name.slice(0, 2)
      );
      tabs.append(tab);
    });
    renderGrid(grid, packsCache[0]?.stickers ?? [], pick);
  })();
}
