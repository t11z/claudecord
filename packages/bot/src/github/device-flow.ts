/**
 * GitHub App OAuth **Device Flow**. Lets a Discord user authorize the bot to
 * act as them on GitHub without any public callback URL: the bot requests a
 * device code, shows the user a short code + verification URL, and polls until
 * they approve on github.com. This is the right fit for a bot whose dashboard
 * only binds to localhost.
 *
 * Mirrors the defensive style of `verify.ts`: GitHub's token endpoint answers
 * with `{ error: "authorization_pending" | "slow_down" | ... }` while the user
 * hasn't finished, so pending states are values, not exceptions — only terminal
 * failures throw.
 */

const DEVICE_CODE_URL = "https://github.com/login/device/code";
export const ACCESS_TOKEN_URL = "https://github.com/login/oauth/access_token";

export interface DeviceCodeResponse {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  /** Seconds until the device_code expires. */
  expiresIn: number;
  /** Minimum seconds the client must wait between poll attempts. */
  interval: number;
}

export interface UserTokens {
  accessToken: string;
  refreshToken?: string | undefined;
  /** ISO timestamp when accessToken expires, or null when it never expires. */
  expiresAt: string | null;
}

export class DeviceFlowError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = "DeviceFlowError";
  }
}

const JSON_HEADERS = {
  Accept: "application/json",
  "Content-Type": "application/json",
  "User-Agent": "claudecord",
};

interface TokenResponseBody {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
  interval?: number;
}

/** Converts GitHub's token JSON into our shape, stamping an absolute expiry. */
export function parseTokenResponse(data: TokenResponseBody, nowMs: number): UserTokens {
  return {
    accessToken: data.access_token as string,
    refreshToken: data.refresh_token,
    expiresAt: data.expires_in ? new Date(nowMs + data.expires_in * 1000).toISOString() : null,
  };
}

/** Step 1: ask GitHub for a device + user code. */
export async function requestDeviceCode(clientId: string): Promise<DeviceCodeResponse> {
  const res = await fetch(DEVICE_CODE_URL, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ client_id: clientId }),
  });
  const data = (await res.json().catch(() => ({}))) as {
    device_code?: string;
    user_code?: string;
    verification_uri?: string;
    expires_in?: number;
    interval?: number;
    error?: string;
    error_description?: string;
  };
  if (!res.ok || data.error || !data.device_code || !data.user_code || !data.verification_uri) {
    throw new DeviceFlowError(
      data.error_description ?? data.error ?? `GitHub returned HTTP ${res.status}.`,
      data.error ?? "invalid_response",
    );
  }
  return {
    deviceCode: data.device_code,
    userCode: data.user_code,
    verificationUri: data.verification_uri,
    expiresIn: data.expires_in ?? 900,
    interval: data.interval ?? 5,
  };
}

export type PollResult =
  | { kind: "pending" }
  | { kind: "slow_down"; interval: number }
  | { kind: "authorized"; tokens: UserTokens };

/**
 * A single poll of the token endpoint. `authorization_pending`/`slow_down` come
 * back as values so a poll loop can keep going; anything else (expired, denied)
 * throws a DeviceFlowError.
 */
export async function exchangeDeviceCode(
  clientId: string,
  deviceCode: string,
  now: () => number = Date.now,
): Promise<PollResult> {
  const res = await fetch(ACCESS_TOKEN_URL, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({
      client_id: clientId,
      device_code: deviceCode,
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
    }),
  });
  const data = (await res.json().catch(() => ({}))) as TokenResponseBody;

  if (data.access_token) return { kind: "authorized", tokens: parseTokenResponse(data, now()) };

  switch (data.error) {
    case "authorization_pending":
      return { kind: "pending" };
    case "slow_down":
      return { kind: "slow_down", interval: data.interval ?? 5 };
    default:
      throw new DeviceFlowError(
        data.error_description ?? data.error ?? `GitHub returned HTTP ${res.status}.`,
        data.error ?? "unknown",
      );
  }
}

export interface PollOptions {
  intervalSec: number;
  expiresInSec: number;
  signal?: AbortSignal | undefined;
  now?: (() => number) | undefined;
  sleep?: ((ms: number) => Promise<void>) | undefined;
}

/**
 * Step 2: poll until the user authorizes, the code expires, or the caller
 * aborts. Honours GitHub's `slow_down` by widening the interval.
 */
export async function pollForToken(
  clientId: string,
  deviceCode: string,
  opts: PollOptions,
): Promise<UserTokens> {
  const now = opts.now ?? Date.now;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const deadline = now() + opts.expiresInSec * 1000;
  let interval = opts.intervalSec;

  while (now() < deadline) {
    if (opts.signal?.aborted) throw new DeviceFlowError("Linking was cancelled.", "aborted");
    await sleep(interval * 1000);
    const result = await exchangeDeviceCode(clientId, deviceCode, now);
    if (result.kind === "authorized") return result.tokens;
    if (result.kind === "slow_down") interval = result.interval;
  }
  throw new DeviceFlowError(
    "The code expired before you authorized it. Please run /link-github again.",
    "expired_token",
  );
}
