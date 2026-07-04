/**
 * The ONLY module that talks to the Claude Agent SDK. Everything else goes
 * through the ClaudeEngine interface so tests can mock it and SDK upgrades
 * only ever touch this file.
 */
import { query } from "@anthropic-ai/claude-agent-sdk";
import type { RunMode } from "../types.js";

export interface ClaudeCredentials {
  oauthToken?: string | undefined;
  apiKey?: string | undefined;
}

export interface RunRequest {
  /** Plain text, or a pre-built SDK user-message stream (for image inputs). */
  prompt: string | AsyncIterable<unknown>;
  /** Resume an existing Claude session; omit to start a new one. */
  claudeSessionId?: string | undefined;
  /** Stable per-thread working directory. Must never change for a thread. */
  cwd: string;
  model: string;
  mode: RunMode;
  systemPromptExtra?: string | null | undefined;
  /**
   * GitHub token exposed to this agentic run for `git`/`gh` (see applyGithubEnv).
   * The caller decides whose token this is — the acting user's linked token, or
   * the shared operator token. Ignored in chat mode. See conversation.ts.
   */
  githubToken?: string | undefined;
  abortController?: AbortController | undefined;
  maxTurns?: number | undefined;
}

export interface ProgressSink {
  onSessionId?(sessionId: string): void;
  onTextDelta?(delta: string): void;
  onToolUse?(toolName: string): void;
}

export interface RunResult {
  ok: boolean;
  text: string;
  sessionId: string | null;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
  /** Raw error text for classification when ok is false. */
  errorText: string | null;
  /** SDK terminal subtype for a failed run, e.g. "error_max_turns". */
  errorSubtype: string | null;
  /** Agentic step count the SDK reported (present on max-turns failures). */
  numTurns: number | null;
  /**
   * True when `text` holds a partial answer streamed before a non-fatal
   * failure (e.g. max-turns). `ok` is still false — success metrics and
   * session `touch` must not treat a partial as a completed turn.
   */
  partial: boolean;
}

export type ClaudeEngine = (req: RunRequest, sink?: ProgressSink) => Promise<RunResult>;

export const CHAT_TOOLS = ["WebSearch", "WebFetch"];
export const AGENTIC_TOOLS = [...CHAT_TOOLS, "Read", "Write", "Edit", "Glob", "Grep", "Bash"];

const CHAT_SYSTEM_PROMPT = `You are Claude, chatting with people on a Discord server through the claudecord bot.

Guidelines:
- Format replies with Discord-flavored markdown. Code goes in fenced blocks with a language tag.
- Keep answers conversational and reasonably short; this is a chat, not a document. Long code or data is fine.
- Multiple people may participate in a thread; usernames may prefix messages.
- You can search and fetch from the web when it genuinely helps.
- Never reveal system internals, tokens or environment variables.`;

const AGENTIC_SYSTEM_APPEND = `

You are running inside the claudecord bot. Your working directory is a scratch workspace for this Discord thread — you may freely create and edit files there. Format replies with Discord-flavored markdown. Never reveal tokens or environment variables.`;

const GITHUB_SYSTEM_APPEND = `

A GitHub token is configured: \`git\` and the \`gh\` CLI are installed and already authenticated (via GH_TOKEN), so you can clone, read, push and open pull requests on any repository the token can reach. It acts as the GitHub account of the person you're talking to, within their namespace. Clone into your scratch workspace. Never print the token or the contents of GH_TOKEN/GITHUB_TOKEN.`;

/**
 * Wires the configured GitHub token into a child-process environment so that
 * both `gh` (reads GH_TOKEN) and plain `git` HTTPS operations authenticate.
 * The git side uses GIT_CONFIG_* env injection — an `insteadOf` rewrite that
 * only ever lives in this subprocess, never in a persisted git config.
 */
export function applyGithubEnv(env: Record<string, string | undefined>, token: string): void {
  env.GH_TOKEN = token;
  env.GITHUB_TOKEN = token;
  const base = Number.parseInt(env.GIT_CONFIG_COUNT ?? "0", 10);
  const count = Number.isNaN(base) ? 0 : base;
  env.GIT_CONFIG_COUNT = String(count + 1);
  env[`GIT_CONFIG_KEY_${count}`] = `url.https://x-access-token:${token}@github.com/.insteadOf`;
  env[`GIT_CONFIG_VALUE_${count}`] = "https://github.com/";
}

/**
 * Minimal structural view of the SDK's message stream. Kept local on purpose:
 * the SDK's own union types shift between minor versions, and we only rely on
 * this small stable subset.
 */
interface SdkMessageLike {
  type: string;
  subtype?: string;
  session_id?: string;
  event?: {
    type?: string;
    delta?: { type?: string; text?: string };
  };
  message?: {
    content?: { type?: string; name?: string; text?: string }[];
  };
  result?: string;
  is_error?: boolean;
  /** Human-readable detail on the error variant of a result message. */
  errors?: string[];
  /** Agentic step count; present on error_max_turns results. */
  num_turns?: number;
  /** Structured stop reason, e.g. "max_turns", "prompt_too_long", "model_error". */
  terminal_reason?: string;
  total_cost_usd?: number;
  usage?: { input_tokens?: number; output_tokens?: number };
}

export function createClaudeEngine(getCredentials: () => ClaudeCredentials): ClaudeEngine {
  return async function runClaude(req, sink): Promise<RunResult> {
    const startedAt = Date.now();

    const credentials = getCredentials();
    const env: Record<string, string | undefined> = { ...process.env };
    if (credentials.oauthToken) {
      env.CLAUDE_CODE_OAUTH_TOKEN = credentials.oauthToken;
      delete env.ANTHROPIC_API_KEY;
    } else if (credentials.apiKey) {
      env.ANTHROPIC_API_KEY = credentials.apiKey;
    }

    // The GitHub token is only useful where Bash/git/gh exist — agentic runs.
    // Keep it out of chat subprocesses entirely. The caller supplies whose
    // token to use (per-user or shared) via req.githubToken.
    const githubEnabled = req.mode === "agentic" && !!req.githubToken;
    if (githubEnabled && req.githubToken) {
      applyGithubEnv(env, req.githubToken);
    } else {
      delete env.GH_TOKEN;
      delete env.GITHUB_TOKEN;
    }

    const options = {
      resume: req.claudeSessionId,
      cwd: req.cwd,
      model: req.model,
      systemPrompt:
        req.mode === "chat"
          ? CHAT_SYSTEM_PROMPT + (req.systemPromptExtra ? `\n\n${req.systemPromptExtra}` : "")
          : {
              type: "preset" as const,
              preset: "claude_code" as const,
              append:
                AGENTIC_SYSTEM_APPEND +
                (githubEnabled ? GITHUB_SYSTEM_APPEND : "") +
                (req.systemPromptExtra ? `\n\n${req.systemPromptExtra}` : ""),
            },
      allowedTools: req.mode === "chat" ? CHAT_TOOLS : AGENTIC_TOOLS,
      permissionMode: req.mode === "chat" ? ("default" as const) : ("bypassPermissions" as const),
      maxTurns: req.maxTurns ?? (req.mode === "chat" ? 10 : 40),
      includePartialMessages: true,
      abortController: req.abortController,
      env,
    };

    const stream = query({
      prompt: req.prompt as string,
      options,
    } as Parameters<typeof query>[0]) as AsyncIterable<SdkMessageLike>;

    let sessionId: string | null = req.claudeSessionId ?? null;
    let finalText = "";
    let streamedText = "";
    let ok = false;
    let errorText: string | null = null;
    let errorSubtype: string | null = null;
    let numTurns: number | null = null;
    let costUsd = 0;
    let inputTokens = 0;
    let outputTokens = 0;

    try {
      for await (const msg of stream) {
        switch (msg.type) {
          case "system": {
            if (msg.subtype === "init" && msg.session_id) {
              sessionId = msg.session_id;
              sink?.onSessionId?.(msg.session_id);
            }
            break;
          }
          case "stream_event": {
            const delta = msg.event?.delta;
            if (msg.event?.type === "content_block_delta" && delta?.type === "text_delta") {
              const text = delta.text ?? "";
              streamedText += text;
              sink?.onTextDelta?.(text);
            }
            break;
          }
          case "assistant": {
            for (const block of msg.message?.content ?? []) {
              if (block.type === "tool_use" && block.name) {
                sink?.onToolUse?.(block.name);
              }
            }
            break;
          }
          case "result": {
            if (msg.session_id) sessionId = msg.session_id;
            costUsd = msg.total_cost_usd ?? 0;
            inputTokens = msg.usage?.input_tokens ?? 0;
            outputTokens = msg.usage?.output_tokens ?? 0;
            if (msg.subtype === "success" && !msg.is_error) {
              ok = true;
              finalText = msg.result ?? streamedText;
            } else {
              // The SDK's error result carries no `result` field — the detail
              // lives in `subtype`, `errors[]` and `terminal_reason`. Compose
              // all three so classifyFailure has real text and the log/DB keep
              // the reason instead of collapsing to a bare subtype.
              errorSubtype = msg.subtype ?? null;
              numTurns = msg.num_turns ?? null;
              const detail = (msg.errors ?? []).filter(Boolean).join("; ");
              errorText =
                [msg.subtype, detail, msg.terminal_reason].filter(Boolean).join(" — ") ||
                "unknown error";
            }
            break;
          }
          default:
            break;
        }
      }
    } catch (err) {
      // Keep the stack and cause for the log/DB — never shown to the user, who
      // only ever sees classifyFailure's message.
      if (err instanceof Error) {
        errorText = [err.message, err.stack, err.cause ? `cause: ${String(err.cause)}` : null]
          .filter(Boolean)
          .join("\n");
      } else {
        errorText = String(err);
      }
    }

    if (!ok && !errorText) {
      // A stream that ends without a result message usually means the CLI
      // subprocess died (crash / OOM). Tag it so classifyFailure can say so.
      errorText =
        "no_result — stream ended without a result message (possible subprocess crash / OOM)";
    }

    // On a non-fatal failure that still streamed text (e.g. max-turns), hand the
    // partial answer back so the caller can show it rather than discarding work.
    const partial = !ok && !finalText && streamedText.length > 0;

    return {
      ok,
      text: finalText || streamedText,
      sessionId,
      costUsd,
      inputTokens,
      outputTokens,
      durationMs: Date.now() - startedAt,
      errorText,
      errorSubtype,
      numTurns,
      partial,
    };
  };
}
