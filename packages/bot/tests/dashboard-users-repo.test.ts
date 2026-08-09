import { describe, expect, it } from "vitest";
import { openMemoryDatabase } from "../src/db/database.js";
import { DashboardUsersRepo } from "../src/db/repos/dashboard-users.js";

describe("DashboardUsersRepo", () => {
  it("upserts a login, creating the row with both timestamps set", () => {
    const repo = new DashboardUsersRepo(openMemoryDatabase());
    repo.upsertLogin({
      discordUserId: "u1",
      username: "alice",
      globalName: "Alice",
      avatarUrl: "https://example/a.png",
      isAdmin: false,
      now: "2026-01-01T00:00:00.000Z",
    });
    const user = repo.get("u1");
    expect(user).toEqual({
      discordUserId: "u1",
      username: "alice",
      globalName: "Alice",
      avatarUrl: "https://example/a.png",
      isAdmin: false,
      githubSkipped: false,
      firstLoginAt: "2026-01-01T00:00:00.000Z",
      lastLoginAt: "2026-01-01T00:00:00.000Z",
    });
  });

  it("a second login updates profile/role/lastLoginAt but never firstLoginAt", () => {
    const repo = new DashboardUsersRepo(openMemoryDatabase());
    repo.upsertLogin({
      discordUserId: "u1",
      username: "alice",
      globalName: "Alice",
      avatarUrl: null,
      isAdmin: false,
      now: "2026-01-01T00:00:00.000Z",
    });
    repo.upsertLogin({
      discordUserId: "u1",
      username: "alice2",
      globalName: "Alice Two",
      avatarUrl: "https://example/a2.png",
      isAdmin: true,
      now: "2026-02-01T00:00:00.000Z",
    });
    const user = repo.get("u1");
    expect(user?.username).toBe("alice2");
    expect(user?.isAdmin).toBe(true);
    expect(user?.firstLoginAt).toBe("2026-01-01T00:00:00.000Z");
    expect(user?.lastLoginAt).toBe("2026-02-01T00:00:00.000Z");
  });

  it("anyAdmin reflects whether any row currently holds admin", () => {
    const repo = new DashboardUsersRepo(openMemoryDatabase());
    expect(repo.anyAdmin()).toBe(false);
    repo.upsertLogin({
      discordUserId: "u1",
      username: "alice",
      globalName: null,
      avatarUrl: null,
      isAdmin: false,
      now: "2026-01-01T00:00:00.000Z",
    });
    expect(repo.anyAdmin()).toBe(false);
    repo.upsertLogin({
      discordUserId: "u2",
      username: "bob",
      globalName: null,
      avatarUrl: null,
      isAdmin: true,
      now: "2026-01-01T00:00:00.000Z",
    });
    expect(repo.anyAdmin()).toBe(true);
  });

  it("get returns undefined for an unknown user; list orders by first login", () => {
    const repo = new DashboardUsersRepo(openMemoryDatabase());
    expect(repo.get("nobody")).toBeUndefined();
    repo.upsertLogin({
      discordUserId: "later",
      username: "b",
      globalName: null,
      avatarUrl: null,
      isAdmin: false,
      now: "2026-02-01T00:00:00.000Z",
    });
    repo.upsertLogin({
      discordUserId: "earlier",
      username: "a",
      globalName: null,
      avatarUrl: null,
      isAdmin: false,
      now: "2026-01-01T00:00:00.000Z",
    });
    expect(repo.list().map((u) => u.discordUserId)).toEqual(["earlier", "later"]);
  });

  it("setGithubSkipped toggles the flag", () => {
    const repo = new DashboardUsersRepo(openMemoryDatabase());
    repo.upsertLogin({
      discordUserId: "u1",
      username: "alice",
      globalName: null,
      avatarUrl: null,
      isAdmin: false,
      now: "2026-01-01T00:00:00.000Z",
    });
    expect(repo.get("u1")?.githubSkipped).toBe(false);
    repo.setGithubSkipped("u1", true);
    expect(repo.get("u1")?.githubSkipped).toBe(true);
    repo.setGithubSkipped("u1", false);
    expect(repo.get("u1")?.githubSkipped).toBe(false);
  });
});
