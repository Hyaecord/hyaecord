import type { PinSummary } from "@shared/types";
import { el, showToast, t } from "./ui";
import { applyTwemoji } from "./twemoji";

/**
 * The pinned-messages panel — closes the last real gap in the README's
 * "Browsing a channel's pinned messages — Not yet built" row (separate
 * from item 42's inline pin *notices*, which already existed). Backed by
 * Discord's real, current pins API (docs.discord.food/resources/message):
 * `GET /channels/{channel.id}/messages/pins`, the non-deprecated
 * replacement for the older `GET /channels/{channel.id}/pins` — using the
 * one the docs themselves point to, not the deprecated one.
 */

let openPanel: HTMLElement | null = null;

function closePinsPanel(): void {
  openPanel?.remove();
  openPanel = null;
  document.removeEventListener("pointerdown", onOutsideClick, true);
  document.removeEventListener("keydown", onEscape, true);
}

function onOutsideClick(ev: PointerEvent): void {
  if (openPanel && !openPanel.contains(ev.target as Node)) closePinsPanel();
}

function onEscape(ev: KeyboardEvent): void {
  if (ev.key === "Escape") closePinsPanel();
}

function pinRow(pin: PinSummary, list: HTMLElement, channelId: string, canUnpin: boolean): HTMLElement {
  const time = pin.timestamp ? new Date(pin.timestamp).toLocaleDateString() : "";
  const contentEl = el("p", { className: "pin-item-content" }, pin.content || t("messageSearch.noContent"));
  applyTwemoji(contentEl);
  const children: (Node | string)[] = [
    el("div", { className: "pin-item-meta" },
      el("span", { className: "pin-item-author" }, pin.authorName),
      el("span", {}, time)
    ),
    contentEl
  ];
  if (canUnpin) {
    children.push(
      el(
        "button",
        {
          type: "button",
          className: "btn ghost pin-item-unpin",
          onClick: async () => {
            const ok = await window.hyaecord.unpinMessage(channelId, pin.id);
            if (!ok) {
              showToast(t("pins.actionFailed"));
              return;
            }
            void renderPins(list, channelId, canUnpin);
          }
        },
        t("pins.unpin")
      )
    );
  }
  return el("div", { className: "pin-item" }, ...children);
}

async function renderPins(list: HTMLElement, channelId: string, canUnpin: boolean): Promise<void> {
  list.replaceChildren(el("p", { className: "pins-panel-empty" }, t("pins.loading")));
  const pins = await window.hyaecord.listMessagePins(channelId);
  if (openPanel === null) return; // closed while loading
  list.replaceChildren();
  if (pins.length === 0) {
    list.append(el("p", { className: "pins-panel-empty" }, t("pins.empty")));
    return;
  }
  for (const pin of pins) list.append(pinRow(pin, list, channelId, canUnpin));
}

export function openPinsPanel(anchor: HTMLElement, channelId: string, canUnpin: boolean): void {
  if (openPanel) {
    closePinsPanel();
    return;
  }

  const list = el("div", { className: "pins-panel-list" });
  const panel = el(
    "div",
    { className: "pins-panel", role: "dialog", "aria-label": t("pins.title") },
    el("div", { className: "pins-panel-header" }, t("pins.title")),
    list
  );

  const rect = anchor.getBoundingClientRect();
  panel.style.right = `${window.innerWidth - rect.right}px`;
  panel.style.top = `${rect.bottom + 8}px`;

  document.body.append(panel);
  openPanel = panel;
  document.addEventListener("pointerdown", onOutsideClick, true);
  document.addEventListener("keydown", onEscape, true);

  void renderPins(list, channelId, canUnpin);
}
