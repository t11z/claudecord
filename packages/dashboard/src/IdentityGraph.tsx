import { useState } from "preact/hooks";

/**
 * Canonical GitHub mark (Octicons `mark-github`, 16×16 box). Used nominatively,
 * to say "this is your GitHub account" — the one third-party mark in the repo;
 * see the PR description.
 */
const GITHUB_MARK =
  "M8 0c4.42 0 8 3.58 8 8a8.013 8.013 0 0 1-5.45 7.59c-.4.08-.55-.17-.55-.38 0-.27.01-1.13.01-2.2 0-.75-.25-1.23-.54-1.48 1.78-.2 3.65-.88 3.65-3.95 0-.88-.31-1.59-.82-2.15.08-.2.36-1.02-.08-2.12 0 0-.66-.21-2.17.82a7.63 7.63 0 0 0-2-.27c-.68 0-1.36.09-2 .27-1.51-1.02-2.17-.82-2.17-.82-.44 1.1-.16 1.92-.08 2.12-.51.56-.82 1.28-.82 2.15 0 3.06 1.86 3.75 3.64 3.95-.23.2-.44.55-.51 1.07-.45.2-1.58.55-2.29-.66-.15-.24-.6-.83-1.23-.82-.67.01-.27.38.01.53.34.19.73.9.82 1.13.16.45.68 1.31 2.69.94 0 .67.01 1.3.01 1.49 0 .21-.15.45-.55.38A7.995 7.995 0 0 1 0 8c0-4.42 3.58-8 8-8Z";

/** The starburst from assets/logo.svg — origin-centred, so it drops into any translate(). */
const CLAUDE_STAR =
  "M0-14 2.8-3.9 13.3-4.3 4.6 1.5 8.2 11.3 0 4.8 -8.2 11.3 -4.6 1.5 -13.3-4.3 -2.8-3.9Z";

export interface IdentityGraphData {
  discord: { name: string; avatarUrl: string | null };
  claude: { linked: boolean; linkedAt: string | null };
  github: { linked: boolean; login: string | null; linkedAt: string | null };
  /** Shown on the open GitHub branch instead of the command, when linking can't work. */
  githubBlockedReason?: string | null;
  /** Denser variant for the admin list, where one of these renders per user. */
  compact?: boolean;
}

function shortDate(iso: string | null): string | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : new Date(t).toLocaleDateString();
}

/** Avatar, or the initial on a gradient tile when there is none / it fails to load. */
function DiscordAvatar(props: { name: string; avatarUrl: string | null }) {
  const [failed, setFailed] = useState(false);
  // The avatar is a Discord CDN URL — the one off-origin resource the dashboard
  // loads. Deliberate (see PR), but it must degrade: no network, no image.
  if (props.avatarUrl && !failed) {
    return (
      <img
        class="avatar"
        src={props.avatarUrl}
        alt=""
        loading="lazy"
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
      />
    );
  }
  return <div class="avatar fallback">{(props.name[0] ?? "?").toUpperCase()}</div>;
}

/**
 * One Discord identity and what's linked to it: a hub on the left, a branch to
 * Claude and a branch to GitHub, each ending in a mark and a label.
 *
 * Not a Sankey, despite looking like one: a Sankey encodes *quantity* in band
 * width and there is no quantity here, only linked / not linked. So the wires
 * are a uniform 2px and the state lives in the stroke style, the mark, and the
 * label — never in colour alone, which also keeps it readable under
 * forced-colors and for colour-blind readers.
 *
 * Text is real HTML, not SVG `<text>`: it stays selectable, respects the
 * reader's font size, and doesn't shrink with the container. Only the connector
 * curves are SVG.
 */
export function IdentityGraph(props: IdentityGraphData) {
  const { discord, claude, github } = props;

  const claudeLabel = claude.linked
    ? (shortDate(claude.linkedAt) ?? "linked")
    : "/link-claude link";
  const githubLabel = github.linked
    ? github.login
      ? `@${github.login}`
      : // verify.ts stores a token even when GitHub was unreachable, so a linked
        // identity legitimately has no login. Say so rather than "@unknown".
        "linked (name unknown)"
    : (props.githubBlockedReason ?? "/link-github link");

  return (
    <div class={`identity-graph ${props.compact ? "compact" : ""}`}>
      <div class="hub">
        <DiscordAvatar name={discord.name} avatarUrl={discord.avatarUrl} />
        <span class="who">{discord.name}</span>
      </div>

      {/*
        Connector layer, and its own grid column — so it always spans exactly the
        space between hub and branches, whatever those two measure. Positioning
        it absolutely with fixed offsets would come unstuck as soon as a label
        got long enough to widen the branch column.

        preserveAspectRatio="none" is safe precisely because these are abstract
        curves, not shapes: nothing is misread if they stretch.
        non-scaling-stroke keeps them exactly 2px regardless of that stretch.
      */}
      <svg class="wires" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        <path
          d="M 0,50 C 45,50 55,14 100,14"
          class={claude.linked ? "wire on" : "wire off"}
          vector-effect="non-scaling-stroke"
        />
        <path
          d="M 0,50 C 45,50 55,86 100,86"
          class={github.linked ? "wire on" : "wire off"}
          vector-effect="non-scaling-stroke"
        />
      </svg>

      <ul class="branches">
        <li class={claude.linked ? "leaf on" : "leaf off"}>
          <svg class="mark" viewBox="-16 -16 32 32" aria-hidden="true">
            <path d={CLAUDE_STAR} />
          </svg>
          <span class="label">
            <span class="what">Claude</span>
            <span class={claude.linked ? "detail" : "detail cmd"}>{claudeLabel}</span>
          </span>
        </li>
        <li class={github.linked ? "leaf on" : "leaf off"}>
          <svg class="mark" viewBox="0 0 16 16" aria-hidden="true">
            <path d={GITHUB_MARK} />
          </svg>
          <span class="label">
            <span class="what">GitHub</span>
            <span class={github.linked ? "detail" : "detail cmd"}>{githubLabel}</span>
          </span>
        </li>
      </ul>
    </div>
  );
}
