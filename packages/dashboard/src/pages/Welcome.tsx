import { useState } from "preact/hooks";
import { api, type MeDto } from "../api.ts";
import { Card } from "../components.tsx";
import { GithubDeviceSteps } from "../GithubDeviceSteps.tsx";
import { IdentityGraph } from "../IdentityGraph.tsx";
import { useGithubDeviceFlow } from "../useGithubDeviceFlow.ts";

type ClaudeState = "idle" | "busy" | "error";

export function Welcome(props: { me: MeDto; onComplete: () => void }) {
  const { me } = props;
  const [step, setStep] = useState<1 | 2 | 3>(me.claude.linked ? 3 : 2);

  const [claudeToken, setClaudeToken] = useState("");
  const [claudeState, setClaudeState] = useState<ClaudeState>("idle");
  const [claudeMessage, setClaudeMessage] = useState<string | null>(null);

  const github = useGithubDeviceFlow();

  const submitClaude = async () => {
    setClaudeState("busy");
    setClaudeMessage(null);
    try {
      const result = await api.linkMyClaude(claudeToken);
      if (result.ok) {
        setClaudeToken("");
        setClaudeState("idle");
        setStep(3);
      } else {
        // Not in a `finally`: that used to reset to "idle" unconditionally and
        // clobbered this, so every error rendered as a muted note instead.
        setClaudeState("error");
        setClaudeMessage(result.message);
      }
    } catch (err) {
      setClaudeState("error");
      setClaudeMessage(err instanceof Error ? err.message : String(err));
    }
  };

  const skipGithub = async () => {
    await api.skipMyGithub().catch(() => {});
    props.onComplete();
  };

  // The server computes this with the same function it enforces with, so the
  // wording can never drift from what a link attempt would actually say.
  const githubBlocked = me.github.linkBlockedReason;

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
            <div class={`step ${github.state === "authorized" ? "done" : ""}`} />
          </div>

          {step === 1 || step >= 2 ? (
            <>
              <h2 style="margin-top:0">Signed in as {me.user.globalName ?? me.user.username}</h2>
              {me.guilds.length > 0 ? (
                <p class="muted">
                  Servers you share with the bot: {me.guilds.map((g) => g.name).join(", ")}.
                </p>
              ) : null}
              {/* Live status — the open branches double as the instructions. */}
              <IdentityGraph
                compact
                discord={{
                  name: me.user.globalName ?? me.user.username ?? me.user.id,
                  avatarUrl: me.user.avatarUrl,
                }}
                claude={{ linked: me.claude.linked, linkedAt: me.claude.linkedAt }}
                github={{ linked: me.github.linked, login: me.github.login, linkedAt: null }}
                githubBlockedReason={githubBlocked}
              />
            </>
          ) : null}

          {step === 2 ? (
            <>
              <p class="muted">
                Link your own Claude subscription. On any machine with Claude Code installed:
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
              <p class="muted">
                You can also run <code>/link-github link</code> in Discord.
              </p>
              {github.state === "idle" || github.state === "error" ? (
                <>
                  {/* Explained up front rather than discovered by clicking a
                      button that was always going to fail. */}
                  {githubBlocked ? <p class="muted">{githubBlocked}</p> : null}
                  {githubBlocked ? null : (
                    <>
                      <button type="button" onClick={github.start}>
                        Link GitHub
                      </button>{" "}
                    </>
                  )}
                  <button type="button" onClick={() => void skipGithub()}>
                    Skip
                  </button>
                  {github.message ? <p>{github.message}</p> : null}
                </>
              ) : null}
              {github.state === "starting" ? <p class="muted">Requesting a code…</p> : null}
              {github.state === "waiting" && github.device ? (
                <GithubDeviceSteps
                  userCode={github.device.userCode}
                  verificationUri={github.device.verificationUri}
                />
              ) : null}
              {github.state === "authorized" ? (
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
