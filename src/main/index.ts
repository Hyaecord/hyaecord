import { app, BrowserWindow, ipcMain, Menu, shell } from "electron";
import { join } from "node:path";
import { IPC, PRODUCT_NAME } from "@shared/constants";
import type { HyaecordSettings } from "@shared/types";
import { loadSettings, saveSettings } from "./settings";
import { detectDesktopEnvironment, onSystemThemeChange } from "./theme";
import { getLocaleStrings, getResolvedLocale } from "./i18n";
import { createTray } from "./tray";
import { startTelemetry } from "./telemetry";
import { notifyMessage } from "./notifications";
import { fetchCommunityThemes } from "./community-themes";
import { fetchGlobalBadges } from "./global-badges";
import { fetchUserPfpMap } from "./userpfp";
import { fetchUserBgMap } from "./usrbg";
import { isLikelyUsingVpn } from "./vpn-detect";
import { startGamingModeDetection, stopGamingModeDetection } from "./gaming-mode";
import { loadPlugins, listPlugins, setPluginEnabled, setPluginSetting } from "./plugins/manager";
import { startRpcBridge, stopRpcBridge } from "./rpc-bridge";
import {
  initDiscord,
  loginWithBrowser,
  logout,
  autoLogin,
  getSessionState,
  fetchMessages,
  sendMessage,
  deleteChannel,
  muteGuild,
  muteDm,
  fetchUserProfile,
  searchGifs,
  updateAvatar,
  subscribeMemberList,
  setActivity,
  searchMessages,
  toggleEmbedSuppression
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
  // No File/Edit/View/Window/Help bar — this is a Linux/Windows-only app (see
  // BUILD_PROMPT.md platform targets) with its own in-app UI for everything
  // that menu would offer, and the default Electron menu doesn't match any
  // of Hyaecord's actual features.
  Menu.setApplicationMenu(null);

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

function applyRpcBridgeSetting(enabled: boolean): void {
  stopRpcBridge();
  if (enabled) startRpcBridge(activities => setActivity(activities));
}

app.whenReady().then(() => {
  ipcMain.handle(IPC.getSettings, () => loadSettings());
  ipcMain.handle(IPC.setSettings, (_e, patch: Partial<HyaecordSettings>) => {
    const next = saveSettings(patch);
    if ("gamingMode" in patch) applyGamingModeSetting(next.gamingMode);
    if (patch.integrations?.rpcBridge !== undefined) applyRpcBridgeSetting(next.integrations.rpcBridge);
    return next;
  });
  ipcMain.handle(IPC.getDesktopEnvironment, () => detectDesktopEnvironment());
  ipcMain.handle(IPC.getLocaleStrings, () => getLocaleStrings());
  ipcMain.handle(IPC.getLocale, () => getResolvedLocale());
  ipcMain.handle(IPC.discordLoginBrowser, () => loginWithBrowser());
  ipcMain.handle(IPC.discordLogout, () => logout());
  ipcMain.handle(IPC.discordGetSession, () => getSessionState());
  ipcMain.handle(IPC.discordFetchMessages, (_e, channelId: string) => fetchMessages(channelId));
  ipcMain.handle(IPC.discordSendMessage, (_e, channelId: string, content: string, silent?: boolean) =>
    sendMessage(channelId, content, silent)
  );
  ipcMain.handle(IPC.discordDeleteChannel, (_e, channelId: string) => deleteChannel(channelId));
  ipcMain.handle(IPC.discordMuteGuild, (_e, guildId: string, muted: boolean) => muteGuild(guildId, muted));
  ipcMain.handle(IPC.discordMuteDm, (_e, channelId: string, muted: boolean) => muteDm(channelId, muted));
  ipcMain.handle(IPC.discordGetUserProfile, (_e, userId: string) => fetchUserProfile(userId));
  ipcMain.handle(IPC.getGlobalBadges, (_e, userId: string) =>
    loadSettings().integrations.globalBadges ? fetchGlobalBadges(userId) : []
  );
  ipcMain.handle(IPC.getUserPfpMap, () => (loadSettings().integrations.userPFP ? fetchUserPfpMap() : {}));
  ipcMain.handle(IPC.getUserBgMap, () => (loadSettings().integrations.usrBG ? fetchUserBgMap() : {}));
  ipcMain.handle(IPC.discordSearchGifs, (_e, query: string) => searchGifs(query));
  ipcMain.handle(IPC.discordSetAvatar, (_e, dataUri: string | null) => updateAvatar(dataUri));
  ipcMain.on(IPC.discordSubscribeMembers, (_e, guildId: string, channelId: string) =>
    subscribeMemberList(guildId, channelId)
  );
  ipcMain.handle(IPC.discordSearchMessages, (_e, query: string, guildId: string | null, channelId: string | null) =>
    searchMessages(query, guildId, channelId)
  );
  ipcMain.handle(IPC.discordToggleEmbedSuppression, (_e, channelId: string, messageId: string, currentFlags: number) =>
    toggleEmbedSuppression(channelId, messageId, currentFlags)
  );
  ipcMain.handle(IPC.getCommunityThemes, () => fetchCommunityThemes());
  ipcMain.handle(IPC.getPlugins, () => listPlugins());
  ipcMain.handle(IPC.setPluginEnabled, (_e, id: string, enabled: boolean) => setPluginEnabled(id, enabled));
  ipcMain.handle(IPC.setPluginSetting, (_e, id: string, key: string, value: boolean | number | string) =>
    setPluginSetting(id, key, value)
  );
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
  loadPlugins(message => mainWindow?.webContents.send(IPC.pluginToast, message));

  createWindow();
  if (mainWindow) createTray(mainWindow);
  startTelemetry();
  if (loadSettings().gamingMode) applyGamingModeSetting(true);
  if (loadSettings().integrations.rpcBridge) applyRpcBridgeSetting(true);

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
  stopRpcBridge();
});
