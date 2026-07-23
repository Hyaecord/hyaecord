import { el, t, trapFocus } from "./ui";
import { icon } from "./icons";

/**
 * A live local preview modal for a `MediaStream` — used by the camera and
 * screen-share tests in Settings → Voice & Video. Deliberately named and
 * scoped as a *preview/test*, not a call: this renders the real local
 * stream in a `<video>` element so you can see it works, same as Discord's
 * own Voice & Video Settings page, but nothing here sends the stream
 * anywhere — actual voice/video transport to a channel isn't built yet
 * (see voice-gateway.ts's own scope note). All tracks are stopped when the
 * modal closes, so the camera/mic light goes off immediately.
 */
export function openMediaPreview(stream: MediaStream, title: string): void {
  const video = el("video", { autoplay: true, muted: true, playsinline: true }) as HTMLVideoElement;
  video.srcObject = stream;

  const stopAll = () => stream.getTracks().forEach(track => track.stop());
  const close = () => {
    stopAll();
    cleanup();
    overlay.remove();
  };

  const dialog = el(
    "div",
    { className: "modal media-preview-modal", role: "dialog", "aria-modal": "true", "aria-labelledby": "media-preview-title" },
    el("div", { className: "settings-header" },
      el("h1", { id: "media-preview-title" }, title),
      el("button", { className: "btn ghost close", type: "button", "aria-label": t("settings.close"), onClick: close }, icon("x"))
    ),
    el("div", { className: "media-preview-frame" }, video),
    el("p", { className: "step-hint" }, t("mediaPreview.note"))
  );

  const overlay = el("div", { className: "overlay" }, dialog);
  overlay.addEventListener("keydown", ev => {
    if (ev.key === "Escape") close();
  });
  overlay.addEventListener("mousedown", ev => {
    if (ev.target === overlay) close();
  });
  const cleanup = trapFocus(overlay);
  document.body.append(overlay);
  (dialog.querySelector(".close") as HTMLButtonElement).focus();
}

/** A live microphone level meter — real Web Audio analysis of the actual input, not a fake animation. */
export function openMicPreview(stream: MediaStream, title: string): void {
  const audioCtx = new AudioContext();
  const source = audioCtx.createMediaStreamSource(stream);
  const analyser = audioCtx.createAnalyser();
  analyser.fftSize = 512;
  source.connect(analyser);
  const data = new Uint8Array(analyser.frequencyBinCount);

  const meterFill = el("div", { className: "mic-meter-fill" });
  let raf = 0;
  const tick = () => {
    analyser.getByteFrequencyData(data);
    const avg = data.reduce((sum, v) => sum + v, 0) / data.length;
    meterFill.style.width = `${Math.min(100, (avg / 255) * 140)}%`;
    raf = requestAnimationFrame(tick);
  };
  tick();

  const stopAll = () => {
    cancelAnimationFrame(raf);
    stream.getTracks().forEach(track => track.stop());
    void audioCtx.close();
  };
  const close = () => {
    stopAll();
    cleanup();
    overlay.remove();
  };

  const dialog = el(
    "div",
    { className: "modal media-preview-modal", role: "dialog", "aria-modal": "true", "aria-labelledby": "mic-preview-title" },
    el("div", { className: "settings-header" },
      el("h1", { id: "mic-preview-title" }, title),
      el("button", { className: "btn ghost close", type: "button", "aria-label": t("settings.close"), onClick: close }, icon("x"))
    ),
    el("div", { className: "mic-meter-track" }, meterFill),
    el("p", { className: "step-hint" }, t("mediaPreview.micNote"))
  );

  const overlay = el("div", { className: "overlay" }, dialog);
  overlay.addEventListener("keydown", ev => {
    if (ev.key === "Escape") close();
  });
  overlay.addEventListener("mousedown", ev => {
    if (ev.target === overlay) close();
  });
  const cleanup = trapFocus(overlay);
  document.body.append(overlay);
  (dialog.querySelector(".close") as HTMLButtonElement).focus();
}
