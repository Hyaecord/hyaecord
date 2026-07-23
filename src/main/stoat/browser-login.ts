import { BrowserWindow, session } from "electron";

/**
 * Same trustworthy pattern as Discord's browser-login.ts: a real,
 * unmodified window at Stoat's own login page — no custom credentials
 * form. The session token is captured by watching this window's own
 * outgoing requests for the `x-session-token` header Stoat's real web
 * client sends once logged in (confirmed as the real auth header name via
 * Stoat's own published OpenAPI spec, stoat.chat/api/openapi.json — not
 * guessed), an observation made at the Electron layer, not by touching
 * the page's content.
 *
 * Watches `stoat.chat/*` broadly, not just `api.stoat.chat/*`: the
 * OpenAPI spec itself is served from `stoat.chat/api/openapi.json`, a
 * strong signal the production web client calls its API through a
 * same-origin `/api/*` proxy path rather than the cross-origin
 * `api.stoat.chat` host directly — matching only the latter meant the
 * token-bearing request never matched the filter at all, so the window
 * just sat there as an ordinary logged-in Stoat tab Hyaecord never
 * noticed. The header-presence check (not the URL match) is still what
 * actually triggers completion, so the broader filter doesn't change
 * what counts as "logged in", only which requests get inspected.
 */
export function openBrowserLogin(): Promise<string | null> {
  return new Promise(resolve => {
    const loginSession = session.fromPartition("persist:stoat-web-login");

    let settled = false;
    const finish = (token: string | null) => {
      if (settled) return;
      settled = true;
      loginSession.webRequest.onBeforeSendHeaders(null);
      resolve(token);
      if (!win.isDestroyed()) win.close();
      // Closing this popup doesn't automatically bring the main window
      // back to the front on Linux window managers — without this, the
      // owner reported having to click Hyaecord in the taskbar/panel
      // manually every time after logging in.
      for (const w of BrowserWindow.getAllWindows()) {
        if (w !== win && !w.isDestroyed()) {
          if (w.isMinimized()) w.restore();
          w.show();
          w.focus();
        }
      }
    };

    const win = new BrowserWindow({
      width: 920,
      height: 760,
      minWidth: 700,
      minHeight: 600,
      title: "stoat.chat — Log in",
      autoHideMenuBar: true,
      webPreferences: {
        session: loginSession,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true
      }
    });

    loginSession.webRequest.onBeforeSendHeaders({ urls: ["https://api.stoat.chat/*", "https://stoat.chat/*"] }, (details, callback) => {
      const token = details.requestHeaders["x-session-token"] ?? details.requestHeaders["X-Session-Token"];
      if (token && token.length > 10) finish(token);
      callback({ requestHeaders: details.requestHeaders });
    });

    win.on("closed", () => finish(null));
    win.loadURL("https://stoat.chat/login");
  });
}
