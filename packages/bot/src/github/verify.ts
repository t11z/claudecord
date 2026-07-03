/**
 * Best-effort validation of a GitHub token against the REST API. Mirrors the
 * Claude auth check: give the operator immediate, concrete feedback in the
 * setup wizard — including which scopes the token actually carries, which is
 * the number-one source of "why can't the bot see my repo" confusion.
 */
export interface GithubCheckResult {
  ok: boolean;
  message: string;
  login?: string;
}

const API_USER = "https://api.github.com/user";

export async function checkGithubToken(token: string): Promise<GithubCheckResult> {
  let res: Response;
  try {
    res = await fetch(API_USER, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "claudecord",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });
  } catch (err) {
    // Network sandboxes may block outbound HTTPS — don't reject a token we
    // simply couldn't reach GitHub to test. Store it, flag the uncertainty.
    return {
      ok: true,
      message: `Token stored, but GitHub couldn't be reached to verify it (${
        err instanceof Error ? err.message : String(err)
      }).`,
    };
  }

  if (res.status === 401) {
    return { ok: false, message: "GitHub rejected the token (401). Check that it hasn't expired." };
  }
  if (res.status === 403) {
    return {
      ok: false,
      message: "GitHub returned 403 — the token is likely missing scopes or is rate limited.",
    };
  }
  if (!res.ok) {
    return { ok: false, message: `GitHub returned HTTP ${res.status}.` };
  }

  const user = (await res.json().catch(() => ({}))) as { login?: string };
  // Classic PATs expose their scopes in this header; fine-grained tokens send
  // it empty (their permissions aren't representable as OAuth scopes).
  const scopes = res.headers.get("x-oauth-scopes")?.trim();
  const scopeNote = scopes
    ? `scopes: ${scopes}`
    : "fine-grained token — verify its repository & permission grants on GitHub";
  return {
    ok: true,
    login: user.login,
    message: `Authenticated as ${user.login ?? "unknown"} (${scopeNote}).`,
  };
}
