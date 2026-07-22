import { app } from "electron";
import { randomUUID } from "node:crypto";
import { TELEMETRY_ENDPOINT } from "@shared/constants";
import { loadSettings, saveSettings } from "./settings";
import { detectDesktopEnvironment } from "./theme";

/**
 * Anonymous, opt-out usage telemetry.
 *
 * What it sends: a once-a-day ping with a random UUID (no link to any Discord
 * account, IP is not stored server-side), app version, OS, arch, and desktop
 * environment family — enough to answer "how many people use Hyaecord and on
 * what platforms", nothing more.
 *
 * Custom events go through recordEvent() and are gated by the same setting;
 * anything added there must stay free of message content, identifiers, and
 * per-user behaviour profiles.
 *
 * Disabling `telemetry.enabled` in Settings (or the first-run wizard) stops
 * all of this immediately — no "final" ping is sent after opt-out.
 */

const PING_INTERVAL_MS = 24 * 60 * 60 * 1000;
let timer: NodeJS.Timeout | null = null;

function anonId(): string {
  const settings = loadSettings();
  if (!settings.telemetry.anonId) {
    saveSettings({ telemetry: { ...settings.telemetry, anonId: randomUUID() } });
  }
  return loadSettings().telemetry.anonId as string;
}

async function send(kind: string, extra: Record<string, string | number> = {}): Promise<void> {
  if (!loadSettings().telemetry.enabled) return;
  try {
    await fetch(TELEMETRY_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        kind,
        id: anonId(),
        version: app.getVersion(),
        os: process.platform,
        arch: process.arch,
        de: detectDesktopEnvironment().family,
        ...extra
      })
    });
  } catch {
    // Telemetry must never affect the app: swallow network errors, no retry queue.
  }
}

export function recordEvent(name: string, props: Record<string, string | number> = {}): void {
  void send("event", { name, ...props });
}

export function startTelemetry(): void {
  const tick = () => {
    void send("ping");
    timer = setTimeout(tick, PING_INTERVAL_MS);
    timer.unref?.();
  };
  // First ping shortly after startup so it never competes with launch work.
  timer = setTimeout(tick, 30_000);
  timer.unref?.();
}

export function stopTelemetry(): void {
  if (timer) clearTimeout(timer);
  timer = null;
}
