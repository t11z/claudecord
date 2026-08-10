import { useEffect, useState } from "preact/hooks";
import { api, type ClaudeIdentityDto, type GithubIdentityDto } from "../api.ts";
import { Card } from "../components.tsx";

type StepState = "pending" | "busy" | "done" | "error";

const DOCS = "https://t11z.github.io/claudecord/guide";

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
  /** Discord id → display name, so these lists don't show raw snowflakes. */
  const [names, setNames] = useState<Record<string, string>>({});

  const [oauthConfigured, setOauthConfigured] = useState(false);
  const [discordSecret, setDiscordSecret] = useState("");
  const [discordState, setDiscordState] = useState<StepState>("pending");
  const [discordMessage, setDiscordMessage] = useState<string | null>(null);
  // Comes from the server, not from window.location: behind a proxy the two can
  // differ, and Discord matches the redirect URL the *server* sends. Registering
  // the browser's guess instead would fail on discord.com, out of our sight.
  const [redirectUrl, setRedirectUrl] = useState<string | null>(null);

  const submitDiscordOAuth = async () => {
    setDiscordState("busy");
    setDiscordMessage(null);
    try {
      const result = await api.setupDiscordOAuth(discordSecret);
      setDiscordState(result.ok ? "done" : "error");
      setDiscordMessage(result.message);
      setDiscordSecret("");
      if (result.ok) setOauthConfigured(discordSecret.trim().length > 0);
    } catch (err) {
      setDiscordState("error");
      setDiscordMessage(err instanceof Error ? err.message : String(err));
    }
  };

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
        setOauthConfigured(s.discordOAuthConfigured);
        setRedirectUrl(s.discordRedirectUri);
      })
      .catch(() => {});
    loadGithubIdentities();
    loadClaudeIdentities();
    // Same user set as the two identity lists below, but with profiles attached.
    api
      .identityGraph()
      .then((g) => {
        const map: Record<string, string> = {};
        for (const row of g.rows) {
          const name = row.globalName ?? row.username;
          if (name) map[row.discordUserId] = name;
        }
        setNames(map);
      })
      .catch(() => {});
  }, []);

  /** A display name when we know one, the raw id only as a last resort. */
  const who = (discordUserId: string): string => names[discordUserId] ?? discordUserId;

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
      {/* Three steps the operator performs. The Claude card below is a status
          readout, not a step, so it carries no number and no pip. */}
      <div class="wizard-steps">
        <div class={`step ${discordConnected ? "done" : ""}`} />
        <div class={`step ${appState === "done" ? "done" : ""}`} />
        <div class={`step ${discordConnected && inviteUrl ? "done" : ""}`} />
      </div>

      <Card title="1 · Discord bot">
        {discordConnected ? (
          <p>✅ Connected.</p>
        ) : (
          <>
            <p>
              Not connected. Add both values to <code>.env</code> and restart:
            </p>
            <pre class="muted" style="padding:0.6rem;border-radius:6px;overflow-x:auto">
              {"DISCORD_BOT_TOKEN=...\nDISCORD_APPLICATION_ID=..."}
            </pre>
            <p class="muted">
              Enable the <strong>Message Content Intent</strong> too — without it the bot can't see
              @mentions.
            </p>
            <p>
              <a href={`${DOCS}/discord-app-setup/`} target="_blank" rel="noreferrer">
                Set up the Discord app →
              </a>
            </p>
          </>
        )}
      </Card>

      <Card title="Browser sign-in (optional)">
        {oauthConfigured ? (
          <p>✅ The sign-in page offers a Discord button.</p>
        ) : (
          <>
            <p class="muted">
              Let people sign in from the browser instead of running <code>/dashboard</code> in
              Discord. Paste the client secret of the <strong>same</strong> Discord application as
              the bot, and add this redirect URL to it:
            </p>
            {redirectUrl ? (
              <pre class="muted" style="padding:0.6rem;border-radius:6px;overflow-x:auto">
                {redirectUrl}
              </pre>
            ) : (
              <p class="muted">
                Set <code>DASHBOARD_PUBLIC_URL</code> first — without it there is no address for
                Discord to send people back to.
              </p>
            )}
          </>
        )}
        <label class="field">
          <span>Client secret</span>
          <input
            type="password"
            value={discordSecret}
            onInput={(e) => setDiscordSecret((e.target as HTMLInputElement).value)}
          />
        </label>
        <button
          type="button"
          disabled={discordState === "busy"}
          onClick={() => void submitDiscordOAuth()}
        >
          {discordState === "busy" ? "Saving…" : oauthConfigured ? "Replace secret" : "Save"}
        </button>
        {discordMessage ? (
          <p class={discordState === "error" ? "" : "muted"}>{discordMessage}</p>
        ) : null}
      </Card>

      <Card title="Claude subscriptions">
        <p class="muted">
          Each member links their own with <code>/link-claude link</code> in Discord, pasting a
          token from <code>claude setup-token</code>.
        </p>
        {claudeIdentities.length > 0 ? (
          <div class="checkbox-list">
            {claudeIdentities.map((id) => (
              <div key={id.discordUserId} style="display:flex;gap:0.6rem;align-items:center">
                <span>
                  {who(id.discordUserId)}{" "}
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
          <p class="muted">Nobody has linked a Claude subscription yet.</p>
        )}
      </Card>

      <Card title="2 · GitHub access (optional)">
        <p class="muted">
          Members connect their own GitHub account with <code>/link-github</code> in Discord. To
          enable that, register a{" "}
          <a href="https://github.com/settings/apps/new" target="_blank" rel="noreferrer">
            GitHub App
          </a>{" "}
          with <strong>Enable Device Flow</strong> checked and paste its credentials here. Choose
          who may use it under Access control.
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
        <p>
          <a href={`${DOCS}/github-integration/`} target="_blank" rel="noreferrer">
            How per-user GitHub access works →
          </a>
        </p>
        {githubIdentities.length > 0 ? (
          <>
            <p class="muted" style="margin-top:1rem">
              <strong>Connected GitHub accounts</strong>
            </p>
            <div class="checkbox-list">
              {githubIdentities.map((id) => (
                <div key={id.discordUserId} style="display:flex;gap:0.6rem;align-items:center">
                  <span>
                    @{id.login ?? "unknown"} <span class="muted">· {who(id.discordUserId)}</span>
                  </span>
                  <button type="button" onClick={() => void unlinkGithub(id.discordUserId)}>
                    Unlink
                  </button>
                </div>
              ))}
            </div>
          </>
        ) : (
          <p class="muted">Nobody has connected a GitHub account yet.</p>
        )}
      </Card>

      <Card title="3 · Invite & test">
        {discordConnected && inviteUrl ? (
          <>
            <p>Invite the bot to a server, then mention it in a text channel:</p>
            <p>
              <code>@YourBot hello there!</code>
            </p>
            <a class="button" href={inviteUrl} target="_blank" rel="noreferrer">
              Open invite link
            </a>
            <p class="muted" style="margin-top:0.8rem">
              Each member needs to run <code>/link-claude link</code> before the bot will answer
              them.
            </p>
          </>
        ) : (
          <p class="muted">Complete step 1 to get your invite link.</p>
        )}
      </Card>
    </>
  );
}
