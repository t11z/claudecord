import { type JSX, render } from "preact";
import { useEffect, useState } from "preact/hooks";
import { api, type AuthUserDto, type MeDto } from "./api.ts";
import { Card } from "./components.tsx";
import { Access } from "./pages/Access.tsx";
import { Account } from "./pages/Account.tsx";
import { Overview } from "./pages/Overview.tsx";
import { Sessions } from "./pages/Sessions.tsx";
import { Setup } from "./pages/Setup.tsx";
import { Usage } from "./pages/Usage.tsx";
import { Welcome } from "./pages/Welcome.tsx";
import "./theme.css";

const ADMIN_ROUTES: { path: string; label: string; component: () => JSX.Element }[] = [
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

function SignOutButton(props: { class?: string }) {
  return (
    <button
      type="button"
      class={props.class}
      onClick={() => void api.logout().then(() => window.location.reload())}
    >
      Sign out
    </button>
  );
}

/** Layout for a signed-in member: no admin nav, just their own account page. */
function MemberLayout(props: { user: AuthUserDto | null; children: JSX.Element }) {
  return (
    <div class="layout">
      <nav class="sidebar">
        <div class="brand">
          <div class="brand-mark">C</div>
          <span>
            claude<strong>cord</strong>
          </span>
        </div>
        <div style="flex:1" />
        <span class="muted" style="padding:0 0.8rem;font-size:0.85em">
          {props.user?.globalName ?? props.user?.username}
        </span>
        <SignOutButton class="nav" />
        <a class="nav" href="https://t11z.github.io/claudecord/" target="_blank" rel="noreferrer">
          Docs ↗
        </a>
      </nav>
      <main class="main">{props.children}</main>
    </div>
  );
}

function MemberApp(props: { user: AuthUserDto | null }) {
  const [me, setMe] = useState<MeDto | null>(null);

  const reload = () => {
    setMe(null);
    api
      .me()
      .then(setMe)
      .catch(() => {});
  };

  useEffect(reload, []);

  if (!me) return <div class="login-wrap">Loading…</div>;
  if (!me.onboardingComplete) return <Welcome me={me} onComplete={reload} />;

  return (
    <MemberLayout user={props.user}>
      <Account me={me} onChange={reload} />
    </MemberLayout>
  );
}

function AdminApp(props: { user: AuthUserDto | null; hash: string }) {
  const route = ADMIN_ROUTES.find((r) => r.path === props.hash) ?? ADMIN_ROUTES[0]!;
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
        {ADMIN_ROUTES.map((r) => (
          <a key={r.path} class={`nav ${route.path === r.path ? "active" : ""}`} href={r.path}>
            {r.label}
          </a>
        ))}
        <div style="flex:1" />
        <span class="muted" style="padding:0 0.8rem;font-size:0.85em">
          {props.user?.globalName ?? props.user?.username}
        </span>
        <SignOutButton class="nav" />
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
  if (authState === "user") return <MemberApp user={user} />;
  return <AdminApp user={user} hash={hash} />;
}

render(<App />, document.getElementById("app")!);
