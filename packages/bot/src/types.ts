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
}

export interface MeGuildDto {
  id: string;
  name: string;
  iconUrl: string | null;
}

export interface MeDto {
  user: AuthUserDto;
  claude: { linked: boolean; lastVerifiedAt: string | null };
  github: { linked: boolean; login: string | null; skipped: boolean };
  /** Derived, not stored: linked Claude, and either linked or skipped GitHub. */
  onboardingComplete: boolean;
  /** Servers this user shares with the bot — informational, not an access grant. */
  guilds: MeGuildDto[];
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

export interface ApiErrorDto {
  error: string;
}
