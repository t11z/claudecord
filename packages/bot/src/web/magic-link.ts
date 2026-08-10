/**
 * Passwordless dashboard login: a slash-command interaction is an
 * authenticated channel (Discord tells us, verified, which user invoked it),
 * so `/dashboard` mints a signed, single-use, short-lived link instead of the
 * project asking for a password anywhere. See `discord/commands/dashboard.ts`
 * (mint) and `web/routes/auth.ts` (consume).
 *
 * The issuer is generic over its claims because the Discord OAuth login needs
 * exactly the same guarantees for its `state` parameter — signed, single-use,
 * short-lived — but knows nothing about the user at the moment it mints one.
 * Same crypto, same nonce set, different payload.
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

/** What every token carries on the wire regardless of its claims. */
interface Envelope {
  exp: number;
  nonce: string;
}

const TTL_MS = 5 * 60 * 1000;

function hmac(secret: string, payload: string): string {
  return crypto.createHmac("sha256", secret).update(payload).digest("base64url");
}

/** Strips the wire-only fields, leaving exactly the caller's claims. */
function toClaims<C>(payload: C & Envelope): C {
  const { exp: _exp, nonce: _nonce, ...claims } = payload;
  return claims as unknown as C;
}

/**
 * Issues and redeems magic links. Single-use is enforced with an in-memory
 * nonce set — a restart dropping pending (unredeemed) links is harmless at a
 * 5-minute TTL, and it avoids persisting single-use tokens anywhere.
 */
export class MagicLinkIssuer<C = MagicLinkClaims> {
  private readonly usedNonces = new Map<string, number>(); // nonce -> expiry, for pruning

  constructor(
    private readonly secret: string,
    private readonly now: () => number = Date.now,
  ) {}

  mint(claims: C): string {
    this.prune();
    const payload: C & Envelope = {
      ...claims,
      exp: this.now() + TTL_MS,
      nonce: crypto.randomBytes(16).toString("base64url"),
    };
    const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
    return `${encoded}.${hmac(this.secret, encoded)}`;
  }

  /**
   * Verifies a token *without* spending it — signature, expiry and
   * nonce-not-yet-used, but no marking. Exists so `GET /api/auth/link` can
   * render its interstitial (and say "expired" immediately when it can't)
   * without burning the single use — see `web/routes/auth.ts` for why a GET
   * must never consume.
   */
  peek(token: string): C | null {
    const payload = this.parse(token);
    return payload ? toClaims(payload) : null;
  }

  /** Verifies, single-use-checks and consumes a token. Returns null if invalid, expired, tampered or already used. */
  consume(token: string): C | null {
    const payload = this.parse(token);
    if (!payload) return null;
    this.usedNonces.set(payload.nonce, payload.exp);
    return toClaims(payload);
  }

  /**
   * Shared verification for `peek` and `consume`. Deliberately does not mark
   * the nonce used — that is `consume`'s one extra job, which is what keeps
   * `peek` from being a single-use bypass. Calls `prune` first like `consume`
   * always did; `prune` only drops nonces whose token has expired anyway, so
   * running it from this read path changes nothing observable.
   */
  private parse(token: string): (C & Envelope) | null {
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

    let payload: C & Envelope;
    try {
      payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
    } catch {
      return null;
    }
    if (typeof payload.exp !== "number" || payload.exp <= this.now()) return null;
    if (typeof payload.nonce !== "string" || this.usedNonces.has(payload.nonce)) return null;
    return payload;
  }

  /** Drops nonce entries whose token has expired anyway — bounds memory. */
  private prune(): void {
    const now = this.now();
    for (const [nonce, exp] of this.usedNonces) {
      if (exp <= now) this.usedNonces.delete(nonce);
    }
  }
}
