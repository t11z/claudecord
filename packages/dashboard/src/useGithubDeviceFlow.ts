import { useEffect, useRef, useState } from "preact/hooks";
import { api } from "./api.ts";

export type GithubFlowState = "idle" | "starting" | "waiting" | "authorized" | "error";

export interface GithubDeviceFlow {
  state: GithubFlowState;
  message: string | null;
  /** The code and URL to show while waiting for the user to authorize on github.com. */
  device: { userCode: string; verificationUri: string } | null;
  start: () => void;
}

/**
 * The browser half of GitHub's OAuth Device Flow: ask for a code, show it, then
 * poll until GitHub says the user authorized it.
 *
 * Extracted because Welcome.tsx and Account.tsx each had their own copy and they
 * had already drifted — the Account one kept polling after unmount (no timer
 * ref), asserted the device code non-null, and left an unhandled rejection on a
 * network error mid-poll. One implementation, one place to fix.
 *
 * The interval is re-read from every response so GitHub's `slow_down` is
 * honoured, and the deadline is threaded through rather than re-derived.
 */
export function useGithubDeviceFlow(onAuthorized?: () => void): GithubDeviceFlow {
  const [state, setState] = useState<GithubFlowState>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [device, setDevice] = useState<{ userCode: string; verificationUri: string } | null>(null);
  const timer = useRef<number | null>(null);
  // Kept in a ref so a poll scheduled before unmount can't call a stale callback.
  const authorized = useRef(onAuthorized);
  authorized.current = onAuthorized;

  useEffect(() => {
    return () => {
      if (timer.current) window.clearTimeout(timer.current);
    };
  }, []);

  const poll = (deviceCode: string, intervalMs: number, deadline: number) => {
    timer.current = window.setTimeout(async () => {
      if (Date.now() > deadline) {
        setState("error");
        setMessage("The code expired. Try again.");
        setDevice(null);
        return;
      }
      try {
        const result = await api.pollMyGithubDevice(deviceCode);
        if (result.status === "authorized") {
          setState("authorized");
          setDevice(null);
          authorized.current?.();
        } else if (result.status === "error") {
          setState("error");
          setMessage(result.message ?? "Linking failed.");
          setDevice(null);
        } else {
          poll(deviceCode, (result.interval ?? intervalMs / 1000) * 1000, deadline);
        }
      } catch (err) {
        // Was an unhandled rejection in the Account.tsx copy.
        setState("error");
        setMessage(err instanceof Error ? err.message : String(err));
        setDevice(null);
      }
    }, intervalMs);
  };

  const start = () => {
    void (async () => {
      setState("starting");
      setMessage(null);
      try {
        const started = await api.startMyGithubDevice();
        if (!started.ok || !started.deviceCode || !started.userCode || !started.verificationUri) {
          setState("error");
          setMessage(started.message ?? "Couldn't start linking.");
          return;
        }
        setDevice({ userCode: started.userCode, verificationUri: started.verificationUri });
        setState("waiting");
        poll(
          started.deviceCode,
          (started.interval ?? 5) * 1000,
          Date.now() + (started.expiresIn ?? 900) * 1000,
        );
      } catch (err) {
        setState("error");
        setMessage(err instanceof Error ? err.message : String(err));
      }
    })();
  };

  return { state, message, device, start };
}
