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
  stoatLoginBrowser: () => ipcRenderer.invoke(IPC.stoatLoginBrowser),
  stoatLogout: () => ipcRenderer.invoke(IPC.stoatLogout),
  getStoatSession: () => ipcRenderer.invoke(IPC.stoatGetSession),
  onStoatState: cb => {
    ipcRenderer.on(IPC.stoatState, (_e, session) => cb(session));
  },
  onStoatEvent: cb => {
    ipcRenderer.on(IPC.stoatEvent, (_e, event: string, data: unknown) => cb(event, data));
  },
  stoatFetchMessages: channelId => ipcRenderer.invoke(IPC.stoatFetchMessages, channelId),
  stoatSendMessage: (channelId, content) => ipcRenderer.invoke(IPC.stoatSendMessage, channelId, content),
  stoatGetDMs: () => ipcRenderer.invoke(IPC.stoatGetDMs),
  stoatGetServerMembers: serverId => ipcRenderer.invoke(IPC.stoatGetServerMembers, serverId),
  stoatPinMessage: (channelId, messageId) => ipcRenderer.invoke(IPC.stoatPinMessage, channelId, messageId),
  stoatUnpinMessage: (channelId, messageId) => ipcRenderer.invoke(IPC.stoatUnpinMessage, channelId, messageId),
  stoatGetUser: userId => ipcRenderer.invoke(IPC.stoatGetUser, userId),
  getCredits: () => ipcRenderer.invoke(IPC.getCredits),
  stoatAddReaction: (channelId, messageId, emoji) => ipcRenderer.invoke(IPC.stoatAddReaction, channelId, messageId, emoji),
  stoatRemoveReaction: (channelId, messageId, emoji) => ipcRenderer.invoke(IPC.stoatRemoveReaction, channelId, messageId, emoji),
  stoatEditMessage: (channelId, messageId, content) => ipcRenderer.invoke(IPC.stoatEditMessage, channelId, messageId, content),
  stoatDeleteMessage: (channelId, messageId) => ipcRenderer.invoke(IPC.stoatDeleteMessage, channelId, messageId),
  stoatSearchMessages: (channelId, query) => ipcRenderer.invoke(IPC.stoatSearchMessages, channelId, query),
  stoatGetPinnedMessages: channelId => ipcRenderer.invoke(IPC.stoatGetPinnedMessages, channelId),
  stoatStartTyping: channelId => ipcRenderer.send(IPC.stoatStartTyping, channelId),
  stoatStopTyping: channelId => ipcRenderer.send(IPC.stoatStopTyping, channelId),
  stoatSendFriendRequest: username => ipcRenderer.invoke(IPC.stoatSendFriendRequest, username),
  stoatAcceptFriendRequest: userId => ipcRenderer.invoke(IPC.stoatAcceptFriendRequest, userId),
  stoatRemoveFriend: userId => ipcRenderer.invoke(IPC.stoatRemoveFriend, userId),
  stoatOpenDM: userId => ipcRenderer.invoke(IPC.stoatOpenDM, userId),
  stoatPreviewInvite: codeOrUrl => ipcRenderer.invoke(IPC.stoatPreviewInvite, codeOrUrl),
  stoatJoinInvite: code => ipcRenderer.invoke(IPC.stoatJoinInvite, code),
  stoatLeaveServer: serverId => ipcRenderer.invoke(IPC.stoatLeaveServer, serverId),
  stoatCreateServer: name => ipcRenderer.invoke(IPC.stoatCreateServer, name),
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
    ipcRenderer.invoke(IPC.discordToggleEmbedSuppression, channelId, messageId, currentFlags),
  listRelationships: () => ipcRenderer.invoke(IPC.discordListRelationships),
  sendFriendRequest: username => ipcRenderer.invoke(IPC.discordSendFriendRequest, username),
  acceptFriendRequest: userId => ipcRenderer.invoke(IPC.discordAcceptFriendRequest, userId),
  blockUser: userId => ipcRenderer.invoke(IPC.discordBlockUser, userId),
  removeRelationship: userId => ipcRenderer.invoke(IPC.discordRemoveRelationship, userId),
  getPluginCommands: () => ipcRenderer.invoke(IPC.getPluginCommands),
  runPluginCommand: (name, args) => ipcRenderer.invoke(IPC.runPluginCommand, name, args),
  listMessagePins: channelId => ipcRenderer.invoke(IPC.discordListMessagePins, channelId),
  pinMessage: (channelId, messageId) => ipcRenderer.invoke(IPC.discordPinMessage, channelId, messageId),
  unpinMessage: (channelId, messageId) => ipcRenderer.invoke(IPC.discordUnpinMessage, channelId, messageId),
  listStickerPacks: () => ipcRenderer.invoke(IPC.getStickerPacks),
  sendSticker: (channelId, stickerId) => ipcRenderer.invoke(IPC.discordSendSticker, channelId, stickerId),
  joinVoiceChannel: (guildId, channelId) => ipcRenderer.send(IPC.discordJoinVoice, guildId, channelId),
  leaveVoiceChannel: () => ipcRenderer.send(IPC.discordLeaveVoice),
  onVoiceState: cb => {
    ipcRenderer.on(IPC.discordVoiceState, (_e, state) => cb(state));
  },
  getScreenShareSources: () => ipcRenderer.invoke(IPC.getScreenShareSources)
};

contextBridge.exposeInMainWorld("hyaecord", bridge);
