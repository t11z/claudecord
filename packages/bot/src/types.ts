/**
 * Shared DTO types for the dashboard API. The dashboard frontend imports
 * these type-only, so this file must stay free of runtime imports.
 */

export type RunMode = "chat" | "agentic";

export interface StatusDto {
  ready: boolean;
  discordConnected: boolean;
  botUser: { id: string; tag: string } | null;
  guildCount: number;
  uptimeSeconds: number;
  /** Number of Discord users with a linked Claude subscription. */
  claudeIdentityCount: number;
  /** Whether a GitHub App (client id + secret) is configured for /link-github. */
  githubAppConfigured: boolean;
  /**
   * Whether "Sign in with Discord" can work: application id, client secret and
   * a public URL for Discord to redirect back to. The secret's value is never
   * exposed, only this boolean — the dashboard uses it to decide whether to
   * offer the button at all.
   */
  discordOAuthConfigured: boolean;
  /**
   * The exact redirect URL the server sends to Discord, so the operator
   * registers *that* rather than whatever the browser's address bar implies —
   * behind a proxy those differ, and a mismatch fails on discord.com where
   * nobody sees it. Null when `DASHBOARD_PUBLIC_URL` is unset.
   */
  discordRedirectUri: string | null;
  defaultModel: string;
  queueDepth: number;
  activeRuns: number;
  inviteUrl: string | null;
  version: string;
}

export interface GuildSummaryDto {
  id: string;
  name: string;
  iconUrl: string | null;
  memberCount: number | null;
}

export interface GuildConfigDto {
  guildId: string;
  enabled: boolean;
  allowedChannelIds: string[];
  allowedRoleIds: string[];
  agenticEnabled: boolean;
  githubRoleIds: string[];
  model: string | null;
  systemPromptExtra: string | null;
}

export interface ChannelOptionDto {
  id: string;
  name: string;
}

export interface RoleOptionDto {
  id: string;
  name: string;
  color: string | null;
}

export interface GuildConfigResponseDto {
  config: GuildConfigDto;
  channels: ChannelOptionDto[];
  roles: RoleOptionDto[];
}

export interface SessionDto {
  threadId: string;
  guildId: string;
  channelId: string;
  claudeSessionId: string | null;
  threadName: string | null;
  model: string;
  mode: RunMode;
  createdAt: string;
  lastActiveAt: string;
  turnCount: number;
  running: boolean;
}

export interface DailyStatDto {
  date: string;
  runs: number;
  errors: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

export interface RecentErrorDto {
  runId: string | null;
  startedAt: string;
  guildId: string;
  guildName: string | null;
  /** Classified category, e.g. "max_turns", "rate_limit", "unknown". */
  kind: string | null;
  /** SDK terminal subtype, e.g. "error_max_turns". */
  subtype: string | null;
  /** Truncated raw failure text for investigation. */
  detail: string | null;
}

export interface StatsDto {
  windowDays: number;
  totalRuns: number;
  totalErrors: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCostUsd: number;
  daily: DailyStatDto[];
  topGuilds: { guildId: string; guildName: string | null; runs: number }[];
  topUsers: { userId: string; runs: number }[];
  lastRateLimitAt: string | null;
  recentErrors: RecentErrorDto[];
}

export interface GithubIdentityDto {
  discordUserId: string;
  login: string | null;
  linkedAt: string;
  expiresAt: string | null;
}

export interface GithubIdentitiesResponseDto {
  /** Whether a GitHub App (client id + secret) is configured for linking. */
  appConfigured: boolean;
  identities: GithubIdentityDto[];
}

export interface ClaudeIdentityDto {
  discordUserId: string;
  linkedAt: string;
  lastVerifiedAt: string | null;
}

export interface ClaudeIdentitiesResponseDto {
  identities: ClaudeIdentityDto[];
}

export interface AuthUserDto {
  id: string;
  username: string | null;
  globalName: string | null;
  avatarUrl: string | null;
}

export interface AuthSessionDto {
  user: AuthUserDto | null;
  isAdmin: boolean;
  /**
   * Whether to offer "Sign in with Discord". Lives on this route because it is
   * the only unauthenticated one — the signed-out screen cannot read
   * `/api/status`, which is admin-gated.
   */
  discordOAuthConfigured: boolean;
}

export interface MeGuildDto {
  id: string;
  name: string;
  iconUrl: string | null;
  /**
   * Whether this server's GitHub role gate (`/config allow-github-role`)
   * permits this user. Shown so a member can see where their GitHub access
   * will actually apply — the gate is re-checked per guild at run time
   * (discord/conversation.ts), so this is a preview, not the enforcement.
   */
  githubAllowed: boolean;
}

export interface MeDto {
  user: AuthUserDto;
  claude: { linked: boolean; linkedAt: string | null; lastVerifiedAt: string | null };
  github: {
    linked: boolean;
    login: string | null;
    skipped: boolean;
    /** Whether a GitHub App is configured at all — without one, linking is impossible. */
    appConfigured: boolean;
    /**
     * Why this user can't link GitHub right now, in words, or null when they
     * can. Computed server-side by the same function the mutations enforce
     * with (`githubLinkEligibility`), so the UI never invents its own reason
     * and never contradicts the server. Advisory only: every mutation
     * re-checks and never trusts this.
     */
    linkBlockedReason: string | null;
  };
  /** Derived, not stored: linked Claude, and either linked or skipped GitHub. */
  onboardingComplete: boolean;
  /** Servers this user shares with the bot — informational, not an access grant. */
  guilds: MeGuildDto[];
}

/**
 * One user's identity links, for the admin "Verknüpfungen" view. A user known
 * only through a Discord-side link has no dashboard profile yet, so every
 * display field is nullable. Tokens are never projected here.
 */
export interface IdentityGraphRowDto {
  discordUserId: string;
  username: string | null;
  globalName: string | null;
  avatarUrl: string | null;
  claude: { linked: boolean; linkedAt: string | null; lastVerifiedAt: string | null };
  github: { linked: boolean; login: string | null; linkedAt: string | null };
}

export interface IdentityGraphDto {
  rows: IdentityGraphRowDto[];
}

export interface MeUsageDto {
  windowDays: number;
  totalRuns: number;
  totalErrors: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCostUsd: number;
}

export interface GithubDeviceStartDto {
  ok: boolean;
  message?: string;
  userCode?: string;
  verificationUri?: string;
  deviceCode?: string;
  interval?: number;
  expiresIn?: number;
}

export interface GithubDevicePollDto {
  status: "pending" | "authorized" | "error";
  login?: string | null;
  interval?: number;
  message?: string;
}

export interface SetupResultDto {
  ok: boolean;
  message: string;
}

export interface MigrationLegacyKeysDto {
  claudeOauthToken: boolean;
  anthropicApiKey: boolean;
  githubToken: boolean;
  dashboardPassword: boolean;
}

export interface MigrationStatusDto {
  /** Whether the wizard should be shown at all — false once completed or on a fresh install. */
  needed: boolean;
  /** Which legacy secrets.json keys are still present and awaiting a decision. */
  legacy: MigrationLegacyKeysDto;
  /** Discord user ids with a linked Claude/GitHub identity but no dashboard profile yet. */
  unresolvedProfiles: string[];
}

export interface ApiErrorDto {
  error: string;
}
