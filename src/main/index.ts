import { app, BrowserWindow, ipcMain, Menu, shell, desktopCapturer } from "electron";
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
import { loadPlugins, listPlugins, setPluginEnabled, setPluginSetting, listPluginCommands, runPluginCommand } from "./plugins/manager";
import { startRpcBridge, stopRpcBridge } from "./rpc-bridge";
import { loadEnvFile } from "./env";
import { giphySearchGifs } from "./gifs/giphy";
import { getHyaecordContributors } from "./credits";
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
  toggleEmbedSuppression,
  listRelationships,
  sendFriendRequest,
  acceptFriendRequest,
  blockUser,
  removeRelationship,
  listMessagePins,
  pinMessage,
  unpinMessage,
  listStickerPacks,
  sendSticker,
  joinVoiceChannel,
  leaveVoiceChannel
} from "./discord";
import {
  initStoat,
  loginWithBrowser as stoatLoginWithBrowser,
  logout as stoatLogout,
  autoLogin as stoatAutoLogin,
  getSessionState as getStoatSessionState,
  fetchMessages as stoatFetchMessages,
  sendMessage as stoatSendMessage,
  getDMs as stoatGetDMs,
  getServerMembers as stoatGetServerMembers,
  pinMessage as stoatPinMessage,
  unpinMessage as stoatUnpinMessage,
  getUser as stoatGetUser,
  addReaction as stoatAddReaction,
  removeReaction as stoatRemoveReaction,
  editMessage as stoatEditMessage,
  deleteMessage as stoatDeleteMessage,
  searchMessages as stoatSearchMessages,
  getPinnedMessages as stoatGetPinnedMessages,
  startTyping as stoatStartTyping,
  stopTyping as stoatStopTyping,
  sendFriendRequest as stoatSendFriendRequest,
  acceptFriendRequest as stoatAcceptFriendRequest,
  removeFriend as stoatRemoveFriend,
  openDM as stoatOpenDM,
  previewInvite as stoatPreviewInvite,
  joinServerInvite as stoatJoinInvite,
  leaveServer as stoatLeaveServer,
  createServer as stoatCreateServer
} from "./stoat";

loadEnvFile();

// Without this, Chromium's screen/window capture on a native Wayland
// session (no XWayland framebuffer access — modern compositors, KDE's
// KWin included, block that path entirely for security) returns empty or
// garbage thumbnails from desktopCapturer.getSources() rather than real
// ones, which is what was actually forcing screen share to fall back to
// some other, unembedded picker rather than Hyaecord's own. This is the
// standard, documented flag other Electron apps use for real Wayland
// screen capture (Chromium's PipeWire-backed desktopCapturer backend).
// It does not, and cannot, remove the OS's own one-time portal permission
// dialog — that prompt is Wayland's security model itself (an app is not
// allowed to silently enumerate what's on screen), not something any
// Electron app can bypass; this only makes the *result* (real
// thumbnails, real capture) work correctly once granted, matching what a
// real Discord desktop client looks like on the same session.
app.commandLine.appendSwitch("enable-features", "WebRTCPipeWireCapturer");
app.commandLine.appendSwitch("ozone-platform-hint", "auto");

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
    backgroundColor: "#1e1f22",
    show: false,
    webPreferences: {
      preload: join(app.getAppPath(), "dist", "preload", "index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  mainWindow.once("ready-to-show", () => {
    mainWindow?.maximize();
    mainWindow?.show();
  });
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
  ipcMain.handle(IPC.stoatLoginBrowser, () => stoatLoginWithBrowser());
  ipcMain.handle(IPC.stoatLogout, () => stoatLogout());
  ipcMain.handle(IPC.stoatGetSession, () => getStoatSessionState());
  ipcMain.handle(IPC.stoatFetchMessages, (_e, channelId: string) => stoatFetchMessages(channelId));
  ipcMain.handle(IPC.stoatSendMessage, (_e, channelId: string, content: string) => stoatSendMessage(channelId, content));
  ipcMain.handle(IPC.stoatGetDMs, () => stoatGetDMs());
  ipcMain.handle(IPC.stoatGetServerMembers, (_e, serverId: string) => stoatGetServerMembers(serverId));
  ipcMain.handle(IPC.stoatPinMessage, (_e, channelId: string, messageId: string) => stoatPinMessage(channelId, messageId));
  ipcMain.handle(IPC.stoatUnpinMessage, (_e, channelId: string, messageId: string) => stoatUnpinMessage(channelId, messageId));
  ipcMain.handle(IPC.stoatGetUser, (_e, userId: string) => stoatGetUser(userId));
  ipcMain.handle(IPC.getCredits, () => getHyaecordContributors());
  ipcMain.handle(IPC.stoatAddReaction, (_e, channelId: string, messageId: string, emoji: string) => stoatAddReaction(channelId, messageId, emoji));
  ipcMain.handle(IPC.stoatRemoveReaction, (_e, channelId: string, messageId: string, emoji: string) => stoatRemoveReaction(channelId, messageId, emoji));
  ipcMain.handle(IPC.stoatEditMessage, (_e, channelId: string, messageId: string, content: string) => stoatEditMessage(channelId, messageId, content));
  ipcMain.handle(IPC.stoatDeleteMessage, (_e, channelId: string, messageId: string) => stoatDeleteMessage(channelId, messageId));
  ipcMain.handle(IPC.stoatSearchMessages, (_e, channelId: string, query: string) => stoatSearchMessages(channelId, query));
  ipcMain.handle(IPC.stoatGetPinnedMessages, (_e, channelId: string) => stoatGetPinnedMessages(channelId));
  ipcMain.on(IPC.stoatStartTyping, (_e, channelId: string) => stoatStartTyping(channelId));
  ipcMain.on(IPC.stoatStopTyping, (_e, channelId: string) => stoatStopTyping(channelId));
  ipcMain.handle(IPC.stoatSendFriendRequest, (_e, username: string) => stoatSendFriendRequest(username));
  ipcMain.handle(IPC.stoatAcceptFriendRequest, (_e, userId: string) => stoatAcceptFriendRequest(userId));
  ipcMain.handle(IPC.stoatRemoveFriend, (_e, userId: string) => stoatRemoveFriend(userId));
  ipcMain.handle(IPC.stoatOpenDM, (_e, userId: string) => stoatOpenDM(userId));
  ipcMain.handle(IPC.stoatPreviewInvite, (_e, codeOrUrl: string) => stoatPreviewInvite(codeOrUrl));
  ipcMain.handle(IPC.stoatJoinInvite, (_e, code: string) => stoatJoinInvite(code));
  ipcMain.handle(IPC.stoatLeaveServer, (_e, serverId: string) => stoatLeaveServer(serverId));
  ipcMain.handle(IPC.stoatCreateServer, (_e, name: string) => stoatCreateServer(name));
  ipcMain.handle(IPC.discordDeleteChannel, (_e, channelId: string) => deleteChannel(channelId));
  ipcMain.handle(IPC.discordMuteGuild, (_e, guildId: string, muted: boolean) => muteGuild(guildId, muted));
  ipcMain.handle(IPC.discordMuteDm, (_e, channelId: string, muted: boolean) => muteDm(channelId, muted));
  ipcMain.handle(IPC.discordGetUserProfile, (_e, userId: string) => fetchUserProfile(userId));
  ipcMain.handle(IPC.getGlobalBadges, (_e, userId: string) =>
    loadSettings().integrations.globalBadges ? fetchGlobalBadges(userId) : []
  );
  ipcMain.handle(IPC.getUserPfpMap, () => (loadSettings().integrations.userPFP ? fetchUserPfpMap() : {}));
  ipcMain.handle(IPC.getUserBgMap, () => (loadSettings().integrations.usrBG ? fetchUserBgMap() : {}));
  // Discord's own Tenor proxy first (works for any query, no separate key
  // needed) — only falls back to the Giphy key (see gifs/giphy.ts) when
  // there's no logged-in Discord session to proxy through, e.g. a
  // Stoat-only login.
  ipcMain.handle(IPC.discordSearchGifs, async (_e, query: string) => {
    const discordResults = await searchGifs(query);
    if (discordResults.length > 0) return discordResults;
    return giphySearchGifs(query);
  });
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
  ipcMain.handle(IPC.discordListRelationships, () => listRelationships());
  ipcMain.handle(IPC.discordSendFriendRequest, (_e, username: string) => sendFriendRequest(username));
  ipcMain.handle(IPC.discordAcceptFriendRequest, (_e, userId: string) => acceptFriendRequest(userId));
  ipcMain.handle(IPC.discordBlockUser, (_e, userId: string) => blockUser(userId));
  ipcMain.handle(IPC.discordRemoveRelationship, (_e, userId: string) => removeRelationship(userId));
  ipcMain.handle(IPC.getCommunityThemes, () => fetchCommunityThemes());
  ipcMain.handle(IPC.getPlugins, () => listPlugins());
  ipcMain.handle(IPC.setPluginEnabled, (_e, id: string, enabled: boolean) => setPluginEnabled(id, enabled));
  ipcMain.handle(IPC.setPluginSetting, (_e, id: string, key: string, value: boolean | number | string) =>
    setPluginSetting(id, key, value)
  );
  ipcMain.handle(IPC.getPluginCommands, () => listPluginCommands());
  ipcMain.handle(IPC.runPluginCommand, (_e, name: string, args: string) => runPluginCommand(name, args));
  ipcMain.handle(IPC.discordListMessagePins, (_e, channelId: string) => listMessagePins(channelId));
  ipcMain.handle(IPC.discordPinMessage, (_e, channelId: string, messageId: string) => pinMessage(channelId, messageId));
  ipcMain.handle(IPC.discordUnpinMessage, (_e, channelId: string, messageId: string) => unpinMessage(channelId, messageId));
  ipcMain.handle(IPC.getStickerPacks, () => listStickerPacks());
  ipcMain.handle(IPC.discordSendSticker, (_e, channelId: string, stickerId: string) => sendSticker(channelId, stickerId));
  ipcMain.on(IPC.discordJoinVoice, (_e, guildId: string | null, channelId: string) => joinVoiceChannel(guildId, channelId));
  ipcMain.on(IPC.discordLeaveVoice, () => leaveVoiceChannel());
  ipcMain.handle(IPC.getScreenShareSources, async () => {
    // desktopCapturer is main-process-only — this is the real, documented way
    // to enumerate actual screens/windows for screen sharing in Electron,
    // not a guess. Thumbnails are already-composited PNG previews Electron
    // itself renders, safe to hand across the sandboxed contextBridge as
    // plain data URLs (no live capture handle crosses into the renderer).
    const sources = await desktopCapturer.getSources({
      types: ["screen", "window"],
      thumbnailSize: { width: 300, height: 200 },
      fetchWindowIcons: true
    });
    return sources.map(s => ({
      id: s.id,
      name: s.name,
      thumbnailDataUrl: s.thumbnail.toDataURL(),
      appIconDataUrl: s.appIcon && !s.appIcon.isEmpty() ? s.appIcon.toDataURL() : null
    }));
  });
  ipcMain.handle(IPC.isUsingVpn, () => isLikelyUsingVpn());
  ipcMain.handle(IPC.openExternal, (_e, url: string) => {
    // Only ever hand https:// links to the OS — the renderer is sandboxed
    // and this handler is the one place that can reach outside the app.
    if (!/^https:\/\//.test(url)) return;
    return shell.openExternal(url);
  });

  initDiscord(
    (channel, ...args) => {
      const ipcChannel = channel === "state" ? IPC.discordState : channel === "voice" ? IPC.discordVoiceState : IPC.discordEvent;
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
  initStoat((channel, ...args) => {
    const ipcChannel = channel === "state" ? IPC.stoatState : IPC.stoatEvent;
    mainWindow?.webContents.send(ipcChannel, ...args);
  });
  void autoLogin();
  void stoatAutoLogin();
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
