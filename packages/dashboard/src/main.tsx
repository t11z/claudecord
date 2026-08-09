import { type JSX, render } from "preact";
import { useEffect, useState } from "preact/hooks";
import { type AuthUserDto, api } from "./api.ts";
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

/** There is no password login anymore — the only door in is a `/dashboard` magic link. */
function SignedOut() {
  return (
    <div class="login-wrap">
      <div class="login-card">
        <Card>
          <div class="brand" style="padding:0 0 0.8rem">
            <div class="brand-mark">C</div>
            <strong>claudecord</strong>
          </div>
          <p>
            Run <code>/dashboard</code> in a Discord server the bot is in — it'll reply with a
            one-time sign-in link.
          </p>
        </Card>
      </div>
    </div>
  );
}

/**
 * Placeholder for a signed-in, non-admin user. The self-service pages
 * (link your own Claude/GitHub, see your own usage) land in a follow-up —
 * every existing page in this app manages the whole instance, so a plain
 * user has nowhere to go yet.
 */
function NoAdminAccess(props: { user: AuthUserDto | null }) {
  return (
    <div class="login-wrap">
      <div class="login-card">
        <Card>
          <p>Signed in as {props.user?.globalName ?? props.user?.username ?? "you"}.</p>
          <p class="muted">
            The self-service dashboard for regular members isn't built yet — ask an admin to link
            you, or check back soon.
          </p>
          <button
            type="button"
            onClick={() => void api.logout().then(() => window.location.reload())}
          >
            Sign out
          </button>
        </Card>
      </div>
    </div>
  );
}

function App() {
  const hash = useHashRoute();
  const [authState, setAuthState] = useState<"loading" | "signed-out" | "user" | "admin">(
    "loading",
  );
  const [user, setUser] = useState<AuthUserDto | null>(null);

  useEffect(() => {
    api
      .session()
      .then((s) => {
        setUser(s.user);
        setAuthState(s.user === null ? "signed-out" : s.isAdmin ? "admin" : "user");
      })
      .catch(() => setAuthState("signed-out"));
  }, []);

  if (authState === "loading") return <div class="login-wrap">Loading…</div>;
  if (authState === "signed-out") return <SignedOut />;
  if (authState === "user") return <NoAdminAccess user={user} />;

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
        <span class="muted" style="padding:0 0.8rem;font-size:0.85em">
          {user?.globalName ?? user?.username}
        </span>
        <button
          type="button"
          class="nav"
          onClick={() => void api.logout().then(() => window.location.reload())}
        >
          Sign out
        </button>
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
