/**
 * Shared DTO types for the dashboard API. The dashboard frontend imports
 * these type-only, so this file must stay free of runtime imports.
 */

export type AuthMethod = "oauth" | "api-key" | "none";
export type RunMode = "chat" | "agentic";

export interface StatusDto {
  ready: boolean;
  discordConnected: boolean;
  botUser: { id: string; tag: string } | null;
  guildCount: number;
  uptimeSeconds: number;
  authMethod: AuthMethod;
  authValid: boolean | null;
  /** Whether a GitHub token is configured (env or secrets store). */
  githubConfigured: boolean;
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
}

export interface SetupTokenRequestDto {
  token: string;
}

export interface SetupResultDto {
  ok: boolean;
  message: string;
}

export interface ApiErrorDto {
  error: string;
}
