import fs from "node:fs";
import path from "node:path";
import type { Database } from "better-sqlite3";
import type { Client } from "discord.js";
import { type ClaudeEngine, createClaudeEngine } from "./claude/runner.js";
import { openDatabase } from "./db/database.js";
import { AppConfigRepo } from "./db/repos/app-config.js";
import { GuildConfigRepo } from "./db/repos/guild-config.js";
import { SessionRepo } from "./db/repos/sessions.js";
import { UsageRepo } from "./db/repos/usage.js";
import type { Env } from "./env.js";
import { GithubIdentityStore } from "./github/identity-store.js";
import type { Logger } from "./logger.js";
import { RunQueue } from "./queue/queue.js";
import { type EffectiveCredentials, resolveCredentials, SecretsStore } from "./secrets.js";

export interface Repos {
  sessions: SessionRepo;
  guildConfig: GuildConfigRepo;
  usage: UsageRepo;
  appConfig: AppConfigRepo;
}

export interface AppContext {
  env: Env;
  logger: Logger;
  db: Database;
  repos: Repos;
  secrets: SecretsStore;
  credentials: () => EffectiveCredentials;
  /** Per-user linked GitHub identities (tokens for acting in their namespace). */
  github: GithubIdentityStore;
  engine: ClaudeEngine;
  queue: RunQueue;
  /** threadId → AbortController for currently running queries. */
  activeRuns: Map<string, AbortController>;
  startedAt: number;
  /** Set once the Discord client has logged in. */
  discord: Client | null;
  /** Result of the last Claude auth check (null = not yet run). */
  authValid: boolean | null;
}

export function createContext(env: Env, logger: Logger): AppContext {
  const db = openDatabase(env.DATA_DIR);
  const secrets = new SecretsStore(env.DATA_DIR);
  const credentials = () => resolveCredentials(env, secrets.get());
  const github = new GithubIdentityStore(
    secrets,
    () => {
      const c = credentials();
      return { clientId: c.githubAppClientId, clientSecret: c.githubAppClientSecret };
    },
    logger,
  );

  const ctx: AppContext = {
    env,
    logger,
    db,
    repos: {
      sessions: new SessionRepo(db),
      guildConfig: new GuildConfigRepo(db),
      usage: new UsageRepo(db),
      appConfig: new AppConfigRepo(db),
    },
    secrets,
    credentials,
    github,
    engine: createClaudeEngine(() => {
      const c = credentials();
      return { oauthToken: c.oauthToken, apiKey: c.apiKey };
    }),
    queue: new RunQueue(env.MAX_CONCURRENT_RUNS),
    activeRuns: new Map(),
    startedAt: Date.now(),
    discord: null,
    authValid: null,
  };
  return ctx;
}

/** Stable per-thread working directory. Must never change once created. */
export function workspaceDir(ctx: AppContext, guildId: string, threadId: string): string {
  const dir = path.resolve(ctx.env.DATA_DIR, "workspaces", guildId, threadId);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
