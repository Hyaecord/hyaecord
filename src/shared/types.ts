export type ThemeId = "light" | "dark" | "amoled" | "system";

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
  tokens: CommunityThemeTokens;
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
  /** The applied community theme, cached in full so it still works offline; null = use the base theme (light/dark/amoled) untouched. */
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

export type MfaMethod = "totp" | "sms" | "backup";

export type CredentialLoginResult =
  | { ok: true; persisted?: boolean }
  | { ok: false; mfaRequired: true; ticket: string; methods: MfaMethod[] }
  | {
      ok: false;
      mfaRequired?: false;
      /** "empty" | "invalid-credentials" | "invalid-code" | "network" | "captcha-unsupported" | "mfa-unsupported" */
      error: string;
    };

/** API surface exposed to the renderer via contextBridge */
export interface HyaecordBridge {
  getSettings(): Promise<HyaecordSettings>;
  setSettings(patch: Partial<HyaecordSettings>): Promise<HyaecordSettings>;
  getDesktopEnvironment(): Promise<DesktopEnvironmentInfo>;
  getLocaleStrings(): Promise<Record<string, string>>;
  onThemeChanged(cb: (prefersDark: boolean) => void): void;
  discordLogin(token: string): Promise<LoginResult>;
  discordLoginCredentials(login: string, password: string): Promise<CredentialLoginResult>;
  discordSubmitMfa(method: MfaMethod, code: string, ticket: string): Promise<CredentialLoginResult>;
  discordRequestMfaSms(ticket: string): Promise<{ ok: boolean; phone?: string }>;
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
  searchGifs(query: string): Promise<GifResult[]>;
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

export interface GamingModeState {
  active: boolean;
  /** null = not yet known; false = xprop/X11 unreachable (e.g. native Wayland, or xprop not installed); true = detection is running. */
  available: boolean | null;
}
