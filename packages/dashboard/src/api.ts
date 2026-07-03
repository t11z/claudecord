import type {
  GuildConfigDto,
  GuildConfigResponseDto,
  GuildSummaryDto,
  SessionDto,
  SetupResultDto,
  StatsDto,
  StatusDto,
} from "../../bot/src/types.ts";

export type {
  GuildConfigDto,
  GuildConfigResponseDto,
  GuildSummaryDto,
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
  authRequired: () =>
    request<{ required: boolean; authenticated: boolean }>("GET", "/api/auth/required"),
  login: (password: string) => request<{ ok: boolean }>("POST", "/api/auth/login", { password }),
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
  setupClaudeToken: (token: string) =>
    request<SetupResultDto>("POST", "/api/setup/claude-token", { token }),
  checkAuth: () => request<SetupResultDto>("POST", "/api/setup/check-auth"),
  setupDiscordToken: (token: string, applicationId: string) =>
    request<SetupResultDto>("POST", "/api/setup/discord-token", { token, applicationId }),
  setupGithubToken: (token: string) =>
    request<SetupResultDto>("POST", "/api/setup/github-token", { token }),
};
