import { useEffect, useState } from "preact/hooks";
import { api, type StatsDto } from "../api.ts";
import { Badge, Card, Sparkline, Stat } from "../components.tsx";

const fmt = (n: number) => n.toLocaleString("en-US");

// Map a classified error kind to a badge tone. Anything unrecognised (incl.
// null / "unknown") reads as danger so it stands out for investigation.
function errorTone(kind: string | null): "warn" | "danger" | "info" {
  if (kind === "rate_limit" || kind === "budget" || kind === "max_turns" || kind === "network")
    return "warn";
  if (kind === "aborted") return "info";
  return "danger";
}

export function Usage() {
  const [windowDays, setWindowDays] = useState(30);
  const [stats, setStats] = useState<StatsDto | null>(null);

  useEffect(() => {
    setStats(null);
    api
      .stats(windowDays)
      .then(setStats)
      .catch(() => {});
  }, [windowDays]);

  return (
    <>
      <h1>Usage</h1>
      <Card>
        <label class="field" style="max-width:200px">
          <span>Window</span>
          <select
            value={String(windowDays)}
            onChange={(e) => setWindowDays(Number((e.target as HTMLSelectElement).value))}
          >
            <option value="7">Last 7 days</option>
            <option value="30">Last 30 days</option>
            <option value="90">Last 90 days</option>
          </select>
        </label>
      </Card>

      {!stats ? (
        <Card>Loading…</Card>
      ) : (
        <>
          <div class="grid">
            <Stat label="Runs" value={fmt(stats.totalRuns)} />
            <Stat label="Errors" value={fmt(stats.totalErrors)} />
            <Stat
              label="Tokens in / out"
              value={`${fmt(stats.totalInputTokens)} / ${fmt(stats.totalOutputTokens)}`}
            />
            <Stat label="Est. cost" value={`$${stats.totalCostUsd.toFixed(2)}`} />
          </div>

          <Card title="Daily runs">
            <Sparkline values={stats.daily.map((d) => d.runs)} />
            <p class="muted">
              {stats.daily.length} active day(s) in the window.
              {stats.lastRateLimitAt
                ? ` Last rate limit: ${new Date(stats.lastRateLimitAt).toLocaleString()}.`
                : " No rate limits hit."}{" "}
              Cost is informational — with OAuth subscription auth there is no per-token bill.
            </p>
          </Card>

          <Card title="Top servers">
            {stats.topGuilds.length === 0 ? (
              <p class="muted">No activity yet.</p>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>Server</th>
                    <th>Runs</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.topGuilds.map((g) => (
                    <tr key={g.guildId}>
                      <td>{g.guildName ?? g.guildId}</td>
                      <td>{fmt(g.runs)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>

          <Card title="Recent errors">
            {stats.recentErrors.length === 0 ? (
              <p class="muted">No errors in this window. 🎉</p>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>When</th>
                    <th>Server</th>
                    <th>Kind</th>
                    <th>Detail</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.recentErrors.map((e) => (
                    <tr key={e.runId ?? e.startedAt}>
                      <td title={e.runId ? `run ${e.runId}` : undefined}>
                        {new Date(e.startedAt).toLocaleString()}
                      </td>
                      <td>{e.guildName ?? e.guildId}</td>
                      <td>
                        <Badge kind={errorTone(e.kind)}>{e.kind ?? "unknown"}</Badge>
                      </td>
                      <td>
                        <code class="error-detail" title={e.detail ?? undefined}>
                          {e.subtype ? `${e.subtype}: ` : ""}
                          {e.detail ?? "—"}
                        </code>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        </>
      )}
    </>
  );
}
