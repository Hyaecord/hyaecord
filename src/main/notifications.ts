import { BrowserWindow, Notification } from "electron";

/**
 * Native OS notifications (libnotify on Linux) for mentions/DMs. These fire
 * from the main process specifically so they keep working while the window
 * is minimized or unfocused — the "minimal always-on listener" Gaming Mode
 * promises to keep alive even while other background work is throttled.
 */
export function notifyMessage(win: BrowserWindow | null, title: string, body: string): void {
  if (!Notification.isSupported()) return;
  const notification = new Notification({ title, body, silent: false });
  notification.on("click", () => {
    if (!win || win.isDestroyed()) return;
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  });
  notification.show();
}
