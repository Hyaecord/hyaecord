import { contextBridge, ipcRenderer } from "electron";
import { IPC } from "@shared/constants";
import type { HyaecordBridge, HyaecordSettings } from "@shared/types";

const bridge: HyaecordBridge = {
  getSettings: () => ipcRenderer.invoke(IPC.getSettings),
  setSettings: (patch: Partial<HyaecordSettings>) =>
    ipcRenderer.invoke(IPC.setSettings, patch),
  getDesktopEnvironment: () => ipcRenderer.invoke(IPC.getDesktopEnvironment),
  getLocaleStrings: () => ipcRenderer.invoke(IPC.getLocaleStrings),
  onThemeChanged: cb => {
    ipcRenderer.on(IPC.themeChanged, (_e, prefersDark: boolean) => cb(prefersDark));
  },
  discordLogin: token => ipcRenderer.invoke(IPC.discordLogin, token),
  discordLoginCredentials: (login, password) =>
    ipcRenderer.invoke(IPC.discordLoginCredentials, login, password),
  discordSubmitMfa: (code, ticket) => ipcRenderer.invoke(IPC.discordSubmitMfa, code, ticket),
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
  sendMessage: (channelId, content) => ipcRenderer.invoke(IPC.discordSendMessage, channelId, content),
  openExternal: url => ipcRenderer.invoke(IPC.openExternal, url),
  deleteChannel: channelId => ipcRenderer.invoke(IPC.discordDeleteChannel, channelId),
  muteGuild: (guildId, muted) => ipcRenderer.invoke(IPC.discordMuteGuild, guildId, muted),
  muteDm: (channelId, muted) => ipcRenderer.invoke(IPC.discordMuteDm, channelId, muted),
  getCommunityThemes: () => ipcRenderer.invoke(IPC.getCommunityThemes),
  isUsingVpn: () => ipcRenderer.invoke(IPC.isUsingVpn)
};

contextBridge.exposeInMainWorld("hyaecord", bridge);
