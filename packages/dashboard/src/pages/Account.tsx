import { useEffect, useState } from "preact/hooks";
import { api, type MeDto } from "../api.ts";
import { Badge, Card, Stat } from "../components.tsx";
import { useGithubDeviceFlow } from "../useGithubDeviceFlow.ts";

export function Account(props: { me: MeDto; onChange: () => void }) {
  const { me } = props;

  const [claudeToken, setClaudeToken] = useState("");
  const [claudeBusy, setClaudeBusy] = useState(false);
  const [claudeMessage, setClaudeMessage] = useState<string | null>(null);

  const github = useGithubDeviceFlow(props.onChange);

  const [usage, setUsage] = useState<Awaited<ReturnType<typeof api.meUsage>> | null>(null);

  useEffect(() => {
    api
      .meUsage(30)
      .then(setUsage)
      .catch(() => {});
  }, []);

  const relinkClaude = async () => {
    setClaudeBusy(true);
    setClaudeMessage(null);
    try {
      const result = await api.linkMyClaude(claudeToken);
      setClaudeMessage(result.message);
      if (result.ok) {
        setClaudeToken("");
        props.onChange();
      }
    } catch (err) {
      setClaudeMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setClaudeBusy(false);
    }
  };

  const unlinkClaude = async () => {
    await api.unlinkMyClaude().catch(() => {});
    props.onChange();
  };

  const unlinkGithub = async () => {
    await api.unlinkMyGithub().catch(() => {});
    props.onChange();
  };

  // Server-computed, from the same function the mutations enforce with.
  const githubBlocked = me.github.linkBlockedReason;

  return (
    <>
      <h1>Your account</h1>
      <div class="grid">
        <Stat label="Signed in as" value={me.user.globalName ?? me.user.username ?? me.user.id} />
        {usage ? <Stat label="Runs (30d)" value={usage.totalRuns} /> : null}
        {usage ? (
          <Stat label="Est. cost (30d)" value={`$${usage.totalCostUsd.toFixed(2)}`} />
        ) : null}
      </div>

      <Card title="Claude subscription">
        <p>
          {me.claude.linked ? (
            <Badge kind="ok">linked</Badge>
          ) : (
            <Badge kind="warn">not linked</Badge>
          )}{" "}
          {me.claude.lastVerifiedAt ? (
            <span class="muted">
              last verified {new Date(me.claude.lastVerifiedAt).toLocaleString()}
            </span>
          ) : null}
        </p>
        {me.claude.linked ? (
          <button type="button" onClick={() => void unlinkClaude()}>
            Unlink
          </button>
        ) : null}
        <p class="muted" style="margin-top:0.8rem">
          {me.claude.linked
            ? "Replace it with a fresh token:"
            : "Link a token from claude setup-token:"}
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
          disabled={claudeBusy || claudeToken.trim().length === 0}
          onClick={() => void relinkClaude()}
        >
          {claudeBusy ? "Validating…" : me.claude.linked ? "Replace token" : "Link Claude"}
        </button>
        {claudeMessage ? <p class="muted">{claudeMessage}</p> : null}
      </Card>

      <Card title="GitHub account (optional)">
        <p>
          {me.github.linked ? (
            <Badge kind="ok">linked as @{me.github.login ?? "unknown"}</Badge>
          ) : (
            <Badge kind="info">not linked</Badge>
          )}
        </p>
        {me.github.linked ? (
          <button type="button" onClick={() => void unlinkGithub()}>
            Unlink
          </button>
        ) : github.device ? (
          <>
            <p>
              1. Open{" "}
              <a href={github.device.verificationUri} target="_blank" rel="noreferrer">
                {github.device.verificationUri}
              </a>
            </p>
            <p>
              2. Enter this code: <code>{github.device.userCode}</code>
            </p>
            <p class="muted">Waiting for you to authorize…</p>
          </>
        ) : githubBlocked ? (
          <p class="muted">{githubBlocked}</p>
        ) : (
          <button type="button" disabled={github.state === "starting"} onClick={github.start}>
            {github.state === "starting" ? "Starting…" : "Link GitHub"}
          </button>
        )}
        {github.message ? <p class="muted">{github.message}</p> : null}
        <p class="muted" style="margin-top:0.8rem">
          Or run <code>/link-github link</code> in Discord — either way works.
        </p>
      </Card>
    </>
  );
}
