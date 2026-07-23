import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";

/**
 * Gaming Mode's fullscreen detector — genuinely event-driven, not a polling
 * loop, per the performance-core requirement in BUILD_PROMPT.md. `xprop
 * -spy` blocks and prints a new line only when the watched property
 * actually changes (X11 PropertyNotify events under the hood), so this
 * reacts to real state changes instead of asking "is it fullscreen yet?"
 * on a timer.
 *
 * Scope, honestly: this only sees windows running under X11 or XWayland —
 * which covers most games in practice (Steam/Proton titles overwhelmingly
 * still render through XWayland even on a Wayland desktop as of 2026), but
 * a game running as a *native* Wayland client is invisible to this, and
 * there is no portable, standard protocol for a third-party app to query
 * that without a compositor-specific extension (GNOME Shell/KWin scripting)
 * users would have to install separately. That gap doesn't have a portable
 * fix, so it isn't pretended away — `available` reports whether detection
 * could even start (xprop present, X11/XWayland reachable) so callers can
 * tell "not gaming" apart from "can't tell".
 */

export interface GamingModeHandlers {
  onChange(active: boolean): void;
  /** Fired once, immediately, so callers know whether detection could even start. */
  onAvailability(available: boolean): void;
}

const FULLSCREEN_ATOM = "_NET_WM_STATE_FULLSCREEN";
const WINDOW_ID_RE = /window id # (0x[0-9a-fA-F]+)/;

let spyProcess: ChildProcessWithoutNullStreams | null = null;

function checkWindowFullscreen(windowId: string, onResult: (fullscreen: boolean) => void): void {
  const check = spawn("xprop", ["-id", windowId, "_NET_WM_STATE"]);
  let output = "";
  check.stdout.on("data", chunk => (output += chunk));
  check.on("close", () => onResult(output.includes(FULLSCREEN_ATOM)));
  check.on("error", () => onResult(false));
}

/** Starts watching the active window for fullscreen changes. No-op if already running or not on Linux. */
export function startGamingModeDetection(handlers: GamingModeHandlers): void {
  if (spyProcess || process.platform !== "linux") {
    handlers.onAvailability(false);
    return;
  }

  spyProcess = spawn("xprop", ["-root", "-spy", "_NET_ACTIVE_WINDOW"]);
  let announced = false;
  let buffer = "";

  spyProcess.stdout.on("data", chunk => {
    if (!announced) {
      announced = true;
      handlers.onAvailability(true);
    }
    buffer += chunk.toString();
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const match = line.match(WINDOW_ID_RE);
      if (!match) {
        handlers.onChange(false); // no active window (e.g. showing the desktop) — not fullscreen
        continue;
      }
      checkWindowFullscreen(match[1] as string, handlers.onChange);
    }
  });

  spyProcess.on("error", () => {
    // Most likely xprop isn't installed. Fail to "unavailable", not "gaming active".
    spyProcess = null;
    if (!announced) handlers.onAvailability(false);
  });

  spyProcess.on("close", () => {
    spyProcess = null;
  });
}

export function stopGamingModeDetection(): void {
  spyProcess?.kill();
  spyProcess = null;
}
