import { afterEach, describe, expect, it, vi } from "vitest";
import { applyGithubEnv } from "../src/claude/runner.js";
import { checkGithubToken } from "../src/github/verify.js";
import { resolveCredentials } from "../src/secrets.js";

describe("resolveCredentials — GitHub token", () => {
  it("prefers GITHUB_TOKEN over GH_TOKEN and the stored value", () => {
    const creds = resolveCredentials(
      { GITHUB_TOKEN: "env-primary", GH_TOKEN: "env-alias" },
      { githubToken: "stored" },
    );
    expect(creds.githubToken).toBe("env-primary");
  });

  it("falls back to GH_TOKEN, then to the stored token", () => {
    expect(resolveCredentials({ GH_TOKEN: "env-alias" }, {}).githubToken).toBe("env-alias");
    expect(resolveCredentials({}, { githubToken: "stored" }).githubToken).toBe("stored");
    expect(resolveCredentials({}, {}).githubToken).toBeUndefined();
  });
});

describe("applyGithubEnv", () => {
  it("sets gh env vars and an insteadOf git rewrite for github.com", () => {
    const env: Record<string, string | undefined> = {};
    applyGithubEnv(env, "ghp_secret");
    expect(env.GH_TOKEN).toBe("ghp_secret");
    expect(env.GITHUB_TOKEN).toBe("ghp_secret");
    expect(env.GIT_CONFIG_COUNT).toBe("1");
    expect(env.GIT_CONFIG_KEY_0).toBe(
      "url.https://x-access-token:ghp_secret@github.com/.insteadOf",
    );
    expect(env.GIT_CONFIG_VALUE_0).toBe("https://github.com/");
  });

  it("appends to a pre-existing GIT_CONFIG_COUNT without clobbering entries", () => {
    const env: Record<string, string | undefined> = {
      GIT_CONFIG_COUNT: "1",
      GIT_CONFIG_KEY_0: "user.name",
      GIT_CONFIG_VALUE_0: "existing",
    };
    applyGithubEnv(env, "tok");
    expect(env.GIT_CONFIG_COUNT).toBe("2");
    expect(env.GIT_CONFIG_KEY_0).toBe("user.name");
    expect(env.GIT_CONFIG_KEY_1).toBe("url.https://x-access-token:tok@github.com/.insteadOf");
  });
});

describe("checkGithubToken", () => {
  afterEach(() => vi.unstubAllGlobals());

  function stubFetch(opts: {
    status: number;
    headers?: Record<string, string>;
    jsonBody?: unknown;
  }) {
    const headers = new Headers(opts.headers ?? {});
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: opts.status >= 200 && opts.status < 300,
        status: opts.status,
        headers,
        json: async () => opts.jsonBody ?? {},
      })),
    );
  }

  it("reports the login and classic-PAT scopes on success", async () => {
    stubFetch({
      status: 200,
      headers: { "x-oauth-scopes": "repo, read:org" },
      jsonBody: { login: "octocat" },
    });
    const result = await checkGithubToken("ghp_x");
    expect(result.ok).toBe(true);
    expect(result.login).toBe("octocat");
    expect(result.message).toContain("octocat");
    expect(result.message).toContain("repo, read:org");
  });

  it("notes fine-grained tokens when no scopes header is present", async () => {
    stubFetch({ status: 200, jsonBody: { login: "octocat" } });
    const result = await checkGithubToken("github_pat_x");
    expect(result.ok).toBe(true);
    expect(result.message).toContain("fine-grained");
  });

  it("rejects a 401", async () => {
    stubFetch({ status: 401 });
    const result = await checkGithubToken("bad");
    expect(result.ok).toBe(false);
    expect(result.message).toContain("401");
  });

  it("stays ok (soft failure) when GitHub is unreachable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("ENOTFOUND");
      }),
    );
    const result = await checkGithubToken("tok");
    expect(result.ok).toBe(true);
    expect(result.message).toContain("couldn't be reached");
  });
});
