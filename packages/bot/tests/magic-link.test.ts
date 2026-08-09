import { describe, expect, it } from "vitest";
import { MagicLinkIssuer } from "../src/web/magic-link.js";

const CLAIMS = {
  sub: "discord-1",
  username: "alice",
  globalName: "Alice",
  avatarUrl: null,
  hasManageGuild: true,
};

describe("MagicLinkIssuer", () => {
  it("mints a token that consumes back to the original claims", () => {
    const issuer = new MagicLinkIssuer("secret");
    const token = issuer.mint(CLAIMS);
    expect(issuer.consume(token)).toEqual(CLAIMS);
  });

  it("is single-use: the same token cannot be consumed twice", () => {
    const issuer = new MagicLinkIssuer("secret");
    const token = issuer.mint(CLAIMS);
    expect(issuer.consume(token)).toEqual(CLAIMS);
    expect(issuer.consume(token)).toBeNull();
  });

  it("rejects an expired token", () => {
    let now = 1_000_000;
    const issuer = new MagicLinkIssuer("secret", () => now);
    const token = issuer.mint(CLAIMS);
    now += 6 * 60 * 1000; // past the 5-minute TTL
    expect(issuer.consume(token)).toBeNull();
  });

  it("rejects a token signed with a different secret", () => {
    const issuer = new MagicLinkIssuer("secret-a");
    const token = issuer.mint(CLAIMS);
    const other = new MagicLinkIssuer("secret-b");
    expect(other.consume(token)).toBeNull();
  });

  it("rejects a tampered payload", () => {
    const issuer = new MagicLinkIssuer("secret");
    const token = issuer.mint(CLAIMS);
    const dot = token.lastIndexOf(".");
    const tampered = `${token.slice(0, dot - 1)}x${token.slice(dot - 1)}`;
    expect(issuer.consume(tampered)).toBeNull();
  });

  it("rejects malformed tokens without throwing", () => {
    const issuer = new MagicLinkIssuer("secret");
    expect(issuer.consume("not-a-token")).toBeNull();
    expect(issuer.consume("")).toBeNull();
    expect(issuer.consume("no-dot-here")).toBeNull();
  });
});

describe("MagicLinkIssuer.peek", () => {
  it("verifies without consuming — repeated peeks all succeed", () => {
    const issuer = new MagicLinkIssuer("secret");
    const token = issuer.mint(CLAIMS);
    expect(issuer.peek(token)).toEqual(CLAIMS);
    expect(issuer.peek(token)).toEqual(CLAIMS);
    expect(issuer.consume(token)).toEqual(CLAIMS);
    expect(issuer.consume(token)).toBeNull();
  });

  it("reports null for a token already spent by consume", () => {
    const issuer = new MagicLinkIssuer("secret");
    const token = issuer.mint(CLAIMS);
    expect(issuer.consume(token)).toEqual(CLAIMS);
    expect(issuer.peek(token)).toBeNull();
  });

  it("rejects expired, tampered and malformed tokens, same as consume", () => {
    let now = 1_000_000;
    const issuer = new MagicLinkIssuer("secret", () => now);
    const token = issuer.mint(CLAIMS);
    now += 6 * 60 * 1000; // past the 5-minute TTL
    expect(issuer.peek(token)).toBeNull();

    const fresh = new MagicLinkIssuer("secret");
    const freshToken = fresh.mint(CLAIMS);
    const dot = freshToken.lastIndexOf(".");
    const tampered = `${freshToken.slice(0, dot - 1)}x${freshToken.slice(dot - 1)}`;
    expect(fresh.peek(tampered)).toBeNull();
    expect(fresh.peek("not-a-token")).toBeNull();
  });
});
