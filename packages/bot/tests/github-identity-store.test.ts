import { afterEach, describe, expect, it, vi } from "vitest";
import { GithubIdentityStore } from "../src/github/identity-store.js";
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
  const app = { clientId: "cid", clientSecret: "csecret" };
  const store = new GithubIdentityStore(
    secrets as unknown as SecretsStore,
    () => app,
    undefined,
    now,
  );
  return { store, secrets };
}

function jsonResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(),
    json: async () => body,
  };
}

afterEach(() => vi.unstubAllGlobals());

describe("GithubIdentityStore", () => {
  it("links an identity, resolving the login, and persists the token in secrets", async () => {
    // checkGithubToken → GET /user
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(200, { login: "octocat" })),
    );
    const { store, secrets } = makeStore();

    const summary = await store.link("discord-1", {
      accessToken: "gho_1",
      refreshToken: "ghr_1",
      expiresAt: null,
    });

    expect(summary.login).toBe("octocat");
    expect(store.get("discord-1")?.accessToken).toBe("gho_1");
    expect(secrets.get().githubIdentities?.["discord-1"]?.login).toBe("octocat");
  });

  it("returns the stored token unchanged when it is not expiring", async () => {
    const { store, secrets } = makeStore(() => 1000);
    secrets.update({
      githubIdentities: {
        u: {
          accessToken: "gho_valid",
          refreshToken: "ghr",
          expiresAt: new Date(1000 + 60 * 60 * 1000).toISOString(),
          linkedAt: "x",
        },
      },
    });
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    expect(await store.getFreshToken("u")).toBe("gho_valid");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("refreshes an expired token and writes the rotated pair back", async () => {
    const now = 2_000_000;
    const { store, secrets } = makeStore(() => now);
    secrets.update({
      githubIdentities: {
        u: {
          accessToken: "gho_old",
          refreshToken: "ghr_old",
          expiresAt: new Date(now - 1000).toISOString(), // already expired
          linkedAt: "x",
        },
      },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse(200, {
          access_token: "gho_new",
          refresh_token: "ghr_new",
          expires_in: 28800,
        }),
      ),
    );

    expect(await store.getFreshToken("u")).toBe("gho_new");
    expect(secrets.get().githubIdentities?.u?.accessToken).toBe("gho_new");
    expect(secrets.get().githubIdentities?.u?.refreshToken).toBe("ghr_new");
  });

  it("returns null (and doesn't crash) when a refresh fails", async () => {
    const now = 3_000_000;
    const { store, secrets } = makeStore(() => now);
    secrets.update({
      githubIdentities: {
        u: {
          accessToken: "gho_old",
          refreshToken: "ghr_old",
          expiresAt: new Date(now - 1000).toISOString(),
          linkedAt: "x",
        },
      },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(400, { error: "bad_refresh_token" })),
    );
    expect(await store.getFreshToken("u")).toBeNull();
  });

  it("returns null for an unknown user", async () => {
    const { store } = makeStore();
    expect(await store.getFreshToken("nobody")).toBeNull();
  });

  it("unlinks and lists safe summaries only", async () => {
    const { store, secrets } = makeStore();
    secrets.update({
      githubIdentities: {
        a: { accessToken: "t", expiresAt: null, login: "alice", linkedAt: "2026-01-01" },
      },
    });
    const list = store.list();
    expect(list).toEqual([
      { discordUserId: "a", login: "alice", linkedAt: "2026-01-01", expiresAt: null },
    ]);
    // biome-ignore lint/suspicious/noExplicitAny: assert the token isn't leaked into the summary
    expect((list[0] as any).accessToken).toBeUndefined();

    expect(store.unlink("a")).toBe(true);
    expect(store.get("a")).toBeUndefined();
    expect(store.unlink("a")).toBe(false);
  });
});
