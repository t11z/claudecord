import type { ComponentChildren } from "preact";

export function Card(props: { title?: string; children: ComponentChildren }) {
  return (
    <div class="card">
      {props.title ? <h2>{props.title}</h2> : null}
      {props.children}
    </div>
  );
}

export function Stat(props: { label: string; value: string | number }) {
  return (
    <div class="stat">
      <div class="label">{props.label}</div>
      <div class="value">{props.value}</div>
    </div>
  );
}

export function Badge(props: {
  kind: "ok" | "warn" | "danger" | "info";
  children: ComponentChildren;
}) {
  return <span class={`badge ${props.kind}`}>{props.children}</span>;
}

/** Tiny dependency-free sparkline for daily stats. */
export function Sparkline(props: { values: number[]; color?: string }) {
  const { values } = props;
  if (values.length === 0) return <div class="muted">no data yet</div>;
  const max = Math.max(...values, 1);
  const width = 100;
  const height = 30;
  const step = values.length > 1 ? width / (values.length - 1) : width;
  const points = values
    .map((v, i) => `${(i * step).toFixed(2)},${(height - (v / max) * (height - 2) - 1).toFixed(2)}`)
    .join(" ");
  return (
    <svg
      class="sparkline"
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      role="img"
      aria-label="activity sparkline"
    >
      <polyline
        points={points}
        fill="none"
        stroke={props.color ?? "var(--accent)"}
        stroke-width="1.5"
        stroke-linejoin="round"
        stroke-linecap="round"
      />
    </svg>
  );
}
