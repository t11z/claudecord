import { useEffect, useState } from "preact/hooks";
import { api } from "../api.ts";
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

  const [inviteUrl, setInviteUrl] = useState<string | null>(null);

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
  }, []);

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
