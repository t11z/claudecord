import type { Hono } from "hono";
import type { AppContext } from "../../context.js";
import type { IdentityGraphDto, IdentityGraphRowDto } from "../../types.js";

/**
 * Every user with at least one linked identity, joined to their dashboard
 * profile for display — the data behind the admin "Verknüpfungen" view.
 *
 * Deliberately not named `/api/identities`: that would read as the parent of
 * the existing `/api/claude/identities` and `/api/github/identities`, which it
 * isn't. Those stay — `Setup.tsx` and the admin unlink actions sit on them.
 *
 * The user set is the union of both stores, the same way `unresolvedProfiles`
 * in `routes/migrate.ts` builds it. A user linked purely through Discord has no
 * dashboard row yet, so every display field is nullable and the frontend falls
 * back to the id. Tokens are never projected: both stores' `list()` return
 * summaries that omit them.
 */
export function identityGraphRoutes(app: Hono, ctx: AppContext): void {
  app.get("/api/identity-graph", (c) => {
    const claude = new Map(ctx.claude.list().map((i) => [i.discordUserId, i]));
    const github = new Map(ctx.github.list().map((i) => [i.discordUserId, i]));

    const rows: IdentityGraphRowDto[] = [...new Set([...claude.keys(), ...github.keys()])]
      .map((discordUserId) => {
        const profile = ctx.repos.dashboardUsers.get(discordUserId);
        const c1 = claude.get(discordUserId);
        const g1 = github.get(discordUserId);
        return {
          discordUserId,
          username: profile?.username ?? null,
          globalName: profile?.globalName ?? null,
          avatarUrl: profile?.avatarUrl ?? null,
          claude: {
            linked: !!c1,
            linkedAt: c1?.linkedAt ?? null,
            lastVerifiedAt: c1?.lastVerifiedAt ?? null,
          },
          github: {
            linked: !!g1,
            login: g1?.login ?? null,
            linkedAt: g1?.linkedAt ?? null,
          },
        };
      })
      // Stable, human-meaningful order: by display name, ids last.
      .sort((a, b) =>
        (a.globalName ?? a.username ?? a.discordUserId).localeCompare(
          b.globalName ?? b.username ?? b.discordUserId,
        ),
      );

    const dto: IdentityGraphDto = { rows };
    return c.json(dto);
  });
}
