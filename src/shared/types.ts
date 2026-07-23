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
    /** Guild IDs swiped away by Server Chomper — hidden client-side, muted server-side. */
    hiddenGuildIds: string[];
    /** When true, Chomper-hidden guilds are shown again and un-muted; toggling back off re-hides and re-mutes the same set. */
    showHidden: boolean;
  };
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
}

export interface LoginResult {
  ok: boolean;
  /** "invalid-token" | "network" | "empty" */
  error?: string;
  /** false when no OS keyring was available and the token is session-only */
  persisted?: boolean;
}

export type CredentialLoginResult =
  | { ok: true; persisted?: boolean }
  | { ok: false; mfaRequired: true; ticket: string }
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
  discordSubmitMfa(code: string, ticket: string): Promise<CredentialLoginResult>;
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
  getCommunityThemes(): Promise<CommunityTheme[]>;
  isUsingVpn(): Promise<boolean>;
}
