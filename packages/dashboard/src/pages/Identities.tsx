import { useEffect, useState } from "preact/hooks";
import { api, type IdentityGraphRowDto, type MeDto } from "../api.ts";
import { Card } from "../components.tsx";
import { IdentityGraph } from "../IdentityGraph.tsx";

function displayName(row: IdentityGraphRowDto): string {
  return row.globalName ?? row.username ?? row.discordUserId;
}

/**
 * Who has linked what, instance-wide. Also the only place an admin sees their
 * *own* graph: main.tsx routes admins straight into AdminApp, so Account.tsx —
 * where members see theirs — is never rendered for them.
 *
 * One row per user rather than a single combined graph: with more than a handful
 * of users a single fan-out is unreadable, and the interesting question is
 * per-person anyway.
 */
export function Identities() {
  const [rows, setRows] = useState<IdentityGraphRowDto[] | null>(null);
  const [me, setMe] = useState<MeDto | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .identityGraph()
      .then((d) => setRows(d.rows))
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
    // An admin is a member too; this is their own row, always shown even when
    // they've linked nothing (so it can't be absent from the list below).
    api
      .me()
      .then(setMe)
      .catch(() => {});
  }, []);

  return (
    <>
      <h1>Linked accounts</h1>
      <p class="muted">
        Linking and unlinking happen in Discord — <code>/link-claude link</code> and{" "}
        <code>/link-github link</code> — or from a member's own account page. This is the view.
      </p>

      {me ? (
        <Card title="You">
          <IdentityGraph
            discord={{
              name: me.user.globalName ?? me.user.username ?? me.user.id,
              avatarUrl: me.user.avatarUrl,
            }}
            claude={{ linked: me.claude.linked, linkedAt: me.claude.linkedAt }}
            github={{ linked: me.github.linked, login: me.github.login, linkedAt: null }}
            githubBlockedReason={me.github.linkBlockedReason}
          />
        </Card>
      ) : null}

      <Card title="Everyone with a linked identity">
        {error ? <p class="error-detail">{error}</p> : null}
        {rows === null && !error ? <p class="muted">Loading…</p> : null}
        {rows !== null && rows.length === 0 ? (
          <p class="muted">Nobody has linked anything yet.</p>
        ) : null}
        {rows?.map((row) => (
          <IdentityGraph
            key={row.discordUserId}
            compact
            discord={{ name: displayName(row), avatarUrl: row.avatarUrl }}
            claude={{ linked: row.claude.linked, linkedAt: row.claude.linkedAt }}
            github={{
              linked: row.github.linked,
              login: row.github.login,
              linkedAt: row.github.linkedAt,
            }}
          />
        ))}
      </Card>
    </>
  );
}
