import { useEffect, useState } from "preact/hooks";
import { api, type ClaudeIdentityDto, type GithubIdentityDto } from "../api.ts";
import { Card } from "../components.tsx";

type StepState = "pending" | "busy" | "done" | "error";

export function Setup() {
  const [discordConnected, setDiscordConnected] = useState(false);

  const [appClientId, setAppClientId] = useState("");
  const [appClientSecret, setAppClientSecret] = useState("");
  const [appState, setAppState] = useState<StepState>("pending");
  const [appMessage, setAppMessage] = useState<string | null>(null);
  const [githubIdentities, setGithubIdentities] = useState<GithubIdentityDto[]>([]);

  const [claudeIdentities, setClaudeIdentities] = useState<ClaudeIdentityDto[]>([]);
  const [claudeChecking, setClaudeChecking] = useState<string | null>(null);
  const [claudeCheckMessage, setClaudeCheckMessage] = useState<Record<string, string>>({});

  const [inviteUrl, setInviteUrl] = useState<string | null>(null);

  const loadGithubIdentities = () => {
    api
      .githubIdentities()
      .then((r) => {
        if (r.appConfigured) setAppState("done");
        setGithubIdentities(r.identities);
      })
      .catch(() => {});
  };

  const loadClaudeIdentities = () => {
    api
      .claudeIdentities()
      .then((r) => setClaudeIdentities(r.identities))
      .catch(() => {});
  };

  useEffect(() => {
    api
      .status()
      .then((s) => {
        setDiscordConnected(s.discordConnected);
        setInviteUrl(s.inviteUrl);
      })
      .catch(() => {});
    loadGithubIdentities();
    loadClaudeIdentities();
  }, []);

  const submitApp = async () => {
    setAppState("busy");
    setAppMessage(null);
    try {
      const result = await api.setupGithubApp(appClientId, appClientSecret);
      setAppState(result.ok ? "done" : "error");
      setAppMessage(result.message);
      setAppClientSecret("");
    } catch (err) {
      setAppState("error");
      setAppMessage(err instanceof Error ? err.message : String(err));
    }
  };

  const unlinkGithub = async (id: string) => {
    try {
      await api.unlinkGithubIdentity(id);
      loadGithubIdentities();
    } catch {
      // ignore — the list will simply stay as-is
    }
  };

  const unlinkClaude = async (id: string) => {
    try {
      await api.unlinkClaudeIdentity(id);
      loadClaudeIdentities();
    } catch {
      // ignore — the list will simply stay as-is
    }
  };

  const checkClaude = async (id: string) => {
    setClaudeChecking(id);
    try {
      const result = await api.checkClaudeIdentity(id);
      setClaudeCheckMessage((m) => ({ ...m, [id]: result.message }));
      loadClaudeIdentities();
    } catch (err) {
      setClaudeCheckMessage((m) => ({
        ...m,
        [id]: err instanceof Error ? err.message : String(err),
      }));
    } finally {
      setClaudeChecking(null);
    }
  };

  return (
    <>
      <h1>Setup</h1>
      <div class="wizard-steps">
        <div class={`step ${discordConnected ? "done" : ""}`} />
        <div class={`step ${claudeIdentities.length > 0 ? "done" : ""}`} />
        <div class={`step ${appState === "done" ? "done" : ""}`} />
        <div class={`step ${discordConnected ? "done" : ""}`} />
      </div>

      <Card title="1 · Discord bot">
        <p class="muted">
          The bot token has no dashboard form anymore — since reaching this page at all requires{" "}
          <code>/dashboard</code> to already work, and that needs the bot online. Create an
          application at{" "}
          <a href="https://discord.com/developers/applications" target="_blank" rel="noreferrer">
            discord.com/developers
          </a>
          , add a <strong>Bot</strong>, enable the <strong>Message Content Intent</strong> on the
          Bot page (required for @mentions), and put the bot token and application ID in{" "}
          <code>.env</code>:
        </p>
        <pre class="muted" style="padding:0.6rem;border-radius:6px;overflow-x:auto">
          {"DISCORD_BOT_TOKEN=...\nDISCORD_APPLICATION_ID=..."}
        </pre>
        <p class="muted">
          Restart the bot after editing — this page will pick it up automatically.
        </p>
        {discordConnected ? <p>✅ Connected.</p> : <p class="muted">Not connected yet.</p>}
      </Card>

      <Card title="2 · Claude subscriptions (one per user)">
        <p class="muted">
          claudecord has no shared, instance-wide Claude credential. Every Discord user brings their
          own Claude Code subscription: once the bot is in a server, each user runs{" "}
          <code>/link-claude link</code>, pastes a token from <code>claude setup-token</code> into
          the modal that pops up, and every run they start from then on is billed to their own
          subscription.
        </p>
        {claudeIdentities.length > 0 ? (
          <div class="checkbox-list">
            {claudeIdentities.map((id) => (
              <div key={id.discordUserId} style="display:flex;gap:0.6rem;align-items:center">
                <span>
                  user {id.discordUserId}{" "}
                  <span class="muted">
                    ·{" "}
                    {id.lastVerifiedAt
                      ? `last verified ${new Date(id.lastVerifiedAt).toLocaleString()}`
                      : "never re-verified"}
                  </span>
                </span>
                <button
                  type="button"
                  disabled={claudeChecking === id.discordUserId}
                  onClick={() => void checkClaude(id.discordUserId)}
                >
                  {claudeChecking === id.discordUserId ? "Checking…" : "Re-check"}
                </button>
                <button type="button" onClick={() => void unlinkClaude(id.discordUserId)}>
                  Unlink
                </button>
                {claudeCheckMessage[id.discordUserId] ? (
                  <span class="muted">{claudeCheckMessage[id.discordUserId]}</span>
                ) : null}
              </div>
            ))}
          </div>
        ) : (
          <p class="muted">No one has linked a Claude subscription yet.</p>
        )}
        <p class="muted">
          Tokens are stored in <code>DATA_DIR/secrets.json</code> (chmod 600), never in the database
          or logs.
        </p>
      </Card>

      <Card title="3 · Per-user GitHub access (optional)">
        <p class="muted">
          On a shared server, let each role-gated member connect their <strong>own</strong> GitHub
          account. Agentic runs then clone, read, push and open pull requests using <code>git</code>
          /<code>gh</code> in the acting user's namespace — never a shared token. Register a{" "}
          <a href="https://github.com/settings/apps/new" target="_blank" rel="noreferrer">
            GitHub App
          </a>{" "}
          with <strong>Enable Device Flow</strong> checked, then paste its Client ID and a generated
          Client secret here. Members run <code>/link-github</code> in Discord; set the allowed
          roles per server under Access control.
        </p>
        <label class="field">
          <span>Client ID</span>
          <input
            type="text"
            placeholder="Iv1.abc123…"
            value={appClientId}
            onInput={(e) => setAppClientId((e.target as HTMLInputElement).value)}
          />
        </label>
        <label class="field">
          <span>Client secret</span>
          <input
            type="password"
            value={appClientSecret}
            onInput={(e) => setAppClientSecret((e.target as HTMLInputElement).value)}
          />
        </label>
        <button
          type="button"
          disabled={appState === "busy" || appClientId.trim().length === 0}
          onClick={() => void submitApp()}
        >
          {appState === "busy" ? "Saving…" : "Save GitHub App"}
        </button>{" "}
        {appState === "done" ? "✅" : null}
        {appMessage ? <p class={appState === "error" ? "" : "muted"}>{appMessage}</p> : null}
        {githubIdentities.length > 0 ? (
          <>
            <p class="muted" style="margin-top:1rem">
              <strong>Linked accounts</strong>
            </p>
            <div class="checkbox-list">
              {githubIdentities.map((id) => (
                <div key={id.discordUserId} style="display:flex;gap:0.6rem;align-items:center">
                  <span>
                    @{id.login ?? "unknown"} <span class="muted">· user {id.discordUserId}</span>
                  </span>
                  <button type="button" onClick={() => void unlinkGithub(id.discordUserId)}>
                    Unlink
                  </button>
                </div>
              ))}
            </div>
          </>
        ) : (
          <p class="muted">No accounts linked yet.</p>
        )}
        <p class="muted">
          Tokens are stored in <code>DATA_DIR/secrets.json</code> (chmod 600), never in the database
          or logs.
        </p>
      </Card>

      <Card title="4 · Invite & test">
        {discordConnected && inviteUrl ? (
          <>
            <p>
              🎉 The bot is connected. Invite it to a server, then mention it in a text channel:
            </p>
            <p>
              <code>@YourBot hello there!</code>
            </p>
            <a class="button" href={inviteUrl} target="_blank" rel="noreferrer">
              Open invite link
            </a>
            <p class="muted" style="margin-top:0.8rem">
              Each member will need to run <code>/link-claude link</code> before the bot will answer
              them.
            </p>
          </>
        ) : (
          <p class="muted">Complete step 1 above to get your invite link.</p>
        )}
      </Card>
    </>
  );
}
