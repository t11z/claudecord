import { type JSX, render } from "preact";
import { useEffect, useState } from "preact/hooks";
import { api } from "./api.ts";
import { Card } from "./components.tsx";
import { Access } from "./pages/Access.tsx";
import { Overview } from "./pages/Overview.tsx";
import { Sessions } from "./pages/Sessions.tsx";
import { Setup } from "./pages/Setup.tsx";
import { Usage } from "./pages/Usage.tsx";
import "./theme.css";

const ROUTES: { path: string; label: string; component: () => JSX.Element }[] = [
  { path: "#/", label: "Overview", component: Overview },
  { path: "#/setup", label: "Setup", component: Setup },
  { path: "#/access", label: "Access control", component: Access },
  { path: "#/sessions", label: "Sessions", component: Sessions },
  { path: "#/usage", label: "Usage", component: Usage },
];

function useHashRoute(): string {
  const [hash, setHash] = useState(window.location.hash || "#/");
  useEffect(() => {
    const onChange = () => setHash(window.location.hash || "#/");
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return hash;
}

function Login(props: { onSuccess: () => void }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: Event) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.login(password);
      props.onSuccess();
    } catch {
      setError("Wrong password.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div class="login-wrap">
      <div class="login-card">
        <Card>
          <div class="brand" style="padding:0 0 0.8rem">
            <div class="brand-mark">C</div>
            <strong>claudecord</strong>
          </div>
          <form onSubmit={(e) => void submit(e)}>
            <label class="field">
              <span>Dashboard password</span>
              <input
                type="password"
                value={password}
                onInput={(e) => setPassword((e.target as HTMLInputElement).value)}
              />
            </label>
            <button type="submit" disabled={busy || password.length === 0}>
              {busy ? "Signing in…" : "Sign in"}
            </button>
            {error ? <p>{error}</p> : null}
          </form>
        </Card>
      </div>
    </div>
  );
}

function App() {
  const hash = useHashRoute();
  const [authState, setAuthState] = useState<"loading" | "login" | "ready">("loading");

  useEffect(() => {
    api
      .authRequired()
      .then((r) => setAuthState(!r.required || r.authenticated ? "ready" : "login"))
      .catch(() => setAuthState("ready"));
  }, []);

  if (authState === "loading") return <div class="login-wrap">Loading…</div>;
  if (authState === "login") return <Login onSuccess={() => setAuthState("ready")} />;

  const route = ROUTES.find((r) => r.path === hash) ?? ROUTES[0]!;
  const Page = route.component;

  return (
    <div class="layout">
      <nav class="sidebar">
        <div class="brand">
          <div class="brand-mark">C</div>
          <span>
            claude<strong>cord</strong>
          </span>
        </div>
        {ROUTES.map((r) => (
          <a key={r.path} class={`nav ${route.path === r.path ? "active" : ""}`} href={r.path}>
            {r.label}
          </a>
        ))}
        <div style="flex:1" />
        <a class="nav" href="https://t11z.github.io/claudecord/" target="_blank" rel="noreferrer">
          Docs ↗
        </a>
      </nav>
      <main class="main">
        <Page />
      </main>
    </div>
  );
}

render(<App />, document.getElementById("app")!);
