import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { Database } from "better-sqlite3";
import type { Client } from "discord.js";
import { ClaudeIdentityStore } from "./claude/identity-store.js";
import { type ClaudeEngine, createClaudeEngine } from "./claude/runner.js";
import { openDatabase } from "./db/database.js";
import { AppConfigRepo } from "./db/repos/app-config.js";
import { DashboardUsersRepo } from "./db/repos/dashboard-users.js";
import { GuildConfigRepo } from "./db/repos/guild-config.js";
import { SessionRepo } from "./db/repos/sessions.js";
import { UsageRepo } from "./db/repos/usage.js";
import type { Env } from "./env.js";
import { GithubIdentityStore } from "./github/identity-store.js";
import type { Logger } from "./logger.js";
import { RunQueue } from "./queue/queue.js";
import { type EffectiveCredentials, resolveCredentials, SecretsStore } from "./secrets.js";
import { DashboardAuth } from "./web/auth.js";
import { MagicLinkIssuer } from "./web/magic-link.js";

export interface Repos {
  sessions: SessionRepo;
  guildConfig: GuildConfigRepo;
  usage: UsageRepo;
  appConfig: AppConfigRepo;
  dashboardUsers: DashboardUsersRepo;
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
  /** Per-user linked Claude Code OAuth tokens — every run is billed to its author. */
  claude: ClaudeIdentityStore;
  /** Verifies/issues dashboard session cookies. */
  auth: DashboardAuth;
  /** Mints/redeems the single-use links `/dashboard` sends. */
  magicLink: MagicLinkIssuer;
  engine: ClaudeEngine;
  queue: RunQueue;
  /** threadId → AbortController for currently running queries. */
  activeRuns: Map<string, AbortController>;
  startedAt: number;
  /** Set once the Discord client has logged in. */
  discord: Client | null;
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
  const claude = new ClaudeIdentityStore(secrets);
  const appConfig = new AppConfigRepo(db);
  const auth = new DashboardAuth(appConfig);
  const magicLinkSecret = appConfig.getOrInit("magic_link_secret", () =>
    crypto.randomBytes(32).toString("base64url"),
  );
  const magicLink = new MagicLinkIssuer(magicLinkSecret);

  const ctx: AppContext = {
    env,
    logger,
    db,
    repos: {
      sessions: new SessionRepo(db),
      guildConfig: new GuildConfigRepo(db),
      usage: new UsageRepo(db),
      appConfig,
      dashboardUsers: new DashboardUsersRepo(db),
    },
    secrets,
    credentials,
    github,
    claude,
    auth,
    magicLink,
    engine: createClaudeEngine(),
    queue: new RunQueue(env.MAX_CONCURRENT_RUNS),
    activeRuns: new Map(),
    startedAt: Date.now(),
    discord: null,
  };
  return ctx;
}

/** Stable per-thread working directory. Must never change once created. */
export function workspaceDir(ctx: AppContext, guildId: string, threadId: string): string {
  const dir = path.resolve(ctx.env.DATA_DIR, "workspaces", guildId, threadId);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
