import { contextBridge, ipcRenderer } from "electron";
import { IPC } from "@shared/constants";
import type { HyaecordBridge, HyaecordSettings } from "@shared/types";

const bridge: HyaecordBridge = {
  getSettings: () => ipcRenderer.invoke(IPC.getSettings),
  setSettings: (patch: Partial<HyaecordSettings>) =>
    ipcRenderer.invoke(IPC.setSettings, patch),
  getDesktopEnvironment: () => ipcRenderer.invoke(IPC.getDesktopEnvironment),
  getLocaleStrings: () => ipcRenderer.invoke(IPC.getLocaleStrings),
  getLocale: () => ipcRenderer.invoke(IPC.getLocale),
  onThemeChanged: cb => {
    ipcRenderer.on(IPC.themeChanged, (_e, prefersDark: boolean) => cb(prefersDark));
  },
  discordLoginBrowser: () => ipcRenderer.invoke(IPC.discordLoginBrowser),
  discordLogout: () => ipcRenderer.invoke(IPC.discordLogout),
  getDiscordSession: () => ipcRenderer.invoke(IPC.discordGetSession),
  onDiscordState: cb => {
    ipcRenderer.on(IPC.discordState, (_e, session) => cb(session));
  },
  onDiscordEvent: cb => {
    ipcRenderer.on(IPC.discordEvent, (_e, event: string, data: unknown) => cb(event, data));
  },
  fetchMessages: channelId => ipcRenderer.invoke(IPC.discordFetchMessages, channelId),
  sendMessage: (channelId, content, silent) => ipcRenderer.invoke(IPC.discordSendMessage, channelId, content, silent),
  openExternal: url => ipcRenderer.invoke(IPC.openExternal, url),
  deleteChannel: channelId => ipcRenderer.invoke(IPC.discordDeleteChannel, channelId),
  muteGuild: (guildId, muted) => ipcRenderer.invoke(IPC.discordMuteGuild, guildId, muted),
  muteDm: (channelId, muted) => ipcRenderer.invoke(IPC.discordMuteDm, channelId, muted),
  getCommunityThemes: () => ipcRenderer.invoke(IPC.getCommunityThemes),
  isUsingVpn: () => ipcRenderer.invoke(IPC.isUsingVpn),
  onGamingModeState: cb => {
    ipcRenderer.on(IPC.gamingModeState, (_e, state) => cb(state));
  },
  getUserProfile: userId => ipcRenderer.invoke(IPC.discordGetUserProfile, userId),
  getGlobalBadges: userId => ipcRenderer.invoke(IPC.getGlobalBadges, userId),
  getUserPfpMap: () => ipcRenderer.invoke(IPC.getUserPfpMap),
  getUserBgMap: () => ipcRenderer.invoke(IPC.getUserBgMap),
  getPlugins: () => ipcRenderer.invoke(IPC.getPlugins),
  setPluginEnabled: (id, enabled) => ipcRenderer.invoke(IPC.setPluginEnabled, id, enabled),
  setPluginSetting: (id, key, value) => ipcRenderer.invoke(IPC.setPluginSetting, id, key, value),
  onPluginToast: cb => {
    ipcRenderer.on(IPC.pluginToast, (_e, message: string) => cb(message));
  },
  searchGifs: query => ipcRenderer.invoke(IPC.discordSearchGifs, query),
  setAvatar: dataUri => ipcRenderer.invoke(IPC.discordSetAvatar, dataUri),
  subscribeMemberList: (guildId, channelId) => ipcRenderer.send(IPC.discordSubscribeMembers, guildId, channelId),
  searchMessages: (query, guildId, channelId) => ipcRenderer.invoke(IPC.discordSearchMessages, query, guildId, channelId),
  toggleEmbedSuppression: (channelId, messageId, currentFlags) =>
    ipcRenderer.invoke(IPC.discordToggleEmbedSuppression, channelId, messageId, currentFlags)
};

contextBridge.exposeInMainWorld("hyaecord", bridge);
