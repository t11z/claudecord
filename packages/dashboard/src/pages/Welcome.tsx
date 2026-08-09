import { useEffect, useRef, useState } from "preact/hooks";
import { api, type MeDto } from "../api.ts";
import { Card } from "../components.tsx";

type ClaudeState = "idle" | "busy" | "error";
type GithubState = "idle" | "starting" | "waiting" | "authorized" | "error";

export function Welcome(props: { me: MeDto; onComplete: () => void }) {
  const { me } = props;
  const [step, setStep] = useState<1 | 2 | 3>(me.claude.linked ? 3 : 2);

  const [claudeToken, setClaudeToken] = useState("");
  const [claudeState, setClaudeState] = useState<ClaudeState>("idle");
  const [claudeMessage, setClaudeMessage] = useState<string | null>(null);

  const [githubState, setGithubState] = useState<GithubState>("idle");
  const [githubMessage, setGithubMessage] = useState<string | null>(null);
  const [deviceCode, setDeviceCode] = useState<{ userCode: string; verificationUri: string } | null>(
    null,
  );
  const pollTimer = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (pollTimer.current) window.clearTimeout(pollTimer.current);
    };
  }, []);

  const submitClaude = async () => {
    setClaudeState("busy");
    setClaudeMessage(null);
    try {
      const result = await api.linkMyClaude(claudeToken);
      if (result.ok) {
        setClaudeToken("");
        setStep(3);
      } else {
        setClaudeState("error");
        setClaudeMessage(result.message);
      }
    } catch (err) {
      setClaudeState("error");
      setClaudeMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setClaudeState("idle");
    }
  };

  const startGithub = async () => {
    setGithubState("starting");
    setGithubMessage(null);
    try {
      const device = await api.startMyGithubDevice();
      if (!device.ok || !device.deviceCode || !device.userCode || !device.verificationUri) {
        setGithubState("error");
        setGithubMessage(device.message ?? "Couldn't start linking.");
        return;
      }
      setDeviceCode({ userCode: device.userCode, verificationUri: device.verificationUri });
      setGithubState("waiting");
      poll(device.deviceCode, (device.interval ?? 5) * 1000, Date.now() + (device.expiresIn ?? 900) * 1000);
    } catch (err) {
      setGithubState("error");
      setGithubMessage(err instanceof Error ? err.message : String(err));
    }
  };

  const poll = (deviceCode: string, intervalMs: number, deadline: number) => {
    pollTimer.current = window.setTimeout(async () => {
      if (Date.now() > deadline) {
        setGithubState("error");
        setGithubMessage("The code expired. Try again.");
        return;
      }
      try {
        const result = await api.pollMyGithubDevice(deviceCode);
        if (result.status === "authorized") {
          setGithubState("authorized");
        } else if (result.status === "error") {
          setGithubState("error");
          setGithubMessage(result.message ?? "Linking failed.");
        } else {
          poll(deviceCode, (result.interval ?? intervalMs / 1000) * 1000, deadline);
        }
      } catch (err) {
        setGithubState("error");
        setGithubMessage(err instanceof Error ? err.message : String(err));
      }
    }, intervalMs);
  };

  const skipGithub = async () => {
    await api.skipMyGithub().catch(() => {});
    props.onComplete();
  };

  return (
    <div class="login-wrap">
      <div class="login-card">
        <Card>
          <div class="brand" style="padding:0 0 0.8rem">
            <div class="brand-mark">C</div>
            <strong>claudecord</strong>
          </div>
          <div class="wizard-steps">
            <div class="step done" />
            <div class={`step ${step > 2 || me.claude.linked ? "done" : ""}`} />
            <div class={`step ${githubState === "authorized" ? "done" : ""}`} />
          </div>

          {step === 1 || step >= 2 ? (
            <>
              <h2 style="margin-top:0">Signed in as {me.user.globalName ?? me.user.username}</h2>
              {me.guilds.length > 0 ? (
                <p class="muted">
                  Shared with the bot: {me.guilds.map((g) => g.name).join(", ")}.
                </p>
              ) : null}
            </>
          ) : null}

          {step === 2 ? (
            <>
              <p class="muted">
                claudecord has no shared Claude credential — link your own subscription. On any
                machine with Claude Code installed:
              </p>
              <pre class="muted" style="padding:0.6rem;border-radius:6px;overflow-x:auto">
                claude setup-token
              </pre>
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
                {claudeState === "busy" ? "Validating…" : "Link Claude"}
              </button>
              {claudeMessage ? (
                <p class={claudeState === "error" ? "" : "muted"}>{claudeMessage}</p>
              ) : null}
            </>
          ) : null}

          {step === 3 ? (
            <>
              <p class="muted">
                Optional: link your own GitHub account so agentic runs act as you. Only matters if
                the server enables agentic mode.
              </p>
              {githubState === "idle" || githubState === "error" ? (
                <>
                  <button type="button" onClick={() => void startGithub()}>
                    Link GitHub
                  </button>{" "}
                  <button type="button" onClick={() => void skipGithub()}>
                    Skip
                  </button>
                  {githubMessage ? <p>{githubMessage}</p> : null}
                </>
              ) : null}
              {githubState === "starting" ? <p class="muted">Requesting a code…</p> : null}
              {githubState === "waiting" && deviceCode ? (
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
              ) : null}
              {githubState === "authorized" ? (
                <>
                  <p>✅ GitHub linked.</p>
                  <button type="button" onClick={() => props.onComplete()}>
                    Finish
                  </button>
                </>
              ) : null}
            </>
          ) : null}
        </Card>
      </div>
    </div>
  );
}
