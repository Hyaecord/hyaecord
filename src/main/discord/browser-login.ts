import { BrowserWindow, session } from "electron";

// Electron's default UA identifies itself as Electron (" electron/33.x..."),
// which Discord/Cloudflare's bot detection routinely blocks or hits with an
// extra verification wall outright — independent of VPN use. A plain,
// current desktop Chrome UA is what makes this page behave like it would in
// a real browser.
const DESKTOP_CHROME_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

/**
 * Opens a real, unmodified browser window at the actual discord.com login
 * page — no custom form, no injected script into the page itself. This is
 * the trustworthy login path: users see Discord's real page, their
 * password manager recognises the real domain and offers autofill, any 2FA
 * method (SMS, backup codes, authenticator) "just works" because it's
 * Discord's own JS handling it, and Discord's own QR-code login toggle is
 * right there on the page too — no need for Hyaecord to reimplement it.
 * The window is sized for Discord's actual login layout (form + QR toggle
 * + illustration) rather than a narrow mobile-ish popup that clips it.
 *
 * We never touch the page's content. The token is captured by watching this
 * window's own network requests for the Authorization header Discord's web
 * client sends once logged in — an observation made at the Electron layer,
 * invisible to and unblockable by the page itself.
 */
export function openBrowserLogin(): Promise<string | null> {
  return new Promise(resolve => {
    // A separate, persistent partition (not the main app's session) so this
    // behaves like its own small browser profile: it remembers cookies
    // across attempts, but never touches Hyaecord's own session data.
    const loginSession = session.fromPartition("persist:discord-web-login");

    let settled = false;
    const finish = (token: string | null) => {
      if (settled) return;
      settled = true;
      loginSession.webRequest.onBeforeSendHeaders(null);
      resolve(token);
      if (!win.isDestroyed()) win.close();
      // Closing this popup doesn't automatically bring the main window
      // back to the front on Linux window managers — without this the
      // owner had to click Hyaecord in the taskbar/panel manually every
      // time after logging in (same fix as stoat/browser-login.ts).
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
      title: "discord.com — Log in",
      autoHideMenuBar: true,
      webPreferences: {
        session: loginSession,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true
      }
    });

    loginSession.webRequest.onBeforeSendHeaders({ urls: ["https://discord.com/api/*"] }, (details, callback) => {
      const auth = details.requestHeaders.Authorization ?? details.requestHeaders.authorization;
      // Discord sends the user token as-is in this header (no "Bearer "
      // prefix — that's reserved for OAuth). A bare, reasonably long value
      // is as specific a signal as we can check without hardcoding an
      // exact token shape that Discord could change.
      if (auth && !auth.startsWith("Bearer ") && auth.length > 20) {
        finish(auth);
      }
      callback({ requestHeaders: details.requestHeaders });
    });

    win.webContents.setUserAgent(DESKTOP_CHROME_UA);
    win.on("closed", () => finish(null));
    win.loadURL("https://discord.com/login");
  });
}
