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
                  description="Adopt the old shared Claude token as your own, or discard it and link your own subscription later."
                  claimLabel="Adopt as my Claude subscription"
                  onClaim={() => api.claimLegacyClaude()}
                  onDiscard={() => api.discardLegacyClaude()}
                />
              ) : null}

              {legacy.anthropicApiKey ? (
                <LegacyItem
                  title="Shared Anthropic API key"
                  description="An API key can't become a personal subscription token, so this one can only be discarded."
                  onDiscard={() => api.discardLegacyApiKey()}
                />
              ) : null}

              {legacy.githubToken ? (
                <LegacyItem
                  title="Shared GitHub token"
                  description="Adopt the old shared GitHub token as your own, or discard it."
                  claimLabel="Adopt as my GitHub account"
                  onClaim={() => api.claimLegacyGithub()}
                  onDiscard={() => api.discardLegacyGithub()}
                />
              ) : null}

              {legacy.dashboardPassword ? (
                <LegacyItem
                  title="Dashboard password"
                  description="Sign-in no longer uses a password, so the old one can be discarded."
                  onDiscard={() => api.discardLegacyPassword()}
                />
              ) : null}

              {unresolvedProfiles.length > 0 ? (
                <div class="card" style="margin-bottom:0.6rem">
                  <strong>Missing display profiles</strong>
                  <p class="muted" style="margin:0.3rem 0">
                    {unresolvedProfiles.length} user{unresolvedProfiles.length === 1 ? "" : "s"}{" "}
                    linked Claude or GitHub in Discord but never opened the dashboard, so their name
                    and avatar aren't known yet.
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
