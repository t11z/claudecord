import { useEffect, useState } from "preact/hooks";
import { api, type MeDto } from "../api.ts";
import { Badge, Card, Stat } from "../components.tsx";

export function Account(props: { me: MeDto; onChange: () => void }) {
  const { me } = props;

  const [claudeToken, setClaudeToken] = useState("");
  const [claudeBusy, setClaudeBusy] = useState(false);
  const [claudeMessage, setClaudeMessage] = useState<string | null>(null);

  const [githubBusy, setGithubBusy] = useState(false);
  const [githubMessage, setGithubMessage] = useState<string | null>(null);
  const [deviceCode, setDeviceCode] = useState<{
    userCode: string;
    verificationUri: string;
  } | null>(null);

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

  const startGithub = async () => {
    setGithubBusy(true);
    setGithubMessage(null);
    try {
      const device = await api.startMyGithubDevice();
      if (!device.ok || !device.deviceCode || !device.userCode || !device.verificationUri) {
        setGithubMessage(device.message ?? "Couldn't start linking.");
        return;
      }
      setDeviceCode({ userCode: device.userCode, verificationUri: device.verificationUri });
      const deadline = Date.now() + (device.expiresIn ?? 900) * 1000;
      const interval = (device.interval ?? 5) * 1000;
      const poll = () => {
        window.setTimeout(async () => {
          if (Date.now() > deadline) {
            setGithubMessage("The code expired. Try again.");
            setDeviceCode(null);
            return;
          }
          const result = await api.pollMyGithubDevice(device.deviceCode!);
          if (result.status === "authorized") {
            setDeviceCode(null);
            props.onChange();
          } else if (result.status === "error") {
            setGithubMessage(result.message ?? "Linking failed.");
            setDeviceCode(null);
          } else {
            poll();
          }
        }, interval);
      };
      poll();
    } finally {
      setGithubBusy(false);
    }
  };

  const unlinkGithub = async () => {
    await api.unlinkMyGithub().catch(() => {});
    props.onChange();
  };

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
        ) : deviceCode ? (
          <>
            <p>
              1. Open{" "}
              <a href={deviceCode.verificationUri} target="_blank" rel="noreferrer">
                {deviceCode.verificationUri}
              </a>
            </p>
            <p>
              2. Enter this code: <code>{deviceCode.userCode}</code>
            </p>
            <p class="muted">Waiting for you to authorize…</p>
          </>
        ) : (
          <button type="button" disabled={githubBusy} onClick={() => void startGithub()}>
            {githubBusy ? "Starting…" : "Link GitHub"}
          </button>
        )}
        {githubMessage ? <p class="muted">{githubMessage}</p> : null}
      </Card>
    </>
  );
}
