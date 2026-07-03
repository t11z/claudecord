import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { classifyFailure } from "./errors.js";
import type { ClaudeEngine } from "./runner.js";

export interface AuthCheckResult {
  ok: boolean;
  message: string;
}

/**
 * Validates Claude credentials by running a minimal one-turn query.
 * Used at startup and by the dashboard setup wizard.
 */
export async function checkClaudeAuth(engine: ClaudeEngine): Promise<AuthCheckResult> {
  try {
    const cwd = path.join(os.tmpdir(), "claudecord-authcheck");
    fs.mkdirSync(cwd, { recursive: true });
    const result = await engine({
      prompt: "Reply with the single word: ok",
      cwd,
      model: "claude-haiku-4-5-20251001",
      mode: "chat",
      maxTurns: 1,
    });
    if (result.ok) {
      return { ok: true, message: "Claude responded — credentials are working." };
    }
    const classified = classifyFailure(result.errorText ?? "");
    if (classified.kind === "auth") {
      return {
        ok: false,
        message: "Authentication failed. Re-run `claude setup-token` and update the token.",
      };
    }
    if (classified.kind === "rate_limit") {
      // The credential works, the subscription is just out of quota right now.
      return { ok: true, message: "Credentials work, but the usage limit is currently reached." };
    }
    return { ok: false, message: `Check failed: ${result.errorText ?? "unknown error"}` };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}
