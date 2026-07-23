export type ThemeId = "light" | "dark" | "amoled" | "system";

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

/** API surface exposed to the renderer via contextBridge */
export interface HyaecordBridge {
  getSettings(): Promise<HyaecordSettings>;
  setSettings(patch: Partial<HyaecordSettings>): Promise<HyaecordSettings>;
  getDesktopEnvironment(): Promise<DesktopEnvironmentInfo>;
  getLocaleStrings(): Promise<Record<string, string>>;
  onThemeChanged(cb: (prefersDark: boolean) => void): void;
  discordLogin(token: string): Promise<LoginResult>;
  discordLogout(): Promise<void>;
  getDiscordSession(): Promise<DiscordSession>;
  onDiscordState(cb: (session: DiscordSession) => void): void;
  onDiscordEvent(cb: (event: string, data: unknown) => void): void;
  fetchMessages(channelId: string): Promise<unknown[]>;
  sendMessage(channelId: string, content: string): Promise<boolean>;
  openExternal(url: string): Promise<void>;
}
