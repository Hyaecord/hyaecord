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

    loginSession.webRequest.onBeforeSendHeaders({ urls: ["https://api.stoat.chat/*"] }, (details, callback) => {
      const token = details.requestHeaders["x-session-token"] ?? details.requestHeaders["X-Session-Token"];
      if (token && token.length > 10) finish(token);
      callback({ requestHeaders: details.requestHeaders });
    });

    win.on("closed", () => finish(null));
    win.loadURL("https://stoat.chat/login");
  });
}
