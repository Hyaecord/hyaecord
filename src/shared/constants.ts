export const APP_ID = "org.hyaecord.Hyaecord";
export const PRODUCT_NAME = "Hyaecord";

export const DEFAULT_SETTINGS = {
  theme: "system",
  reducedMotion: "system",
  textScale: 1,
  uiScale: 1,
  gamingMode: false,
  firstRunCompleted: false,
  integrations: {
    userPFP: true,
    usrBG: true,
    globalBadges: true,
    rpcBridge: true
  },
  selfPinFade: {
    enabled: true,
    delaySeconds: 10
  },
  telemetry: {
    enabled: true,
    anonId: null
  },
  chomper: {
    hidden: [] as Array<{ id: string; type: "guild" | "dm" }>,
    showHidden: false
  },
  communityTheme: null
} as const;

export const TELEMETRY_ENDPOINT = "https://hyaecord.vercel.app/api/telemetry";

export const IPC = {
  getSettings: "hyaecord:get-settings",
  setSettings: "hyaecord:set-settings",
  getDesktopEnvironment: "hyaecord:get-de",
  getLocaleStrings: "hyaecord:get-locale",
  themeChanged: "hyaecord:theme-changed",
  discordLogin: "hyaecord:discord-login",
  discordLoginCredentials: "hyaecord:discord-login-credentials",
  discordSubmitMfa: "hyaecord:discord-submit-mfa",
  discordLoginBrowser: "hyaecord:discord-login-browser",
  discordLogout: "hyaecord:discord-logout",
  discordGetSession: "hyaecord:discord-get-session",
  discordState: "hyaecord:discord-state",
  discordEvent: "hyaecord:discord-event",
  discordFetchMessages: "hyaecord:discord-fetch-messages",
  discordSendMessage: "hyaecord:discord-send-message",
  discordDeleteChannel: "hyaecord:discord-delete-channel",
  discordMuteGuild: "hyaecord:discord-mute-guild",
  discordMuteDm: "hyaecord:discord-mute-dm",
  openExternal: "hyaecord:open-external",
  getCommunityThemes: "hyaecord:get-community-themes",
  isUsingVpn: "hyaecord:is-using-vpn",
  gamingModeState: "hyaecord:gaming-mode-state"
} as const;
