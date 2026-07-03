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
