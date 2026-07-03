import { useEffect, useState } from "preact/hooks";
import { api, type StatsDto } from "../api.ts";
import { Card, Sparkline, Stat } from "../components.tsx";

const fmt = (n: number) => n.toLocaleString("en-US");

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
        </>
      )}
    </>
  );
}
