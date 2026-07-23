export type ThemeId = "light" | "dark" | "system";

export interface CommunityThemeTokens {
  bgDeep: string;
  bgBase: string;
  bgRaise: string;
  bgHover: string;
  border: string;
  text: string;
  textDim: string;
  accent: string;
  accentStrong: string;
  danger: string;
}

export interface CommunityTheme {
  id: string;
  name: string;
  author: string;
  /** Every theme ships both variants — there's no separate AMOLED mode; the light/dark setting picks which one applies. */
  light: CommunityThemeTokens;
  dark: CommunityThemeTokens;
}

export interface HyaecordSettings {
  theme: ThemeId;
  reducedMotion: "system" | "on" | "off";
  textScale: number;
  uiScale: number;
  gamingMode: boolean;
  firstRunCompleted: boolean;
  integrations: {
    userPFP: boolean;
    usrBG: boolean;
    globalBadges: boolean;
    rpcBridge: boolean;
  };
  selfPinFade: {
    enabled: boolean;
    delaySeconds: number;
  };
  telemetry: {
    /** Opt-out: on by default, disclosed in the first-run wizard */
    enabled: boolean;
    /** Random UUID, no link to any Discord identity; regenerated if cleared */
    anonId: string | null;
  };
  chomper: {
    /** Guilds and DMs swiped away by Server Chomper — hidden client-side, muted server-side. */
    hidden: Array<{ id: string; type: "guild" | "dm" }>;
    /** When true, Chomper-hidden items are shown again and un-muted; toggling back off re-hides and re-mutes the same set. */
    showHidden: boolean;
  };
  /**
   * Server folders, purely client-side (Hyaecord's own settings, not synced
   * to Discord's real account settings): real Discord stores these in the
   * "Preloaded User Settings" protobuf, and round-tripping that format
   * wasn't worth the risk of a bad write touching the account's actual
   * settings while it's still just documentation-verified, not live-tested.
   * Grouping/ordering here is local to this client only.
   */
  serverFolders: Array<{
    id: string;
    name: string;
    color: string | null;
    guildIds: string[];
    collapsed: boolean;
  }>;
  /** The applied theme (built-in "Default" or a community theme), cached in full so it still works offline; null = the built-in default theme, untouched. */
  communityTheme: CommunityTheme | null;
}

export interface DesktopEnvironmentInfo {
  /** Raw XDG_CURRENT_DESKTOP value, lowercased */
  raw: string;
  family: "gnome" | "kde" | "other";
  prefersDark: boolean;
}

export type DiscordSessionState = "logged-out" | "connecting" | "ready" | "reconnecting";

export interface DiscordUserSummary {
  id: string;
  username: string;
  globalName: string | null;
  avatar: string | null;
}

export interface DiscordSession {
  state: DiscordSessionState;
  user: DiscordUserSummary | null;
  /** True only right after an explicit login this launch (not a restored session) — see the caution notice in session.ts. */
  freshLogin?: boolean;
}

export interface LoginResult {
  ok: boolean;
  /** "invalid-token" | "network" | "empty" */
  error?: string;
  /** false when no OS keyring was available and the token is session-only */
  persisted?: boolean;
}

/** API surface exposed to the renderer via contextBridge */
export interface HyaecordBridge {
  getSettings(): Promise<HyaecordSettings>;
  setSettings(patch: Partial<HyaecordSettings>): Promise<HyaecordSettings>;
  getDesktopEnvironment(): Promise<DesktopEnvironmentInfo>;
  getLocaleStrings(): Promise<Record<string, string>>;
  onThemeChanged(cb: (prefersDark: boolean) => void): void;
  discordLoginBrowser(): Promise<LoginResult>;
  discordLogout(): Promise<void>;
  getDiscordSession(): Promise<DiscordSession>;
  onDiscordState(cb: (session: DiscordSession) => void): void;
  onDiscordEvent(cb: (event: string, data: unknown) => void): void;
  fetchMessages(channelId: string): Promise<unknown[]>;
  sendMessage(channelId: string, content: string): Promise<boolean>;
  openExternal(url: string): Promise<void>;
  deleteChannel(channelId: string): Promise<boolean>;
  muteGuild(guildId: string, muted: boolean): Promise<boolean>;
  muteDm(channelId: string, muted: boolean): Promise<boolean>;
  getCommunityThemes(): Promise<CommunityTheme[]>;
  isUsingVpn(): Promise<boolean>;
  onGamingModeState(cb: (state: GamingModeState) => void): void;
  getUserProfile(userId: string): Promise<UserProfile | null>;
  getGlobalBadges(userId: string): Promise<Array<{ icon: string; tooltip: string }>>;
  getPlugins(): Promise<PluginInfo[]>;
  setPluginEnabled(id: string, enabled: boolean): Promise<boolean>;
  setPluginSetting(id: string, key: string, value: boolean | number | string): Promise<boolean>;
  onPluginToast(cb: (message: string) => void): void;
  searchGifs(query: string): Promise<GifResult[]>;
  /** `dataUri` is a `data:image/...;base64,...` string, or null to reset to the default avatar. */
  setAvatar(dataUri: string | null): Promise<boolean>;
  /** Requests the member-list sidebar (first 100 entries) for a channel. Fire-and-forget — results arrive as GUILD_MEMBER_LIST_UPDATE over onDiscordEvent. */
  subscribeMemberList(guildId: string, channelId: string): void;
}

export interface UserProfile {
  id: string;
  username: string;
  globalName: string | null;
  avatar: string | null;
  bot: boolean;
  bio: string | null;
  pronouns: string | null;
  banner: string | null;
  accentColor: number | null;
  badges: Array<{ id: string; description: string; icon: string; link?: string }>;
  connectedAccounts: Array<{ type: string; name: string; verified: boolean }>;
  premiumType: number | null;
}

export interface GifResult {
  id: string;
  url: string;
  videoSrc: string;
  width: number;
  height: number;
  title: string;
}

export interface PluginSettingSchemaEntry {
  type: "boolean" | "number" | "string";
  label: string;
  description?: string;
  default: boolean | number | string;
  min?: number;
  max?: number;
  step?: number;
}

export interface PluginInfo {
  id: string;
  name: string;
  description: string;
  authors: string[];
  enabled: boolean;
  /** Non-null when the plugin file failed to load (syntax error, threw during evaluation, etc.) — the toggle is disabled in the UI until fixed. */
  error: string | null;
  settingsSchema?: Record<string, PluginSettingSchemaEntry>;
  settingsValues: Record<string, boolean | number | string>;
}

export interface GamingModeState {
  active: boolean;
  /** null = not yet known; false = xprop/X11 unreachable (e.g. native Wayland, or xprop not installed); true = detection is running. */
  available: boolean | null;
}
