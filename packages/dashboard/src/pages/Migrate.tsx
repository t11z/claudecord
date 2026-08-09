import { useState } from "preact/hooks";
import { api, type MigrationStatusDto } from "../api.ts";
import { Card } from "../components.tsx";

type ItemState = "pending" | "busy" | "done" | "error";

/** One legacy-key row: a message, a busy/done/error state, and claim/discard actions. */
function LegacyItem(props: {
  title: string;
  description: string;
  claimLabel?: string;
  onClaim?: () => Promise<{ ok: boolean; message: string }>;
  onDiscard: () => Promise<{ ok: boolean; message: string }>;
}) {
  const [state, setState] = useState<ItemState>("pending");
  const [message, setMessage] = useState<string | null>(null);

  const run = async (action: () => Promise<{ ok: boolean; message: string }>) => {
    setState("busy");
    setMessage(null);
    try {
      const result = await action();
      setState(result.ok ? "done" : "error");
      setMessage(result.message);
    } catch (err) {
      setState("error");
      setMessage(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div class="card" style="margin-bottom:0.6rem">
      <strong>{props.title}</strong>
      <p class="muted" style="margin:0.3rem 0">
        {props.description}
      </p>
      {state === "done" ? (
        <p>✅ {message}</p>
      ) : (
        <>
          {props.onClaim ? (
            <button
              type="button"
              disabled={state === "busy"}
              onClick={() => void run(props.onClaim!)}
            >
              {state === "busy" ? "Working…" : (props.claimLabel ?? "Adopt")}
            </button>
          ) : null}{" "}
          <button
            type="button"
            disabled={state === "busy"}
            onClick={() => void run(props.onDiscard)}
          >
            Discard
          </button>
          {state === "error" && message ? <p>{message}</p> : null}
        </>
      )}
    </div>
  );
}

export function Migrate(props: { status: MigrationStatusDto; onComplete: () => void }) {
  const { legacy, unresolvedProfiles } = props.status;
  const [backfillState, setBackfillState] = useState<ItemState>("pending");
  const [backfillMessage, setBackfillMessage] = useState<string | null>(null);
  const [finishing, setFinishing] = useState(false);

  const runBackfill = async () => {
    setBackfillState("busy");
    try {
      const result = await api.backfillProfiles();
      setBackfillState(result.ok ? "done" : "error");
      setBackfillMessage(result.message);
    } catch (err) {
      setBackfillState("error");
      setBackfillMessage(err instanceof Error ? err.message : String(err));
    }
  };

  const finish = async () => {
    setFinishing(true);
    try {
      await api.completeMigration();
      props.onComplete();
    } finally {
      setFinishing(false);
    }
  };

  const nothingToDo =
    !legacy.claudeOauthToken &&
    !legacy.anthropicApiKey &&
    !legacy.githubToken &&
    !legacy.dashboardPassword &&
    unresolvedProfiles.length === 0;

  return (
    <div class="login-wrap">
      <div class="login-card" style="max-width:32rem">
        <Card>
          <div class="brand" style="padding:0 0 0.8rem">
            <div class="brand-mark">C</div>
            <strong>claudecord</strong>
          </div>
          <h2 style="margin-top:0">Upgrading from the old auth model</h2>
          <p class="muted">
            This install has state from before per-user subscriptions and passwordless login. Each
            item below is optional and only needs deciding once.
          </p>

          {nothingToDo ? (
            <p class="muted">Nothing to resolve — you're all caught up.</p>
          ) : (
            <>
              {legacy.claudeOauthToken ? (
                <LegacyItem
                  title="Shared Claude token"
                  description="secrets.json still has the old instance-wide Claude Code OAuth token. Adopt it as your own /link-claude identity, or discard it and link your own subscription later."
                  claimLabel="Adopt as my Claude subscription"
                  onClaim={() => api.claimLegacyClaude()}
                  onDiscard={() => api.discardLegacyClaude()}
                />
              ) : null}

              {legacy.anthropicApiKey ? (
                <LegacyItem
                  title="Shared Anthropic API key"
                  description="An ANTHROPIC_API_KEY-style credential can't become a per-user subscription token — claudecord now runs on Claude Code subscriptions only. It can only be discarded."
                  onDiscard={() => api.discardLegacyApiKey()}
                />
              ) : null}

              {legacy.githubToken ? (
                <LegacyItem
                  title="Shared GitHub token"
                  description="secrets.json still has the old instance-wide GitHub token. Adopt it as your own /link-github identity, or discard it."
                  claimLabel="Adopt as my GitHub account"
                  onClaim={() => api.claimLegacyGithub()}
                  onDiscard={() => api.discardLegacyGithub()}
                />
              ) : null}

              {legacy.dashboardPassword ? (
                <LegacyItem
                  title="Dashboard password"
                  description="Dashboard login is now passwordless (sign in via /dashboard in Discord). The old password hash is no longer read and can be discarded."
                  onDiscard={() => api.discardLegacyPassword()}
                />
              ) : null}

              {unresolvedProfiles.length > 0 ? (
                <div class="card" style="margin-bottom:0.6rem">
                  <strong>Missing display profiles</strong>
                  <p class="muted" style="margin:0.3rem 0">
                    {unresolvedProfiles.length} user{unresolvedProfiles.length === 1 ? "" : "s"}{" "}
                    linked Claude or GitHub in Discord but never opened the dashboard, so their
                    name/avatar aren't known yet. Resolve them from the bot's server member cache.
                  </p>
                  {backfillState === "done" ? (
                    <p>✅ {backfillMessage}</p>
                  ) : (
                    <>
                      <button
                        type="button"
                        disabled={backfillState === "busy"}
                        onClick={() => void runBackfill()}
                      >
                        {backfillState === "busy" ? "Resolving…" : "Resolve profiles"}
                      </button>
                      {backfillState === "error" && backfillMessage ? (
                        <p>{backfillMessage}</p>
                      ) : null}
                    </>
                  )}
                </div>
              ) : null}
            </>
          )}

          <button type="button" disabled={finishing} onClick={() => void finish()}>
            {finishing ? "Finishing…" : "Finish"}
          </button>
        </Card>
      </div>
    </div>
  );
}
