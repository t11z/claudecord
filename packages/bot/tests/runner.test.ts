import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The runner is the only module that talks to the Agent SDK, so these tests
 * mock `query` and feed hand-built message streams that mirror the SDK's real
 * shapes — especially the error-result variant, which carries its detail in
 * `subtype`/`errors[]`/`terminal_reason` and has NO `result` field.
 */
const queryMock = vi.fn();
vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  query: (...args: unknown[]) => queryMock(...args),
}));

const { createClaudeEngine } = await import("../src/claude/runner.js");

function stream(messages: unknown[]): AsyncIterable<unknown> {
  return {
    async *[Symbol.asyncIterator]() {
      for (const m of messages) yield m;
    },
  };
}

const engine = createClaudeEngine();
const baseReq = {
  prompt: "hi",
  cwd: "/tmp/thread",
  model: "claude-sonnet-5",
  mode: "chat" as const,
  claudeToken: "test-token",
};

beforeEach(() => {
  queryMock.mockReset();
});

describe("runClaude result handling", () => {
  it("returns ok with the final text on a success result", async () => {
    queryMock.mockReturnValue(
      stream([
        { type: "system", subtype: "init", session_id: "sess-1" },
        {
          type: "result",
          subtype: "success",
          is_error: false,
          result: "the answer",
          session_id: "sess-1",
          total_cost_usd: 0.01,
          usage: { input_tokens: 10, output_tokens: 20 },
        },
      ]),
    );

    const res = await engine(baseReq);
    expect(res.ok).toBe(true);
    expect(res.text).toBe("the answer");
    expect(res.sessionId).toBe("sess-1");
    expect(res.errorText).toBeNull();
    expect(res.partial).toBe(false);
  });

  it("composes rich error text and keeps the partial answer on error_max_turns", async () => {
    queryMock.mockReturnValue(
      stream([
        { type: "system", subtype: "init", session_id: "sess-2" },
        {
          type: "stream_event",
          event: {
            type: "content_block_delta",
            delta: { type: "text_delta", text: "half an ans" },
          },
        },
        {
          type: "result",
          subtype: "error_max_turns",
          is_error: true,
          num_turns: 40,
          errors: ["Reached the maximum number of turns (40)"],
          terminal_reason: "max_turns",
          session_id: "sess-2",
        },
      ]),
    );

    const res = await engine(baseReq);
    expect(res.ok).toBe(false);
    expect(res.errorSubtype).toBe("error_max_turns");
    expect(res.numTurns).toBe(40);
    expect(res.errorText).toBe(
      "error_max_turns — Reached the maximum number of turns (40) — max_turns",
    );
    // Partial streamed answer is preserved rather than discarded.
    expect(res.text).toBe("half an ans");
    expect(res.partial).toBe(true);
  });

  it("does not mark partial when a failed run streamed nothing", async () => {
    queryMock.mockReturnValue(
      stream([
        {
          type: "result",
          subtype: "error_during_execution",
          is_error: true,
          errors: ["tool blew up"],
        },
      ]),
    );

    const res = await engine(baseReq);
    expect(res.ok).toBe(false);
    expect(res.partial).toBe(false);
    expect(res.errorSubtype).toBe("error_during_execution");
    expect(res.errorText).toContain("error_during_execution");
    expect(res.errorText).toContain("tool blew up");
  });

  it("keeps stack detail when the stream throws", async () => {
    queryMock.mockReturnValue({
      [Symbol.asyncIterator]() {
        return { next: () => Promise.reject(new Error("socket hang up")) };
      },
    });

    const res = await engine(baseReq);
    expect(res.ok).toBe(false);
    expect(res.errorText).toContain("socket hang up");
    // The message plus a stack trace, not just the bare message.
    expect(res.errorText!.split("\n").length).toBeGreaterThan(1);
  });

  it("tags a stream that ends with no result message as a crash", async () => {
    queryMock.mockReturnValue(stream([{ type: "system", subtype: "init", session_id: "sess-3" }]));

    const res = await engine(baseReq);
    expect(res.ok).toBe(false);
    expect(res.errorText).toContain("no_result");
  });
});

describe("runClaude env wiring", () => {
  const emptyResult = stream([
    { type: "result", subtype: "success", is_error: false, result: "ok" },
  ]);

  it("puts the request's claudeToken into CLAUDE_CODE_OAUTH_TOKEN and strips a stray API key", async () => {
    queryMock.mockReturnValue(emptyResult);
    const prevApiKey = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = "should-be-removed";
    try {
      await engine({ ...baseReq, claudeToken: "user-specific-token" });
    } finally {
      if (prevApiKey === undefined) delete process.env.ANTHROPIC_API_KEY;
      else process.env.ANTHROPIC_API_KEY = prevApiKey;
    }

    const options = queryMock.mock.calls.at(-1)?.[0]?.options as { env: Record<string, string> };
    expect(options.env.CLAUDE_CODE_OAUTH_TOKEN).toBe("user-specific-token");
    expect(options.env.ANTHROPIC_API_KEY).toBeUndefined();
  });

  it("omits GitHub env vars in chat mode even when a githubToken is supplied", async () => {
    queryMock.mockReturnValue(emptyResult);
    await engine({ ...baseReq, mode: "chat", githubToken: "gho_x" });

    const options = queryMock.mock.calls.at(-1)?.[0]?.options as { env: Record<string, string> };
    expect(options.env.GH_TOKEN).toBeUndefined();
    expect(options.env.GITHUB_TOKEN).toBeUndefined();
  });

  it("wires GitHub env vars only in agentic mode with a githubToken", async () => {
    queryMock.mockReturnValue(emptyResult);
    await engine({ ...baseReq, mode: "agentic", githubToken: "gho_x" });

    const options = queryMock.mock.calls.at(-1)?.[0]?.options as { env: Record<string, string> };
    expect(options.env.GH_TOKEN).toBe("gho_x");
    expect(options.env.GITHUB_TOKEN).toBe("gho_x");
  });

  it("omits GitHub env vars in agentic mode with no githubToken", async () => {
    queryMock.mockReturnValue(emptyResult);
    await engine({ ...baseReq, mode: "agentic" });

    const options = queryMock.mock.calls.at(-1)?.[0]?.options as { env: Record<string, string> };
    expect(options.env.GH_TOKEN).toBeUndefined();
    expect(options.env.GITHUB_TOKEN).toBeUndefined();
  });
});
