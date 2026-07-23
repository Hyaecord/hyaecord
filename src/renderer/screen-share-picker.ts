import type { ScreenShareSource } from "@shared/types";
import { el, t, trapFocus } from "./ui";

/**
 * Real screen/window source picker for screen sharing — Electron's actual
 * `desktopCapturer` API (main process, exposed over IPC in
 * getScreenShareSources; see main/index.ts), showing live thumbnails of
 * your real screens and windows. This is the "selecting sources" half of
 * screen sharing and stands on its own: picking a source here returns a
 * real Electron `chromeMediaSourceId` usable with
 * `navigator.mediaDevices.getUserMedia({ video: { mandatory: {
 * chromeMediaSourceId } } })` to actually capture that screen/window.
 *
 * Sending the captured stream to a Discord voice channel (the "Go Live"
 * half) needs the voice media transport this project has deliberately
 * not built yet — see voice-gateway.ts's own scope note. Choosing a
 * source here is real and independently useful (e.g. a future local
 * recording feature), but it doesn't yet feed into an actual outgoing
 * stream.
 */

let openPicker: HTMLElement | null = null;

function closePicker(): void {
  if (!openPicker) return;
  const cleanup = (openPicker as HTMLElement & { __cleanup?: () => void }).__cleanup;
  cleanup?.();
  openPicker.remove();
  openPicker = null;
}

function sourceTile(source: ScreenShareSource, onPick: (source: ScreenShareSource) => void): HTMLElement {
  const isScreen = source.id.startsWith("screen:");
  const tile = el(
    "button",
    { type: "button", className: "share-source-tile", title: source.name, onClick: () => onPick(source) },
    el("img", { className: "share-source-thumb", src: source.thumbnailDataUrl, alt: "" }),
    el(
      "span",
      { className: "share-source-label" },
      source.appIconDataUrl ? el("img", { className: "share-source-icon", src: source.appIconDataUrl, alt: "" }) : "",
      el("span", { className: "share-source-name" }, isScreen ? t("screenShare.entireScreen") : source.name)
    )
  );
  return tile;
}

export function openScreenSharePicker(onPick: (source: ScreenShareSource) => void): void {
  if (openPicker) {
    closePicker();
    return;
  }

  const grid = el("div", { className: "share-source-grid" }, el("p", { className: "step-hint" }, t("screenShare.loading")));
  const close = () => closePicker();

  const dialog = el(
    "div",
    { className: "modal share-source-modal", role: "dialog", "aria-modal": "true", "aria-labelledby": "share-source-title" },
    el("div", { className: "settings-header" },
      el("h1", { id: "share-source-title" }, t("screenShare.title")),
      el("button", { className: "btn ghost close", type: "button", "aria-label": t("settings.close"), onClick: close }, "✕")
    ),
    grid
  );

  const overlay = el("div", { className: "overlay" }, dialog);
  overlay.addEventListener("keydown", ev => {
    if (ev.key === "Escape") close();
  });
  overlay.addEventListener("mousedown", ev => {
    if (ev.target === overlay) close();
  });
  const cleanup = trapFocus(overlay);
  (overlay as HTMLElement & { __cleanup?: () => void }).__cleanup = cleanup;
  document.body.append(overlay);
  openPicker = overlay;
  (dialog.querySelector(".close") as HTMLButtonElement).focus();

  void window.hyaecord.getScreenShareSources().then(sources => {
    if (openPicker !== overlay) return;
    grid.replaceChildren();
    if (sources.length === 0) {
      grid.append(el("p", { className: "step-hint" }, t("screenShare.empty")));
      return;
    }
    for (const source of sources) {
      grid.append(
        sourceTile(source, picked => {
          onPick(picked);
          closePicker();
        })
      );
    }
  });
}
