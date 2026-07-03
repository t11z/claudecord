export type ErrorKind = "rate_limit" | "auth" | "aborted" | "unknown";

export interface ClassifiedError {
  kind: ErrorKind;
  /** Human-readable message safe to show in Discord. */
  message: string;
  /** Parsed reset time for rate limits, when the CLI output contained one. */
  resetsAt: Date | null;
}

const RATE_LIMIT_PATTERNS = [
  /usage limit/i,
  /rate limit/i,
  /limit reached/i,
  /out of (?:usage|quota)/i,
  /\b429\b/,
  /overloaded/i,
  /too many requests/i,
];

const AUTH_PATTERNS = [
  /invalid (?:api key|bearer token|oauth token)/i,
  /authentication[_ ]?(?:error|failed)/i,
  /\bunauthorized\b/i,
  /\b401\b/,
  /oauth token (?:has )?(?:expired|revoked)/i,
  /please run \/login/i,
  /credit balance is too low/i,
];

const ABORT_PATTERNS = [/\baborted\b/i, /\bcancell?ed\b/i];

/**
 * Extracts a reset time from CLI limit messages. Known shapes:
 *   "…limit reached ∙ resets 3am"
 *   "…resets at 15:00"
 *   "…resets 2026-07-03T15:00:00Z"
 * Times without a date are interpreted as the next future occurrence.
 */
export function parseResetTime(text: string, now: Date = new Date()): Date | null {
  const iso = text.match(/resets?(?:\s+at)?\s+(\d{4}-\d{2}-\d{2}T[\d:.]+Z?)/i);
  if (iso?.[1]) {
    const date = new Date(iso[1]);
    if (!Number.isNaN(date.getTime())) return date;
  }

  const clock = text.match(/resets?(?:\s+at)?\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i);
  if (clock?.[1]) {
    let hours = Number.parseInt(clock[1], 10);
    const minutes = clock[2] ? Number.parseInt(clock[2], 10) : 0;
    const meridiem = clock[3]?.toLowerCase();
    if (meridiem === "pm" && hours < 12) hours += 12;
    if (meridiem === "am" && hours === 12) hours = 0;
    if (hours > 23 || minutes > 59) return null;
    const candidate = new Date(now);
    candidate.setHours(hours, minutes, 0, 0);
    if (candidate.getTime() <= now.getTime()) {
      candidate.setDate(candidate.getDate() + 1);
    }
    return candidate;
  }

  return null;
}

/**
 * Classifies a failure from Agent SDK / Claude Code output. The CLI does not
 * expose typed errors for subscription limits, so this is deliberately
 * defensive text matching with a generic fallback.
 */
export function classifyFailure(text: string, now: Date = new Date()): ClassifiedError {
  if (RATE_LIMIT_PATTERNS.some((p) => p.test(text))) {
    const resetsAt = parseResetTime(text, now);
    const when = resetsAt ? ` It should reset around ${formatResetTime(resetsAt)}.` : "";
    return {
      kind: "rate_limit",
      message: `Claude's usage limit has been reached.${when} Please try again later.`,
      resetsAt,
    };
  }

  if (AUTH_PATTERNS.some((p) => p.test(text))) {
    return {
      kind: "auth",
      message:
        "Claude authentication failed. The operator needs to check the token — see the troubleshooting docs.",
      resetsAt: null,
    };
  }

  if (ABORT_PATTERNS.some((p) => p.test(text))) {
    return { kind: "aborted", message: "The run was cancelled.", resetsAt: null };
  }

  return {
    kind: "unknown",
    message: "Something went wrong while talking to Claude. Please try again.",
    resetsAt: null,
  };
}

export function formatResetTime(date: Date): string {
  return `<t:${Math.floor(date.getTime() / 1000)}:t>`;
}
