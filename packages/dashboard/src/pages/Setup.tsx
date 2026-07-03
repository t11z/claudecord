import { useEffect, useState } from "preact/hooks";
import { api, type GithubIdentityDto } from "../api.ts";
import { Card } from "../components.tsx";

type StepState = "pending" | "busy" | "done" | "error";

export function Setup() {
  const [claudeToken, setClaudeToken] = useState("");
  const [claudeState, setClaudeState] = useState<StepState>("pending");
  const [claudeMessage, setClaudeMessage] = useState<string | null>(null);

  const [discordToken, setDiscordToken] = useState("");
  const [applicationId, setApplicationId] = useState("");
  const [discordState, setDiscordState] = useState<StepState>("pending");
  const [discordMessage, setDiscordMessage] = useState<string | null>(null);

  const [githubToken, setGithubToken] = useState("");
  const [githubState, setGithubState] = useState<StepState>("pending");
  const [githubMessage, setGithubMessage] = useState<string | null>(null);

  const [appClientId, setAppClientId] = useState("");
  const [appClientSecret, setAppClientSecret] = useState("");
  const [appState, setAppState] = useState<StepState>("pending");
  const [appMessage, setAppMessage] = useState<string | null>(null);
  const [identities, setIdentities] = useState<GithubIdentityDto[]>([]);

  const [inviteUrl, setInviteUrl] = useState<string | null>(null);

  const loadIdentities = () => {
    api
      .githubIdentities()
      .then((r) => {
        if (r.appConfigured) setAppState("done");
        setIdentities(r.identities);
      })
      .catch(() => {});
  };

  useEffect(() => {
    api
      .status()
      .then((s) => {
        if (s.authMethod !== "none" && s.authValid) setClaudeState("done");
        if (s.discordConnected) setDiscordState("done");
        if (s.githubConfigured) setGithubState("done");
        setInviteUrl(s.inviteUrl);
      })
      .catch(() => {});
    loadIdentities();
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

  const unlink = async (id: string) => {
    try {
      await api.unlinkGithubIdentity(id);
      loadIdentities();
    } catch {
      // ignore — the list will simply stay as-is
    }
  };

  const submitClaude = async () => {
    setClaudeState("busy");
    setClaudeMessage(null);
    try {
      const result = await api.setupClaudeToken(claudeToken);
      setClaudeState(result.ok ? "done" : "error");
      setClaudeMessage(result.message);
      setClaudeToken("");
    } catch (err) {
      setClaudeState("error");
      setClaudeMessage(err instanceof Error ? err.message : String(err));
    }
  };

  const submitDiscord = async () => {
    setDiscordState("busy");
    setDiscordMessage(null);
    try {
      const result = await api.setupDiscordToken(discordToken, applicationId);
      setDiscordState(result.ok ? "done" : "error");
      setDiscordMessage(result.message);
      setDiscordToken("");
      if (result.ok) {
        const status = await api.status().catch(() => null);
        if (status) setInviteUrl(status.inviteUrl);
      }
    } catch (err) {
      setDiscordState("error");
      setDiscordMessage(err instanceof Error ? err.message : String(err));
    }
  };

  const submitGithub = async () => {
    setGithubState("busy");
    setGithubMessage(null);
    try {
      const result = await api.setupGithubToken(githubToken);
      setGithubState(result.ok ? "done" : "error");
      setGithubMessage(result.message);
      setGithubToken("");
    } catch (err) {
      setGithubState("error");
      setGithubMessage(err instanceof Error ? err.message : String(err));
    }
  };

  const doneCount = (claudeState === "done" ? 1 : 0) + (discordState === "done" ? 1 : 0);

  return (
    <>
      <h1>Setup</h1>
      <div class="wizard-steps">
        <div class={`step ${claudeState === "done" ? "done" : ""}`} />
        <div class={`step ${discordState === "done" ? "done" : ""}`} />
        <div class={`step ${githubState === "done" ? "done" : ""}`} />
        <div class={`step ${doneCount === 2 ? "done" : ""}`} />
      </div>

      <Card title="1 · Claude credential">
        <p class="muted">
          Recommended: a <strong>Claude Code OAuth token</strong> from your Pro/Max subscription. On
          any machine with Claude Code installed, run <code>claude setup-token</code> and paste the
          result here. An Anthropic API key (<code>sk-ant-api…</code>) works too.
        </p>
        <label class="field">
          <span>Token</span>
          <input
            type="password"
            placeholder="sk-ant-oat01-…"
            value={claudeToken}
            onInput={(e) => setClaudeToken((e.target as HTMLInputElement).value)}
          />
        </label>
        <button
          type="button"
          disabled={claudeState === "busy" || claudeToken.trim().length === 0}
          onClick={() => void submitClaude()}
        >
          {claudeState === "busy" ? "Validating (runs a real test query)…" : "Save & validate"}
        </button>{" "}
        {claudeState === "done" ? "✅" : null}
        {claudeMessage ? (
          <p class={claudeState === "error" ? "" : "muted"}>{claudeMessage}</p>
        ) : null}
        <p class="muted">
          Tokens are stored in <code>DATA_DIR/secrets.json</code> (chmod 600), never in the
          database. Environment variables take precedence.
        </p>
      </Card>

      <Card title="2 · Discord bot">
        <p class="muted">
          Create an application at{" "}
          <a href="https://discord.com/developers/applications" target="_blank" rel="noreferrer">
            discord.com/developers
          </a>
          , add a <strong>Bot</strong>, and on the Bot page enable the{" "}
          <strong>Message Content Intent</strong> (required for @mentions). Then paste the bot token
          and the Application ID from the General Information page.
        </p>
        <label class="field">
          <span>Bot token</span>
          <input
            type="password"
            value={discordToken}
            onInput={(e) => setDiscordToken((e.target as HTMLInputElement).value)}
          />
        </label>
        <label class="field">
          <span>Application ID</span>
          <input
            type="text"
            placeholder="1234567890…"
            value={applicationId}
            onInput={(e) => setApplicationId((e.target as HTMLInputElement).value)}
          />
        </label>
        <button
          type="button"
          disabled={discordState === "busy" || discordToken.trim().length === 0}
          onClick={() => void submitDiscord()}
        >
          {discordState === "busy" ? "Connecting…" : "Save & connect"}
        </button>{" "}
        {discordState === "done" ? "✅" : null}
        {discordMessage ? (
          <p class={discordState === "error" ? "" : "muted"}>{discordMessage}</p>
        ) : null}
      </Card>

      <Card title="3 · GitHub access (optional)">
        <p class="muted">
          Give the bot a GitHub token and it can clone, read, push and open pull requests on the
          repositories that token reaches — using <code>git</code> and the <code>gh</code> CLI
          inside a thread's sandbox. This only takes effect in <strong>agentic mode</strong> (enable
          it per server under Access control).
        </p>
        <p class="muted">
          Create a token at{" "}
          <a href="https://github.com/settings/tokens?type=beta" target="_blank" rel="noreferrer">
            github.com/settings/tokens
          </a>
          . A <strong>fine-grained</strong> token scoped to just the repositories you want is
          strongly recommended. Grant these repository permissions:
        </p>
        <ul class="muted">
          <li>
            <strong>Contents</strong> — Read (or Read &amp; write to let it push commits/branches)
          </li>
          <li>
            <strong>Pull requests</strong> — Read &amp; write (to open and comment on PRs)
          </li>
          <li>
            <strong>Metadata</strong> — Read (mandatory, auto-selected)
          </li>
          <li>
            <strong>Issues</strong> — Read &amp; write (optional, for issue triage)
          </li>
        </ul>
        <p class="muted">
          A <strong>classic</strong> PAT with the <code>repo</code> scope works too, but grants far
          broader access — prefer fine-grained. Leave this empty to skip GitHub access.
        </p>
        <label class="field">
          <span>GitHub token</span>
          <input
            type="password"
            placeholder="github_pat_… or ghp_…"
            value={githubToken}
            onInput={(e) => setGithubToken((e.target as HTMLInputElement).value)}
          />
        </label>
        <button
          type="button"
          disabled={githubState === "busy" || githubToken.trim().length === 0}
          onClick={() => void submitGithub()}
        >
          {githubState === "busy" ? "Validating…" : "Save & validate"}
        </button>{" "}
        {githubState === "done" ? "✅" : null}
        {githubMessage ? (
          <p class={githubState === "error" ? "" : "muted"}>{githubMessage}</p>
        ) : null}
        <p class="muted">
          Stored in <code>DATA_DIR/secrets.json</code> (chmod 600), never in the database or logs. A{" "}
          <code>GITHUB_TOKEN</code> environment variable takes precedence.
        </p>
      </Card>

      <Card title="3b · Per-user GitHub (multi-user, optional)">
        <p class="muted">
          On a shared server, let each role-gated member connect their <strong>own</strong> GitHub
          account instead of everyone sharing one token. Register a{" "}
          <a href="https://github.com/settings/apps/new" target="_blank" rel="noreferrer">
            GitHub App
          </a>{" "}
          with <strong>Enable Device Flow</strong> checked, then paste its Client ID and a generated
          Client secret here. Members run <code>/link-github</code> in Discord; agentic runs then
          act in the acting user's namespace. Set the allowed roles per server under Access control.
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
        {identities.length > 0 ? (
          <>
            <p class="muted" style="margin-top:1rem">
              <strong>Linked accounts</strong>
            </p>
            <div class="checkbox-list">
              {identities.map((id) => (
                <div key={id.discordUserId} style="display:flex;gap:0.6rem;align-items:center">
                  <span>
                    @{id.login ?? "unknown"} <span class="muted">· user {id.discordUserId}</span>
                  </span>
                  <button type="button" onClick={() => void unlink(id.discordUserId)}>
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
        {doneCount === 2 && inviteUrl ? (
          <>
            <p>
              🎉 Everything is connected. Invite the bot to a server, then mention it in a text
              channel:
            </p>
            <p>
              <code>@YourBot hello there!</code>
            </p>
            <a class="button" href={inviteUrl} target="_blank" rel="noreferrer">
              Open invite link
            </a>
          </>
        ) : (
          <p class="muted">Complete the two steps above to get your invite link.</p>
        )}
      </Card>
    </>
  );
}
