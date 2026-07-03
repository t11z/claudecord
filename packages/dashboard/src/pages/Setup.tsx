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

  const [inviteUrl, setInviteUrl] = useState<string | null>(null);

  useEffect(() => {
    api
      .status()
      .then((s) => {
        if (s.authMethod !== "none" && s.authValid) setClaudeState("done");
        if (s.discordConnected) setDiscordState("done");
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

  const doneCount = (claudeState === "done" ? 1 : 0) + (discordState === "done" ? 1 : 0);

  return (
    <>
      <h1>Setup</h1>
      <div class="wizard-steps">
        <div class={`step ${claudeState === "done" ? "done" : ""}`} />
        <div class={`step ${discordState === "done" ? "done" : ""}`} />
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

      <Card title="3 · Invite & test">
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
