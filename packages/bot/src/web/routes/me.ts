import type { Hono } from "hono";
import { checkClaudeAuth } from "../../claude/auth-check.js";
import type { AppContext } from "../../context.js";
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

    const guilds: MeGuildDto[] = [];
    if (ctx.discord) {
      for (const guild of ctx.discord.guilds.cache.values()) {
        try {
          await guild.members.fetch(session.sub);
          guilds.push({ id: guild.id, name: guild.name, iconUrl: guild.iconURL({ size: 64 }) });
        } catch {
          // Not a member of this guild — skip, not an error.
        }
      }
    }

    const dto: MeDto = {
      user: {
        id: session.sub,
        username: profile?.username ?? null,
        globalName: profile?.globalName ?? null,
        avatarUrl: profile?.avatarUrl ?? null,
      },
      claude: {
        linked: !!claudeIdentity,
        lastVerifiedAt: claudeIdentity?.lastVerifiedAt ?? null,
      },
      github: {
        linked: !!githubIdentity,
        login: githubIdentity?.login ?? null,
        skipped: githubSkipped,
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
            "That looks like a plain Anthropic API key. claudecord runs on Claude Code subscriptions — get a token with `claude setup-token` instead.",
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
    const creds = ctx.credentials();
    if (!creds.githubAppClientId) {
      return c.json<GithubDeviceStartDto>(
        { ok: false, message: "GitHub linking isn't set up on this bot yet." },
        400,
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
