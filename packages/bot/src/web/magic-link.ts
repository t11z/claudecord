/**
 * Passwordless dashboard login: a slash-command interaction is an
 * authenticated channel (Discord tells us, verified, which user invoked it),
 * so `/dashboard` mints a signed, single-use, short-lived link instead of the
 * project asking for a password anywhere. See `discord/commands/dashboard.ts`
 * (mint) and `web/routes/auth.ts` (consume).
 */
import crypto from "node:crypto";

/** Discord-verified facts about the user at the moment `/dashboard` was run. */
export interface MagicLinkClaims {
  sub: string;
  username: string;
  globalName: string | null;
  avatarUrl: string | null;
  /** Whether the invoker held Manage Guild on the guild `/dashboard` was run in. */
  hasManageGuild: boolean;
}

interface TokenPayload extends MagicLinkClaims {
  exp: number;
  nonce: string;
}

const TTL_MS = 5 * 60 * 1000;

function hmac(secret: string, payload: string): string {
  return crypto.createHmac("sha256", secret).update(payload).digest("base64url");
}

/**
 * Issues and redeems magic links. Single-use is enforced with an in-memory
 * nonce set — a restart dropping pending (unredeemed) links is harmless at a
 * 5-minute TTL, and it avoids persisting single-use tokens anywhere.
 */
export class MagicLinkIssuer {
  private readonly usedNonces = new Map<string, number>(); // nonce -> expiry, for pruning

  constructor(
    private readonly secret: string,
    private readonly now: () => number = Date.now,
  ) {}

  mint(claims: MagicLinkClaims): string {
    this.prune();
    const payload: TokenPayload = {
      ...claims,
      exp: this.now() + TTL_MS,
      nonce: crypto.randomBytes(16).toString("base64url"),
    };
    const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
    return `${encoded}.${hmac(this.secret, encoded)}`;
  }

  /** Verifies, single-use-checks and consumes a token. Returns null if invalid, expired, tampered or already used. */
  consume(token: string): MagicLinkClaims | null {
    this.prune();
    const dot = token.lastIndexOf(".");
    if (dot <= 0) return null;
    const encoded = token.slice(0, dot);
    const signature = token.slice(dot + 1);
    const expected = hmac(this.secret, encoded);
    if (
      signature.length !== expected.length ||
      !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
    ) {
      return null;
    }

    let payload: TokenPayload;
    try {
      payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
    } catch {
      return null;
    }
    if (typeof payload.exp !== "number" || payload.exp <= this.now()) return null;
    if (typeof payload.nonce !== "string" || this.usedNonces.has(payload.nonce)) return null;

    this.usedNonces.set(payload.nonce, payload.exp);
    const { exp: _exp, nonce: _nonce, ...claims } = payload;
    return claims;
  }

  /** Drops nonce entries whose token has expired anyway — bounds memory. */
  private prune(): void {
    const now = this.now();
    for (const [nonce, exp] of this.usedNonces) {
      if (exp <= now) this.usedNonces.delete(nonce);
    }
  }
}
