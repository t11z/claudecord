import { describe, expect, it } from "vitest";
import { openMemoryDatabase } from "../src/db/database.js";
import { AppConfigRepo } from "../src/db/repos/app-config.js";
import { GuildConfigRepo } from "../src/db/repos/guild-config.js";
import { SessionRepo } from "../src/db/repos/sessions.js";
import { UsageRepo } from "../src/db/repos/usage.js";

describe("SessionRepo", () => {
  it("creates, reads, touches and deletes sessions", () => {
    const repo = new SessionRepo(openMemoryDatabase());
    const created = repo.create({
      threadId: "t1",
      guildId: "g1",
      channelId: "c1",
      claudeSessionId: null,
      model: "claude-sonnet-5",
      mode: "chat",
      cwd: "/data/workspaces/g1/t1",
    });
    expect(created.turnCount).toBe(0);

    repo.setClaudeSessionId("t1", "session-uuid");
    repo.touch("t1");
    const loaded = repo.get("t1");
    expect(loaded?.claudeSessionId).toBe("session-uuid");
    expect(loaded?.turnCount).toBe(1);

    expect(repo.delete("t1")).toBe(true);
    expect(repo.get("t1")).toBeUndefined();
    expect(repo.delete("t1")).toBe(false);
  });

  it("lists idle sessions before a cutoff", () => {
    const repo = new SessionRepo(openMemoryDatabase());
    repo.create({
      threadId: "t1",
      guildId: "g1",
      channelId: "c1",
      claudeSessionId: null,
      model: "m",
      mode: "chat",
      cwd: "/w",
    });
    const future = new Date(Date.now() + 60_000).toISOString();
    expect(repo.listIdleSince(future)).toHaveLength(1);
    const past = new Date(Date.now() - 60_000).toISOString();
    expect(repo.listIdleSince(past)).toHaveLength(0);
  });
});

describe("GuildConfigRepo", () => {
  it("returns defaults for unknown guilds", () => {
    const repo = new GuildConfigRepo(openMemoryDatabase());
    const cfg = repo.get("unknown");
    expect(cfg.enabled).toBe(true);
    expect(cfg.allowedChannelIds).toEqual([]);
    expect(cfg.agenticEnabled).toBe(false);
  });

  it("round-trips config including allowlists", () => {
    const repo = new GuildConfigRepo(openMemoryDatabase());
    repo.upsert({
      guildId: "g1",
      enabled: false,
      allowedChannelIds: ["c1", "c2"],
      allowedRoleIds: ["r1"],
      agenticEnabled: true,
      githubRoleIds: ["r2"],
      model: "claude-opus-4-8",
      systemPromptExtra: "Be terse.",
    });
    const cfg = repo.get("g1");
    expect(cfg.enabled).toBe(false);
    expect(cfg.allowedChannelIds).toEqual(["c1", "c2"]);
    expect(cfg.allowedRoleIds).toEqual(["r1"]);
    expect(cfg.agenticEnabled).toBe(true);
    expect(cfg.githubRoleIds).toEqual(["r2"]);
    expect(cfg.model).toBe("claude-opus-4-8");

    repo.upsert({ ...cfg, model: null });
    expect(repo.get("g1").model).toBeNull();
  });

  it("survives corrupted allowlist JSON", () => {
    const db = openMemoryDatabase();
    const repo = new GuildConfigRepo(db);
    db.prepare(
      "INSERT INTO guild_config (guild_id, allowed_channel_ids) VALUES ('g1', 'not json')",
    ).run();
    expect(repo.get("g1").allowedChannelIds).toEqual([]);
  });
});

describe("UsageRepo", () => {
  const entry = {
    guildId: "g1",
    userId: "u1",
    threadId: "t1",
    startedAt: new Date().toISOString(),
    durationMs: 1200,
    inputTokens: 100,
    outputTokens: 500,
    costUsd: 0.05,
    model: "claude-sonnet-5",
    ok: true,
    errorKind: null,
  };

  it("aggregates totals", () => {
    const repo = new UsageRepo(openMemoryDatabase());
    repo.record(entry);
    repo.record({ ...entry, ok: false, errorKind: "rate_limit" });
    const since = new Date(Date.now() - 1000 * 60).toISOString();
    const totals = repo.totalsSince(since);
    expect(totals.runs).toBe(2);
    expect(totals.errors).toBe(1);
    expect(totals.inputTokens).toBe(200);
    expect(totals.outputTokens).toBe(1000);
  });

  it("scopes guild totals and tracks the last rate limit", () => {
    const repo = new UsageRepo(openMemoryDatabase());
    repo.record(entry);
    repo.record({ ...entry, guildId: "g2", ok: false, errorKind: "rate_limit" });
    const since = new Date(Date.now() - 1000 * 60).toISOString();
    expect(repo.guildTotalsSince("g1", since).runs).toBe(1);
    expect(repo.guildTotalsSince("g2", since).runs).toBe(1);
    expect(repo.lastRateLimitAt()).not.toBeNull();
    expect(repo.topGuildsSince(since)).toHaveLength(2);
    expect(repo.topUsersSince(since)[0]?.userId).toBe("u1");
  });

  it("groups daily stats", () => {
    const repo = new UsageRepo(openMemoryDatabase());
    repo.record(entry);
    const since = new Date(Date.now() - 1000 * 60).toISOString();
    const daily = repo.dailySince(since);
    expect(daily).toHaveLength(1);
    expect(daily[0]?.runs).toBe(1);
  });

  it("persists and returns recent errors with correlation detail", () => {
    const repo = new UsageRepo(openMemoryDatabase());
    repo.record(entry);
    repo.record({
      ...entry,
      ok: false,
      errorKind: "max_turns",
      runId: "run-123",
      errorSubtype: "error_max_turns",
      errorDetail: "error_max_turns — Reached the maximum number of turns (40)",
    });
    const since = new Date(Date.now() - 1000 * 60).toISOString();
    const errors = repo.recentErrorsSince(since);
    expect(errors).toHaveLength(1);
    expect(errors[0]?.runId).toBe("run-123");
    expect(errors[0]?.kind).toBe("max_turns");
    expect(errors[0]?.subtype).toBe("error_max_turns");
    expect(errors[0]?.detail).toContain("maximum number of turns");
  });
});

describe("AppConfigRepo", () => {
  it("stores and initializes values", () => {
    const repo = new AppConfigRepo(openMemoryDatabase());
    expect(repo.get("missing")).toBeUndefined();
    repo.set("k", "v1");
    expect(repo.get("k")).toBe("v1");
    repo.set("k", "v2");
    expect(repo.get("k")).toBe("v2");
    expect(repo.getOrInit("k", () => "never")).toBe("v2");
    expect(repo.getOrInit("fresh", () => "init")).toBe("init");
    expect(repo.get("fresh")).toBe("init");
  });
});
