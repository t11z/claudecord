import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DeviceFlowError,
  exchangeDeviceCode,
  parseTokenResponse,
  pollForToken,
  requestDeviceCode,
} from "../src/github/device-flow.js";

function jsonResponse(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

function stubFetchOnce(status: number, body: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => jsonResponse(status, body)),
  );
}

/** A fetch that returns each queued response in turn. */
function stubFetchQueue(responses: ReturnType<typeof jsonResponse>[]) {
  const queue = [...responses];
  const fn = vi.fn(
    async () => queue.shift() ?? jsonResponse(200, { error: "authorization_pending" }),
  );
  vi.stubGlobal("fetch", fn);
  return fn;
}

afterEach(() => vi.unstubAllGlobals());

describe("requestDeviceCode", () => {
  it("returns the device + user code on success", async () => {
    stubFetchOnce(200, {
      device_code: "dev123",
      user_code: "WXYZ-1234",
      verification_uri: "https://github.com/login/device",
      expires_in: 900,
      interval: 5,
    });
    const res = await requestDeviceCode("client-abc");
    expect(res.deviceCode).toBe("dev123");
    expect(res.userCode).toBe("WXYZ-1234");
    expect(res.verificationUri).toContain("github.com");
    expect(res.interval).toBe(5);
  });

  it("throws a DeviceFlowError when GitHub returns an error", async () => {
    stubFetchOnce(200, { error: "invalid_client", error_description: "bad client id" });
    await expect(requestDeviceCode("nope")).rejects.toBeInstanceOf(DeviceFlowError);
  });
});

describe("parseTokenResponse", () => {
  it("computes an absolute expiry from expires_in", () => {
    const tokens = parseTokenResponse(
      { access_token: "t", refresh_token: "r", expires_in: 3600 },
      1_000_000,
    );
    expect(tokens.accessToken).toBe("t");
    expect(tokens.refreshToken).toBe("r");
    expect(tokens.expiresAt).toBe(new Date(1_000_000 + 3_600_000).toISOString());
  });

  it("leaves expiresAt null when the token never expires", () => {
    expect(parseTokenResponse({ access_token: "t" }, 0).expiresAt).toBeNull();
  });
});

describe("exchangeDeviceCode", () => {
  it("returns authorized with tokens when the user approved", async () => {
    stubFetchOnce(200, { access_token: "gho_x", expires_in: 28800 });
    const result = await exchangeDeviceCode("c", "dev", () => 0);
    expect(result.kind).toBe("authorized");
    if (result.kind === "authorized") expect(result.tokens.accessToken).toBe("gho_x");
  });

  it("reports pending while the user hasn't finished", async () => {
    stubFetchOnce(200, { error: "authorization_pending" });
    expect((await exchangeDeviceCode("c", "dev")).kind).toBe("pending");
  });

  it("reports slow_down with the new interval", async () => {
    stubFetchOnce(200, { error: "slow_down", interval: 10 });
    const result = await exchangeDeviceCode("c", "dev");
    expect(result).toEqual({ kind: "slow_down", interval: 10 });
  });

  it("throws on terminal errors like access_denied", async () => {
    stubFetchOnce(200, { error: "access_denied" });
    await expect(exchangeDeviceCode("c", "dev")).rejects.toMatchObject({ code: "access_denied" });
  });
});

describe("pollForToken", () => {
  it("polls until the user authorizes", async () => {
    stubFetchQueue([
      jsonResponse(200, { error: "authorization_pending" }),
      jsonResponse(200, { error: "slow_down", interval: 7 }),
      jsonResponse(200, { access_token: "gho_final", expires_in: 28800 }),
    ]);
    let clock = 0;
    const tokens = await pollForToken("c", "dev", {
      intervalSec: 5,
      expiresInSec: 900,
      now: () => clock,
      sleep: async (ms) => {
        clock += ms;
      },
    });
    expect(tokens.accessToken).toBe("gho_final");
  });

  it("throws expired_token when the deadline passes", async () => {
    stubFetchQueue([]); // always pending
    let clock = 0;
    await expect(
      pollForToken("c", "dev", {
        intervalSec: 5,
        expiresInSec: 10,
        now: () => clock,
        sleep: async (ms) => {
          clock += ms;
        },
      }),
    ).rejects.toMatchObject({ code: "expired_token" });
  });

  it("aborts immediately when the signal is already aborted", async () => {
    stubFetchQueue([]);
    await expect(
      pollForToken("c", "dev", {
        intervalSec: 5,
        expiresInSec: 900,
        signal: { aborted: true } as AbortSignal,
        now: () => 0,
        sleep: async () => {},
      }),
    ).rejects.toMatchObject({ code: "aborted" });
  });
});
