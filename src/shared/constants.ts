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
  }
} as const;

export const IPC = {
  getSettings: "hyaecord:get-settings",
  setSettings: "hyaecord:set-settings",
  getDesktopEnvironment: "hyaecord:get-de",
  getLocaleStrings: "hyaecord:get-locale",
  themeChanged: "hyaecord:theme-changed"
} as const;
