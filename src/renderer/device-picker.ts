import { el, t, trapFocus } from "./ui";
import { icon } from "./icons";

/**
 * Real camera/microphone device picker — standard
 * `navigator.mediaDevices.enumerateDevices()`, listing this machine's
 * actual hardware. No IPC needed: `navigator.mediaDevices` is a normal
 * Web API available directly in the renderer's sandboxed Chromium page.
 *
 * Device *labels* are only populated by Chromium after a permission grant
 * (a security measure, not a bug here) — this picker requests a throwaway
 * `getUserMedia` grant first (audio+video, immediately stopped) purely to
 * unlock real labels, then enumerates for real. If the user denies the
 * permission prompt, devices still list but with generic labels
 * ("Microphone 1"), which is the same fallback every website sees.
 */

let openPicker: HTMLElement | null = null;
let deviceChangeListener: (() => void) | null = null;

function closePicker(): void {
  if (!openPicker) return;
  const cleanup = (openPicker as HTMLElement & { __cleanup?: () => void }).__cleanup;
  cleanup?.();
  if (deviceChangeListener) {
    navigator.mediaDevices.removeEventListener("devicechange", deviceChangeListener);
    deviceChangeListener = null;
  }
  openPicker.remove();
  openPicker = null;
}

async function requestLabelsThenEnumerate(): Promise<MediaDeviceInfo[]> {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
    stream.getTracks().forEach(track => track.stop());
  } catch {
    // permission denied or no device — fall through to enumerate anyway
  }
  return navigator.mediaDevices.enumerateDevices();
}

function deviceRow(device: MediaDeviceInfo, index: number, onPick: (deviceId: string) => void): HTMLElement {
  const label = device.label || `${device.kind === "videoinput" ? t("devicePicker.camera") : t("devicePicker.microphone")} ${index + 1}`;
  return el(
    "button",
    { type: "button", className: "device-row", onClick: () => onPick(device.deviceId) },
    label
  );
}

export function openDevicePicker(kind: "audioinput" | "videoinput", onPick: (deviceId: string) => void): void {
  if (openPicker) {
    closePicker();
    return;
  }

  const list = el("div", { className: "device-list" }, el("p", { className: "step-hint" }, t("devicePicker.loading")));
  const close = () => closePicker();

  const dialog = el(
    "div",
    { className: "modal device-picker-modal", role: "dialog", "aria-modal": "true", "aria-labelledby": "device-picker-title" },
    el("div", { className: "settings-header" },
      el("h1", { id: "device-picker-title" }, kind === "videoinput" ? t("devicePicker.titleCamera") : t("devicePicker.titleMic")),
      el("button", { className: "btn ghost close", type: "button", "aria-label": t("settings.close"), onClick: close }, icon("x"))
    ),
    list
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

  const renderList = (devices: MediaDeviceInfo[]) => {
    if (openPicker !== overlay) return;
    const matching = devices.filter(d => d.kind === kind);
    list.replaceChildren();
    if (matching.length === 0) {
      list.append(el("p", { className: "step-hint" }, t("devicePicker.empty")));
      return;
    }
    matching.forEach((device, i) =>
      list.append(
        deviceRow(device, i, deviceId => {
          onPick(deviceId);
          closePicker();
        })
      )
    );
  };

  void requestLabelsThenEnumerate().then(renderList);

  // Re-enumerate live while the picker is open, so plugging in/unplugging
  // a device shows up immediately instead of needing to close and reopen
  // the menu. Labels are already unlocked from the initial permission
  // grant above, so this re-enumerate alone (no new getUserMedia prompt)
  // is enough to pick up real labels on newly connected devices too.
  deviceChangeListener = () => {
    void navigator.mediaDevices.enumerateDevices().then(renderList);
  };
  navigator.mediaDevices.addEventListener("devicechange", deviceChangeListener);
}
