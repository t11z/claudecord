import { describe, expect, it } from "vitest";
import { classifyFailure, parseResetTime } from "../src/claude/errors.js";

/**
 * Fixture texts mirror real Claude Code CLI output shapes. If the CLI changes
 * its wording upstream, add the new shape here — never loosen assertions.
 */
const FIXTURES = {
  fiveHourLimit: "Claude usage limit reached. Your limit will reset at 3am (Europe/Berlin).",
  weeklyLimit: "Weekly limit reached ∙ resets 2026-07-05T09:00:00Z",
  plainRateLimit: 'API Error: 429 {"type":"rate_limit_error"}',
  overloaded: "API Error: 529 overloaded_error: Overloaded",
  expiredOauth: "OAuth token has expired. Please run /login to re-authenticate.",
  invalidKey: 'API Error: 401 {"type":"authentication_error","message":"invalid x-api-key"}',
  lowCredits: "Your credit balance is too low to access the Anthropic API.",
  aborted: "Request was aborted.",
  gibberish: "Segmentation fault (core dumped)",
  // Composed by the runner from an SDK error result (subtype — errors[] — terminal_reason).
  maxTurns: "error_max_turns — Reached the maximum number of turns (40) — max_turns",
  budget: "error_max_budget_usd — Spending cap of $5.00 reached",
  executionError: "error_during_execution — tool execution failed",
  crashed: "no_result — stream ended without a result message (possible subprocess crash / OOM)",
  network: "API Error: request to https://api.anthropic.com failed, reason: ECONNRESET",
} as const;

describe("classifyFailure", () => {
  it("classifies subscription limit messages as rate_limit", () => {
    expect(classifyFailure(FIXTURES.fiveHourLimit).kind).toBe("rate_limit");
    expect(classifyFailure(FIXTURES.weeklyLimit).kind).toBe("rate_limit");
  });

  it("classifies HTTP 429 and overloaded as rate_limit", () => {
    expect(classifyFailure(FIXTURES.plainRateLimit).kind).toBe("rate_limit");
    expect(classifyFailure(FIXTURES.overloaded).kind).toBe("rate_limit");
  });

  it("classifies auth failures", () => {
    expect(classifyFailure(FIXTURES.expiredOauth).kind).toBe("auth");
    expect(classifyFailure(FIXTURES.invalidKey).kind).toBe("auth");
    expect(classifyFailure(FIXTURES.lowCredits).kind).toBe("auth");
  });

  it("classifies aborts", () => {
    expect(classifyFailure(FIXTURES.aborted).kind).toBe("aborted");
  });

  it("classifies SDK terminal error subtypes", () => {
    expect(classifyFailure(FIXTURES.maxTurns).kind).toBe("max_turns");
    expect(classifyFailure(FIXTURES.budget).kind).toBe("budget");
    expect(classifyFailure(FIXTURES.executionError).kind).toBe("execution_error");
    expect(classifyFailure(FIXTURES.crashed).kind).toBe("crashed");
    expect(classifyFailure(FIXTURES.network).kind).toBe("network");
  });

  it("interpolates the turn count into max_turns messages when provided", () => {
    const now = new Date();
    expect(classifyFailure(FIXTURES.maxTurns, now, { numTurns: 40 }).message).toContain(
      "(40 turns)",
    );
    expect(classifyFailure(FIXTURES.maxTurns, now).message).not.toContain("(");
  });

  it("does not leak raw internals into user-facing messages", () => {
    // The composed error text (paths, stack tokens, subtypes) must never surface.
    for (const kind of ["maxTurns", "budget", "executionError", "crashed", "network"] as const) {
      const { message } = classifyFailure(FIXTURES[kind]);
      expect(message).not.toContain("error_");
      expect(message).not.toContain("ECONNRESET");
    }
  });

  it("falls back to unknown with a friendly message", () => {
    const result = classifyFailure(FIXTURES.gibberish);
    expect(result.kind).toBe("unknown");
    expect(result.message).not.toContain("Segmentation");
  });

  it("attaches the parsed reset time to rate limits", () => {
    const result = classifyFailure(FIXTURES.weeklyLimit);
    expect(result.resetsAt?.toISOString()).toBe("2026-07-05T09:00:00.000Z");
  });
});

describe("parseResetTime", () => {
  const now = new Date("2026-07-03T12:00:00Z");

  it("parses ISO timestamps", () => {
    expect(parseResetTime("resets 2026-07-05T09:00:00Z", now)?.toISOString()).toBe(
      "2026-07-05T09:00:00.000Z",
    );
  });

  it("parses am/pm clock times as the next occurrence", () => {
    const parsed = parseResetTime("will reset at 3am", now);
    expect(parsed).not.toBeNull();
    expect(parsed!.getHours()).toBe(3);
    expect(parsed!.getTime()).toBeGreaterThan(now.getTime());
  });

  it("parses 24h clock times", () => {
    const parsed = parseResetTime("resets at 15:30", now);
    expect(parsed).not.toBeNull();
    expect(parsed!.getHours()).toBe(15);
    expect(parsed!.getMinutes()).toBe(30);
  });

  it("returns null when nothing matches", () => {
    expect(parseResetTime("no time here", now)).toBeNull();
    expect(parseResetTime("resets at 99:99", now)).toBeNull();
  });
});
