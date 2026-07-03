---
title: Agent SDK integration
description: Why the OAuth token forces this design, and how runner.ts works.
---

## Why the Agent SDK, not the Messages API

The project's core constraint: authenticate with a **Claude Code OAuth
token** (`claude setup-token`, subscription-based) instead of an API key.
That token is only honored by Claude Code itself — the plain Anthropic
Messages API rejects it. So the bot drives Claude the same way the official
GitHub Action does: through Claude Code, via the
[Claude Agent SDK](https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk),
which spawns the bundled CLI as a subprocess.

What looks like a limitation buys a lot:

- **Sessions for free** — Claude Code persists conversations on disk;
  `resume` gives every Discord thread durable memory.
- **Tools for free** — WebSearch/WebFetch in chat mode; Read/Write/Bash in
  agentic mode, with `allowedTools` as the safety boundary.
- **Auth parity** — `CLAUDE_CODE_OAUTH_TOKEN` and `ANTHROPIC_API_KEY` work
  through the identical code path; the CLI resolves them.

## How `runner.ts` shapes the call

```ts
query({
  prompt,                        // string, or AsyncIterable for image inputs
  options: {
    resume: claudeSessionId,     // undefined on the first turn
    cwd,                         // per-thread workspace — NEVER changes
    model,
    systemPrompt,                // custom string (chat) or claude_code preset + append (agentic)
    allowedTools,                // ["WebSearch","WebFetch"] or + file/shell tools
    permissionMode,              // "default" (chat) / "bypassPermissions" (agentic)
    maxTurns,                    // 10 chat / 40 agentic / 6 for /ask
    includePartialMessages: true,// stream_event deltas for pseudo-streaming
    abortController,             // dashboard abort + /reset
    env,                         // process env + the effective credential
  },
})
```

The message stream is consumed with a **local structural type**
(`SdkMessageLike`) rather than the SDK's exported unions. This is deliberate:
the SDK is young and its types shift between minors. We depend on four
stable message shapes (`system/init`, `stream_event`, `assistant`,
`result`) and nothing else.

## Session persistence — the sharp edge

Claude Code stores sessions under `~/.claude/projects/<hash-of-cwd>/`.
Two consequences maintainers must protect:

1. A thread's `cwd` is written once into `thread_sessions` and must never be
   recomputed differently — otherwise `resume` silently starts fresh.
2. Deployments must persist `~/.claude` (Docker volume), or restarts wipe
   all conversation memory.

## Upgrading the SDK

The version is pinned exactly in `packages/bot/package.json`. To upgrade:

1. Bump the pin, `npm install`.
2. `npm run typecheck && npm test` (tests mock the engine, so they catch
   interface drift in *our* code, not the SDK's behavior).
3. Run a real smoke test with a token: start the bot, mention it, confirm
   session resume works across two messages, check `stream_event` deltas
   still arrive (watch the placeholder grow).
4. Note any changed error-message wording — `claude/errors.ts` fixtures may
   need additions (add fixtures, don't loosen patterns).

## Known limitations

- **No headless token refresh:** expired OAuth tokens require a human to run
  `claude setup-token` again. Surface, don't hide, auth errors.
- **Rate-limit shapes are unstable:** subscription limits arrive as free
  text in the `result` message. `errors.ts` matches defensively and falls
  back to a generic message.
- **A subprocess per run:** concurrency is bounded by `RunQueue`'s global
  semaphore; treat `MAX_CONCURRENT_RUNS` as a memory knob.
