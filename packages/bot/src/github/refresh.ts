/**
 * Refreshes an expiring GitHub App user-to-server token. GitHub App user tokens
 * live ~8 hours (when the App has token expiration enabled) and come with a
 * ~6-month refresh token; this exchanges the refresh token for a fresh pair.
 */
import {
  ACCESS_TOKEN_URL,
  DeviceFlowError,
  parseTokenResponse,
  type UserTokens,
} from "./device-flow.js";

export async function refreshUserToken(
  clientId: string,
  clientSecret: string,
  refreshToken: string,
  now: () => number = Date.now,
): Promise<UserTokens> {
  const res = await fetch(ACCESS_TOKEN_URL, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "User-Agent": "claudecord",
    },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
  });
  const data = (await res.json().catch(() => ({}))) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    error?: string;
    error_description?: string;
  };
  if (!data.access_token) {
    throw new DeviceFlowError(
      data.error_description ?? data.error ?? `GitHub returned HTTP ${res.status}.`,
      data.error ?? "refresh_failed",
    );
  }
  return parseTokenResponse(data, now());
}

/**
 * Best-effort revocation of a user token when someone unlinks. Never throws —
 * a network sandbox or already-expired token shouldn't block the local unlink.
 * Returns whether GitHub confirmed the revocation.
 */
export async function revokeUserToken(
  clientId: string,
  clientSecret: string,
  accessToken: string,
): Promise<boolean> {
  try {
    const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
    const res = await fetch(`https://api.github.com/applications/${clientId}/token`, {
      method: "DELETE",
      headers: {
        Authorization: `Basic ${basic}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
        "User-Agent": "claudecord",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      body: JSON.stringify({ access_token: accessToken }),
    });
    return res.status === 204;
  } catch {
    return false;
  }
}
