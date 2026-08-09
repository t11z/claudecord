import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { openMemoryDatabase } from "../src/db/database.js";
import { AppConfigRepo } from "../src/db/repos/app-config.js";
import { DashboardAuth } from "../src/web/auth.js";
import { requireAdmin, requireUser } from "../src/web/middleware.js";

function makeAuth(now?: () => number): DashboardAuth {
  const db = openMemoryDatabase();
  return new DashboardAuth(new AppConfigRepo(db), now);
}

/** Pulls just the `name=value` pair off a Set-Cookie header for reuse as a request Cookie header. */
function cookiePair(res: Response): string {
  const raw = res.headers.get("set-cookie");
  if (!raw) throw new Error("no set-cookie header in response");
  return raw.split(";")[0]!;
}

describe("DashboardAuth session cookie", () => {
  it("round-trips a session through issueCookie/getSession", async () => {
    const auth = makeAuth();
    const app = new Hono();
    app.get("/set", (c) => {
      auth.issueCookie(c, { sub: "u1", isAdmin: true });
      return c.text("ok");
    });
    app.get("/check", (c) => c.json(auth.getSession(c)));

    const setRes = await app.request("/set");
    const cookie = cookiePair(setRes);
    const checkRes = await app.request("/check", { headers: { Cookie: cookie } });
    expect(await checkRes.json()).toEqual({ sub: "u1", isAdmin: true });
  });

  it("returns null with no cookie at all", async () => {
    const auth = makeAuth();
    const app = new Hono();
    app.get("/check", (c) => c.json(auth.getSession(c)));
    const res = await app.request("/check");
    expect(await res.json()).toBeNull();
  });

  it("rejects a tampered cookie", async () => {
    const auth = makeAuth();
    const app = new Hono();
    app.get("/set", (c) => {
      auth.issueCookie(c, { sub: "u1", isAdmin: true });
      return c.text("ok");
    });
    app.get("/check", (c) => c.json(auth.getSession(c)));

    const cookie = cookiePair(await app.request("/set"));
    const [name, value] = cookie.split("=");
    const tampered = `${name}=${value!.slice(0, -1)}x`;
    const res = await app.request("/check", { headers: { Cookie: tampered } });
    expect(await res.json()).toBeNull();
  });

  it("rejects an expired session", async () => {
    let now = 1_000_000;
    const auth = makeAuth(() => now);
    const app = new Hono();
    app.get("/set", (c) => {
      auth.issueCookie(c, { sub: "u1", isAdmin: false });
      return c.text("ok");
    });
    app.get("/check", (c) => c.json(auth.getSession(c)));

    const cookie = cookiePair(await app.request("/set"));
    now += 31 * 24 * 60 * 60 * 1000; // past the 30-day rolling TTL
    const res = await app.request("/check", { headers: { Cookie: cookie } });
    expect(await res.json()).toBeNull();
  });

  it("clearCookie removes the session", async () => {
    const auth = makeAuth();
    const app = new Hono();
    app.get("/set", (c) => {
      auth.issueCookie(c, { sub: "u1", isAdmin: true });
      return c.text("ok");
    });
    app.get("/clear", (c) => {
      auth.clearCookie(c);
      return c.text("ok");
    });
    app.get("/check", (c) => c.json(auth.getSession(c)));

    const cookie = cookiePair(await app.request("/set"));
    const clearRes = await app.request("/clear", { headers: { Cookie: cookie } });
    const cleared = cookiePair(clearRes);
    const res = await app.request("/check", { headers: { Cookie: cleared } });
    expect(await res.json()).toBeNull();
  });
});

describe("requireUser / requireAdmin", () => {
  function appWithGates(auth: DashboardAuth) {
    const app = new Hono();
    app.get("/set/:role", (c) => {
      auth.issueCookie(c, { sub: "u1", isAdmin: c.req.param("role") === "admin" });
      return c.text("ok");
    });
    app.get("/user-only", requireUser(auth), (c) => c.text("user ok"));
    app.get("/admin-only", requireAdmin(auth), (c) => c.text("admin ok"));
    return app;
  }

  it("401s both gates with no session", async () => {
    const app = appWithGates(makeAuth());
    expect((await app.request("/user-only")).status).toBe(401);
    expect((await app.request("/admin-only")).status).toBe(401);
  });

  it("a plain user session passes requireUser but is 403'd by requireAdmin", async () => {
    const auth = makeAuth();
    const app = appWithGates(auth);
    const cookie = cookiePair(await app.request("/set/user"));

    const userRes = await app.request("/user-only", { headers: { Cookie: cookie } });
    expect(userRes.status).toBe(200);

    const adminRes = await app.request("/admin-only", { headers: { Cookie: cookie } });
    expect(adminRes.status).toBe(403);
  });

  it("an admin session passes both gates", async () => {
    const auth = makeAuth();
    const app = appWithGates(auth);
    const cookie = cookiePair(await app.request("/set/admin"));

    expect((await app.request("/user-only", { headers: { Cookie: cookie } })).status).toBe(200);
    expect((await app.request("/admin-only", { headers: { Cookie: cookie } })).status).toBe(200);
  });
});
