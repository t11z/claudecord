import { describe, expect, it } from "vitest";
import { ClaudeIdentityStore } from "../src/claude/identity-store.js";
import type { SecretsStore, StoredSecrets } from "../src/secrets.js";

/** In-memory stand-in for the file-backed SecretsStore. */
class FakeSecrets {
  private data: StoredSecrets = {};
  get(): StoredSecrets {
    return this.data;
  }
  update(patch: Partial<StoredSecrets>): void {
    this.data = { ...this.data, ...patch };
  }
}

function makeStore(now = () => 1_000_000_000_000) {
  const secrets = new FakeSecrets();
  const store = new ClaudeIdentityStore(secrets as unknown as SecretsStore, now);
  return { store, secrets };
}

describe("ClaudeIdentityStore", () => {
  it("links an identity and persists the token in secrets", () => {
    const { store, secrets } = makeStore();

    const summary = store.link("discord-1", "sk-ant-oat01-xyz");

    expect(summary.discordUserId).toBe("discord-1");
    expect(summary.linkedAt).toBe(new Date(1_000_000_000_000).toISOString());
    expect(summary.lastVerifiedAt).toBe(summary.linkedAt);
    expect(store.getToken("discord-1")).toBe("sk-ant-oat01-xyz");
    expect(secrets.get().claudeIdentities?.["discord-1"]?.oauthToken).toBe("sk-ant-oat01-xyz");
  });

  it("relinking replaces the previous token", () => {
    const { store } = makeStore();
    store.link("u", "old-token");
    store.link("u", "new-token");
    expect(store.getToken("u")).toBe("new-token");
  });

  it("returns null for an unknown user", () => {
    const { store } = makeStore();
    expect(store.getToken("nobody")).toBeNull();
  });

  it("markVerified updates lastVerifiedAt without touching the token", () => {
    let now = 1000;
    const { store, secrets } = makeStore(() => now);
    store.link("u", "tok");
    now = 5000;
    store.markVerified("u");
    expect(secrets.get().claudeIdentities?.u?.oauthToken).toBe("tok");
    expect(secrets.get().claudeIdentities?.u?.lastVerifiedAt).toBe(new Date(5000).toISOString());
  });

  it("markVerified is a no-op for an unknown user", () => {
    const { store, secrets } = makeStore();
    store.markVerified("nobody");
    expect(secrets.get().claudeIdentities).toBeUndefined();
  });

  it("unlinks and lists safe summaries only", () => {
    const { store, secrets } = makeStore();
    secrets.update({
      claudeIdentities: {
        a: { oauthToken: "t", linkedAt: "2026-01-01", lastVerifiedAt: null },
      },
    });
    const list = store.list();
    expect(list).toEqual([{ discordUserId: "a", linkedAt: "2026-01-01", lastVerifiedAt: null }]);
    // biome-ignore lint/suspicious/noExplicitAny: assert the token isn't leaked into the summary
    expect((list[0] as any).oauthToken).toBeUndefined();

    expect(store.unlink("a")).toBe(true);
    expect(store.get("a")).toBeUndefined();
    expect(store.unlink("a")).toBe(false);
  });
});
