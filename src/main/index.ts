import { app, BrowserWindow, ipcMain, shell } from "electron";
import { join } from "node:path";
import { IPC, PRODUCT_NAME } from "@shared/constants";
import type { HyaecordSettings, MfaMethod } from "@shared/types";
import { loadSettings, saveSettings } from "./settings";
import { detectDesktopEnvironment, onSystemThemeChange } from "./theme";
import { getLocaleStrings } from "./i18n";
import { createTray } from "./tray";
import { startTelemetry } from "./telemetry";
import { notifyMessage } from "./notifications";
import { fetchCommunityThemes } from "./community-themes";
import { isLikelyUsingVpn } from "./vpn-detect";
import { startGamingModeDetection, stopGamingModeDetection } from "./gaming-mode";
import {
  initDiscord,
  login,
  loginWithCredentials,
  submitMfa,
  requestMfaSms,
  loginWithBrowser,
  logout,
  autoLogin,
  getSessionState,
  fetchMessages,
  sendMessage,
  deleteChannel,
  muteGuild,
  muteDm,
  fetchUserProfile
} from "./discord";

let mainWindow: BrowserWindow | null = null;

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    title: PRODUCT_NAME,
    width: 1280,
    height: 800,
    minWidth: 720,
    minHeight: 480,
    icon: join(app.getAppPath(), "assets", "icons", "hyaecord-256.png"),
    backgroundColor: "#16130e",
    show: false,
    webPreferences: {
      preload: join(app.getAppPath(), "dist", "preload", "index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  mainWindow.once("ready-to-show", () => mainWindow?.show());
  mainWindow.loadFile(join(app.getAppPath(), "dist", "renderer", "index.html"));
  mainWindow.on("closed", () => (mainWindow = null));
}

function applyGamingModeSetting(enabled: boolean): void {
  stopGamingModeDetection();
  if (!enabled) {
    mainWindow?.webContents.send(IPC.gamingModeState, { active: false, available: null });
    return;
  }
  startGamingModeDetection({
    onAvailability: available => {
      mainWindow?.webContents.send(IPC.gamingModeState, { active: false, available });
    },
    onChange: active => {
      mainWindow?.webContents.send(IPC.gamingModeState, { active, available: true });
    }
  });
}

app.whenReady().then(() => {
  ipcMain.handle(IPC.getSettings, () => loadSettings());
  ipcMain.handle(IPC.setSettings, (_e, patch: Partial<HyaecordSettings>) => {
    const next = saveSettings(patch);
    if ("gamingMode" in patch) applyGamingModeSetting(next.gamingMode);
    return next;
  });
  ipcMain.handle(IPC.getDesktopEnvironment, () => detectDesktopEnvironment());
  ipcMain.handle(IPC.getLocaleStrings, () => getLocaleStrings());
  ipcMain.handle(IPC.discordLogin, (_e, token: string) => login(token));
  ipcMain.handle(IPC.discordLoginCredentials, (_e, loginField: string, password: string) =>
    loginWithCredentials(loginField, password)
  );
  ipcMain.handle(IPC.discordSubmitMfa, (_e, method: MfaMethod, code: string, ticket: string) =>
    submitMfa(method, code, ticket)
  );
  ipcMain.handle(IPC.discordRequestMfaSms, (_e, ticket: string) => requestMfaSms(ticket));
  ipcMain.handle(IPC.discordLoginBrowser, () => loginWithBrowser());
  ipcMain.handle(IPC.discordLogout, () => logout());
  ipcMain.handle(IPC.discordGetSession, () => getSessionState());
  ipcMain.handle(IPC.discordFetchMessages, (_e, channelId: string) => fetchMessages(channelId));
  ipcMain.handle(IPC.discordSendMessage, (_e, channelId: string, content: string) =>
    sendMessage(channelId, content)
  );
  ipcMain.handle(IPC.discordDeleteChannel, (_e, channelId: string) => deleteChannel(channelId));
  ipcMain.handle(IPC.discordMuteGuild, (_e, guildId: string, muted: boolean) => muteGuild(guildId, muted));
  ipcMain.handle(IPC.discordMuteDm, (_e, channelId: string, muted: boolean) => muteDm(channelId, muted));
  ipcMain.handle(IPC.discordGetUserProfile, (_e, userId: string) => fetchUserProfile(userId));
  ipcMain.handle(IPC.getCommunityThemes, () => fetchCommunityThemes());
  ipcMain.handle(IPC.isUsingVpn, () => isLikelyUsingVpn());
  ipcMain.handle(IPC.openExternal, (_e, url: string) => {
    // Only ever hand https:// links to the OS — the renderer is sandboxed
    // and this handler is the one place that can reach outside the app.
    if (!/^https:\/\//.test(url)) return;
    return shell.openExternal(url);
  });

  initDiscord(
    (channel, ...args) => {
      const ipcChannel = channel === "state" ? IPC.discordState : IPC.discordEvent;
      mainWindow?.webContents.send(ipcChannel, ...args);
    },
    (title, body) => {
      // Skip the notification if the user is already looking at the window —
      // this is the "keep working while gaming/backgrounded" listener, not a
      // duplicate of what's already visible on screen.
      if (mainWindow?.isFocused()) return;
      notifyMessage(mainWindow, title, body);
    }
  );
  void autoLogin();

  createWindow();
  if (mainWindow) createTray(mainWindow);
  startTelemetry();
  if (loadSettings().gamingMode) applyGamingModeSetting(true);

  onSystemThemeChange(prefersDark => {
    mainWindow?.webContents.send(IPC.themeChanged, prefersDark);
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  // Keep running in the tray on Linux/Windows; quitting is explicit via tray menu.
});

app.on("before-quit", () => {
  stopGamingModeDetection();
});
