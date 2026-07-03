import { useEffect, useState } from "preact/hooks";
import { api, type StatusDto } from "../api.ts";
import { Badge, Card, Stat } from "../components.tsx";

function formatUptime(seconds: number): string {
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400)
    return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
  return `${Math.floor(seconds / 86400)}d ${Math.floor((seconds % 86400) / 3600)}h`;
}

export function Overview() {
  const [status, setStatus] = useState<StatusDto | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const load = () =>
      api
        .status()
        .then((s) => active && setStatus(s))
        .catch((e) => active && setError(String(e)));
    load();
    const timer = setInterval(load, 5000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);

  if (error) return <Card title="Overview">Failed to load status: {error}</Card>;
  if (!status) return <Card title="Overview">Loading…</Card>;

  return (
    <>
      <h1>Overview</h1>
      <div class="grid">
        <Stat label="Discord" value={status.discordConnected ? "connected" : "offline"} />
        <Stat label="Servers" value={status.guildCount} />
        <Stat label="Queue" value={`${status.activeRuns} running / ${status.queueDepth} waiting`} />
        <Stat label="Uptime" value={formatUptime(status.uptimeSeconds)} />
      </div>

      <Card title="Claude authentication">
        <p>
          Method:{" "}
          {status.authMethod === "oauth" ? (
            <Badge kind="ok">Claude Code OAuth token</Badge>
          ) : status.authMethod === "api-key" ? (
            <Badge kind="info">Anthropic API key</Badge>
          ) : (
            <Badge kind="danger">not configured</Badge>
          )}{" "}
          {status.authValid === true ? (
            <Badge kind="ok">verified</Badge>
          ) : status.authValid === false ? (
            <Badge kind="danger">check failed</Badge>
          ) : (
            <Badge kind="warn">not checked yet</Badge>
          )}
        </p>
        <p class="muted">
          Default model: <code>{status.defaultModel}</code> · Bot:{" "}
          {status.botUser ? <code>{status.botUser.tag}</code> : "not connected"} · GitHub:{" "}
          {status.githubConfigured ? (
            <Badge kind="ok">token configured</Badge>
          ) : (
            <Badge kind="info">not configured</Badge>
          )}{" "}
          · Version: <code>{status.version}</code>
        </p>
        {status.authMethod === "none" || !status.discordConnected ? (
          <p>
            <a class="button" href="#/setup">
              Finish setup →
            </a>
          </p>
        ) : null}
      </Card>

      {status.inviteUrl ? (
        <Card title="Invite the bot">
          <p class="muted">
            Adds the bot with exactly the permissions it needs (send messages, create threads,
            embed, attach, react, read history).
          </p>
          <a class="button" href={status.inviteUrl} target="_blank" rel="noreferrer">
            Open invite link
          </a>
        </Card>
      ) : null}
    </>
  );
}
