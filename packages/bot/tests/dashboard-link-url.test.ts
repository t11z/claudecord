import { describe, expect, it } from "vitest";
import { publicUrl } from "../src/discord/commands/dashboard.js";
import { loadEnv } from "../src/env.js";

/**
 * `publicUrl` builds the base for the `/dashboard` sign-in link. A trailing
 * slash on `DASHBOARD_PUBLIC_URL` would produce `…//api/auth/link`, which
 * Hono does not match — the request falls through to `serveStatic` and
 * silently 200s with the SPA instead of logging anyone in.
 */
describe("publicUrl", () => {
  it("strips a single trailing slash", () => {
    const env = loadEnv({ DASHBOARD_PUBLIC_URL: "https://example.test/" });
    expect(publicUrl(env)).toBe("https://example.test");
  });

  it("strips multiple trailing slashes", () => {
    const env = loadEnv({ DASHBOARD_PUBLIC_URL: "https://example.test///" });
    expect(publicUrl(env)).toBe("https://example.test");
  });

  it("leaves a URL with no trailing slash unchanged", () => {
    const env = loadEnv({ DASHBOARD_PUBLIC_URL: "https://example.test" });
    expect(publicUrl(env)).toBe("https://example.test");
  });

  it("falls back to localhost:DASHBOARD_PORT when unset", () => {
    const env = loadEnv({ DASHBOARD_PORT: "4000" });
    expect(publicUrl(env)).toBe("http://localhost:4000");
  });
});
