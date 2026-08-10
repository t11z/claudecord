import type { Hono } from "hono";
import { checkClaudeAuth } from "../../claude/auth-check.js";
import type { AppContext } from "../../context.js";
import { canUseGithub } from "../../discord/access-control.js";
import {
  DeviceFlowError,
  exchangeDeviceCode,
  requestDeviceCode,
} from "../../github/device-flow.js";
import { revokeUserToken } from "../../github/refresh.js";
import type {
  GithubDevicePollDto,
  GithubDeviceStartDto,
  MeDto,
  MeGuildDto,
  MeUsageDto,
  SetupResultDto,
} from "../../types.js";
import { requireUser } from "../middleware.js";

/**
 * Why a GitHub link attempt may be refused. Three distinct outcomes rather than
 * one boolean, because telling a user "you don't have the right role" when the
 * bot simply hasn't connected to Discord yet would be actively misleading.
 */
export type GithubLinkEligibility =
  | { ok: true }
  | { ok: false; status: 403 | 503; message: string };

/**
 * The guilds this user shares with the bot, each carrying whether that guild's
 * GitHub role gate permits them. One walk serves both `GET /api/me` and
 * `mayLinkGithub`, so the per-guild `members.fetch` happens once per request.
 *
 * A guild whose member fetch fails (left the server, rate limit, network) is
 * skipped rather than propagated: this now gates mutations, and a transient
 * Discord failure must not 500 the request or silently grant access.
 */
export async function mutualGuilds(ctx: AppContext, userId: string): Promise<MeGuildDto[]> {
  const guilds: MeGuildDto[] = [];
  if (!ctx.discord) return guilds;
  for (const guild of ctx.discord.guilds.cache.values()) {
    try {
      const member = await guild.members.fetch(userId);
      const config = ctx.repos.guildConfig.get(guild.id);
      guilds.push({
        id: guild.id,
        name: guild.name,
        iconUrl: guild.iconURL({ size: 64 }),
        githubAllowed: canUseGithub(config, [...member.roles.cache.keys()]),
      });
    } catch {
      // Not a member of this guild, or Discord didn't answer — skip, not an error.
    }
  }
  return guilds;
}

/**
 * Whether this user may link GitHub at all — the enforcement counterpart to
 * `MeDto.github.mayLink`.
 *
 * Deliberately "any mutual guild permits", not "this specific guild permits":
 * a GitHub identity is stored per user instance-wide (`ctx.github.link(userId,
 * …)`), not per guild, and whether the token may actually be *used* is
 * re-checked per guild at run time (discord/conversation.ts). So the linking
 * question is "may this user link at all", and the `/link-github` command only
 * checks the guild it happened to be typed in. Slightly more permissive than
 * that command by design — see the PR description.
 *
 * Fails closed when the roles can't be read at all: without a Discord
 * connection there is nothing to check against, so the answer is "not now"
 * (503, retryable) rather than a role complaint that isn't true.
 */
export function githubLinkEligibility(
  discordReady: boolean,
  guilds: MeGuildDto[],
): GithubLinkEligibility {
  if (!discordReady) {
    return {
      ok: false,
      status: 503,
      message:
        "The bot isn't connected to Discord right now, so I can't check your roles. Try again in a moment.",
    };
  }
  if (guilds.length === 0) {
    // Also can't use /link-github (it needs a guild), so this is consistent.
    return {
      ok: false,
      status: 403,
      message: "You don't share a server with the bot, so there's nothing to link against.",
    };
  }
  if (!guilds.some((g) => g.githubAllowed)) {
    return {
      ok: false,
      status: 403,
      message: "You don't have a role that's allowed to link a GitHub account on this server.",
    };
  }
  return { ok: true };
}

export async function checkGithubLinkEligibility(
  ctx: AppContext,
  userId: string,
): Promise<GithubLinkEligibility> {
  if (!ctx.discord) return githubLinkEligibility(false, []);
  return githubLinkEligibility(true, await mutualGuilds(ctx, userId));
}

/**
 * Self-service routes for a signed-in member: their own Claude/GitHub links,
 * their own usage, the onboarding wizard's state. Every handler here reads
 * `sub` from the session — never a path/body-supplied id — so there is no
 * user id to tamper with. Gated by requireUser only (not admin), and
 * mounted before the blanket `/api/*` admin middleware in server.ts, same
 * pattern as authRoutes.
 */
export function meRoutes(app: Hono, ctx: AppContext): void {
  app.use("/api/me/*", requireUser(ctx.auth));

  app.get("/api/me", async (c) => {
    const session = ctx.auth.getSession(c)!;
    const profile = ctx.repos.dashboardUsers.get(session.sub);
    const claudeIdentity = ctx.claude.get(session.sub);
    const githubIdentity = ctx.github.get(session.sub);
    const githubSkipped = profile?.githubSkipped ?? false;
    const creds = ctx.credentials();

    const guilds = await mutualGuilds(ctx, session.sub);
    // One source of truth for "why can't I link": the same function the
    // mutations enforce with, so the UI can never disagree with the server —
    // and in particular never says "you lack a role" when the real reason is
    // that Discord isn't connected yet.
    const eligibility = githubLinkEligibility(!!ctx.discord, guilds);
    const linkBlockedReason = !creds.githubAppClientId
      ? "This bot has no GitHub App configured yet, so GitHub linking is unavailable. Ask an operator to set one up."
      : eligibility.ok
        ? null
        : eligibility.message;

    const dto: MeDto = {
      user: {
        id: session.sub,
        username: profile?.username ?? null,
        globalName: profile?.globalName ?? null,
        avatarUrl: profile?.avatarUrl ?? null,
      },
      claude: {
        linked: !!claudeIdentity,
        linkedAt: claudeIdentity?.linkedAt ?? null,
        lastVerifiedAt: claudeIdentity?.lastVerifiedAt ?? null,
      },
      github: {
        linked: !!githubIdentity,
        login: githubIdentity?.login ?? null,
        skipped: githubSkipped,
        appConfigured: !!creds.githubAppClientId,
        linkBlockedReason,
      },
      onboardingComplete: !!claudeIdentity && (!!githubIdentity || githubSkipped),
      guilds,
    };
    return c.json(dto);
  });

  app.post("/api/me/claude", async (c) => {
    const session = ctx.auth.getSession(c)!;
    const body = (await c.req.json().catch(() => ({}))) as { token?: string };
    const token = body.token?.trim();
    if (!token) return c.json<SetupResultDto>({ ok: false, message: "Token is empty." }, 400);
    if (token.startsWith("sk-ant-api")) {
      return c.json<SetupResultDto>(
        {
          ok: false,
          message:
            "That looks like an Anthropic API key, not a subscription token. Get one with `claude setup-token` instead.",
        },
        400,
      );
    }

    const check = await checkClaudeAuth(ctx.engine, token);
    if (!check.ok) return c.json<SetupResultDto>({ ok: false, message: check.message }, 400);

    ctx.claude.link(session.sub, token);
    return c.json<SetupResultDto>({ ok: true, message: "Linked." });
  });

  app.delete("/api/me/claude", (c) => {
    const session = ctx.auth.getSession(c)!;
    return c.json({ ok: ctx.claude.unlink(session.sub) });
  });

  app.post("/api/me/github/device", async (c) => {
    const session = ctx.auth.getSession(c)!;
    const creds = ctx.credentials();
    if (!creds.githubAppClientId) {
      return c.json<GithubDeviceStartDto>(
        { ok: false, message: "GitHub linking isn't set up on this bot yet." },
        400,
      );
    }
    // The same role gate `/link-github` applies (discord/commands/link-github.ts).
    // It used to be missing here, so the browser path could link where the
    // Discord command would have refused.
    const eligible = await checkGithubLinkEligibility(ctx, session.sub);
    if (!eligible.ok) {
      return c.json<GithubDeviceStartDto>(
        { ok: false, message: eligible.message },
        eligible.status,
      );
    }
    try {
      const device = await requestDeviceCode(creds.githubAppClientId);
      return c.json<GithubDeviceStartDto>({
        ok: true,
        userCode: device.userCode,
        verificationUri: device.verificationUri,
        deviceCode: device.deviceCode,
        interval: device.interval,
        expiresIn: device.expiresIn,
      });
    } catch (err) {
      const message = err instanceof DeviceFlowError ? err.message : "Couldn't reach GitHub.";
      return c.json<GithubDeviceStartDto>({ ok: false, message }, 400);
    }
  });

  /**
   * One poll of the device code. No server-side pending state — the
   * single-use deviceCode round-trips through the browser, which calls this
   * repeatedly at the interval GitHub returned until it gets a terminal status.
   *
   * The role gate is re-checked here, but *only* on the poll that actually
   * authorizes: that is where `ctx.github.link` stores the identity, and the
   * deviceCode carries no guild information, so gating the start alone would be
   * bypassable. Checking every poll would instead mean a `members.fetch` per
   * guild every ~5s for up to 900s — a REST storm against a rate-limited API.
   */
  app.post("/api/me/github/device/poll", async (c) => {
    const session = ctx.auth.getSession(c)!;
    const creds = ctx.credentials();
    const body = (await c.req.json().catch(() => ({}))) as { deviceCode?: string };
    const deviceCode = body.deviceCode;
    if (!creds.githubAppClientId || !deviceCode) {
      return c.json<GithubDevicePollDto>({ status: "error", message: "Missing device code." }, 400);
    }
    try {
      const result = await exchangeDeviceCode(creds.githubAppClientId, deviceCode);
      if (result.kind === "pending") return c.json<GithubDevicePollDto>({ status: "pending" });
      if (result.kind === "slow_down") {
        return c.json<GithubDevicePollDto>({ status: "pending", interval: result.interval });
      }
      const eligible = await checkGithubLinkEligibility(ctx, session.sub);
      if (!eligible.ok) {
        return c.json<GithubDevicePollDto>(
          { status: "error", message: eligible.message },
          eligible.status,
        );
      }
      const summary = await ctx.github.link(session.sub, result.tokens);
      return c.json<GithubDevicePollDto>({ status: "authorized", login: summary.login });
    } catch (err) {
      const message = err instanceof DeviceFlowError ? err.message : "Linking failed.";
      return c.json<GithubDevicePollDto>({ status: "error", message }, 400);
    }
  });

  app.post("/api/me/github/skip", (c) => {
    const session = ctx.auth.getSession(c)!;
    ctx.repos.dashboardUsers.setGithubSkipped(session.sub, true);
    return c.json({ ok: true });
  });

  app.delete("/api/me/github", async (c) => {
    const session = ctx.auth.getSession(c)!;
    const identity = ctx.github.get(session.sub);
    if (identity) {
      const creds = ctx.credentials();
      if (creds.githubAppClientId && creds.githubAppClientSecret) {
        await revokeUserToken(
          creds.githubAppClientId,
          creds.githubAppClientSecret,
          identity.accessToken,
        );
      }
    }
    return c.json({ ok: ctx.github.unlink(session.sub) });
  });

  app.get("/api/me/usage", (c) => {
    const session = ctx.auth.getSession(c)!;
    const windowDays = Math.min(
      Math.max(Number.parseInt(c.req.query("window") ?? "30", 10) || 30, 1),
      365,
    );
    const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000).toISOString();
    const totals = ctx.repos.usage.userTotalsSince(session.sub, since);
    const dto: MeUsageDto = {
      windowDays,
      totalRuns: totals.runs,
      totalErrors: totals.errors,
      totalInputTokens: totals.inputTokens,
      totalOutputTokens: totals.outputTokens,
      totalCostUsd: totals.costUsd,
    };
    return c.json(dto);
  });
}
