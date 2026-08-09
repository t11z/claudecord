import type {
  AuthSessionDto,
  AuthUserDto,
  ClaudeIdentitiesResponseDto,
  ClaudeIdentityDto,
  GithubDevicePollDto,
  GithubDeviceStartDto,
  GithubIdentitiesResponseDto,
  GithubIdentityDto,
  GuildConfigDto,
  GuildConfigResponseDto,
  GuildSummaryDto,
  MeDto,
  MeUsageDto,
  MigrationStatusDto,
  SessionDto,
  SetupResultDto,
  StatsDto,
  StatusDto,
} from "../../bot/src/types.ts";

export type {
  AuthSessionDto,
  AuthUserDto,
  ClaudeIdentitiesResponseDto,
  ClaudeIdentityDto,
  GithubDevicePollDto,
  GithubDeviceStartDto,
  GithubIdentitiesResponseDto,
  GithubIdentityDto,
  GuildConfigDto,
  GuildConfigResponseDto,
  GuildSummaryDto,
  MeDto,
  MeUsageDto,
  MigrationStatusDto,
  SessionDto,
  SetupResultDto,
  StatsDto,
  StatusDto,
};

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const message =
      typeof data.message === "string"
        ? data.message
        : typeof data.error === "string"
          ? data.error
          : `HTTP ${res.status}`;
    throw new ApiError(res.status, message);
  }
  return data as T;
}

export const api = {
  session: () => request<AuthSessionDto>("GET", "/api/auth/session"),
  logout: () => request<{ ok: boolean }>("POST", "/api/auth/logout"),
  status: () => request<StatusDto>("GET", "/api/status"),
  guilds: () => request<GuildSummaryDto[]>("GET", "/api/guilds"),
  guildConfig: (id: string) => request<GuildConfigResponseDto>("GET", `/api/guilds/${id}/config`),
  saveGuildConfig: (id: string, config: Partial<GuildConfigDto>) =>
    request<{ ok: boolean }>("PUT", `/api/guilds/${id}/config`, config),
  sessions: () => request<SessionDto[]>("GET", "/api/sessions"),
  deleteSession: (threadId: string) =>
    request<{ ok: boolean }>("DELETE", `/api/sessions/${threadId}`),
  abortSession: (threadId: string) =>
    request<{ ok: boolean }>("POST", `/api/sessions/${threadId}/abort`),
  stats: (windowDays: number) => request<StatsDto>("GET", `/api/stats?window=${windowDays}`),
  setupGithubApp: (clientId: string, clientSecret: string) =>
    request<SetupResultDto>("POST", "/api/setup/github-app", { clientId, clientSecret }),
  githubIdentities: () => request<GithubIdentitiesResponseDto>("GET", "/api/github/identities"),
  unlinkGithubIdentity: (discordUserId: string) =>
    request<{ ok: boolean }>("DELETE", `/api/github/identities/${discordUserId}`),
  claudeIdentities: () => request<ClaudeIdentitiesResponseDto>("GET", "/api/claude/identities"),
  unlinkClaudeIdentity: (discordUserId: string) =>
    request<{ ok: boolean }>("DELETE", `/api/claude/identities/${discordUserId}`),
  checkClaudeIdentity: (discordUserId: string) =>
    request<SetupResultDto>("POST", `/api/claude/identities/${discordUserId}/check`),
  me: () => request<MeDto>("GET", "/api/me"),
  meUsage: (windowDays: number) => request<MeUsageDto>("GET", `/api/me/usage?window=${windowDays}`),
  linkMyClaude: (token: string) => request<SetupResultDto>("POST", "/api/me/claude", { token }),
  unlinkMyClaude: () => request<{ ok: boolean }>("DELETE", "/api/me/claude"),
  startMyGithubDevice: () => request<GithubDeviceStartDto>("POST", "/api/me/github/device"),
  pollMyGithubDevice: (deviceCode: string) =>
    request<GithubDevicePollDto>("POST", "/api/me/github/device/poll", { deviceCode }),
  skipMyGithub: () => request<{ ok: boolean }>("POST", "/api/me/github/skip"),
  unlinkMyGithub: () => request<{ ok: boolean }>("DELETE", "/api/me/github"),
  migrationStatus: () => request<MigrationStatusDto>("GET", "/api/migrate/status"),
  claimLegacyClaude: () => request<SetupResultDto>("POST", "/api/migrate/claude/claim"),
  discardLegacyClaude: () => request<SetupResultDto>("POST", "/api/migrate/claude/discard"),
  discardLegacyApiKey: () => request<SetupResultDto>("POST", "/api/migrate/api-key/discard"),
  claimLegacyGithub: () => request<SetupResultDto>("POST", "/api/migrate/github/claim"),
  discardLegacyGithub: () => request<SetupResultDto>("POST", "/api/migrate/github/discard"),
  discardLegacyPassword: () => request<SetupResultDto>("POST", "/api/migrate/password/discard"),
  backfillProfiles: () => request<SetupResultDto>("POST", "/api/migrate/profiles/backfill"),
  completeMigration: () => request<{ ok: boolean }>("POST", "/api/migrate/complete"),
};
