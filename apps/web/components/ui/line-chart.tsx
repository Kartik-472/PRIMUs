// A line chart in plain SVG (geometry in lib/chart.ts): the main series solid with a light area under it, an optional
// second series dashed, a few y ticks, and tags above the steps that matter (IPO, crisis, verdicts). It scales to its
// container's width. A <title> per point gives the exact value on hover; the chart carries a one-line summary for
// screen readers, and the page keeps a table with every value.
//
// Colours come from CSS variables with the light console's colours as fallbacks, so the dark terminal screens (.term,
// .term-stage in globals.css) redraw the same chart in their palette. `live` marks the latest point with a pulsing
// dot: the chart is redrawn at every broadcast (each clearing), so the last point is always the latest price.

import { axisMoney, chartGeometry, chartSummary, sparkPath, type ChartBox, type ChartPoint } from "@/lib/chart";
import { money } from "@/lib/format";

const BOX: ChartBox = { width: 720, height: 240, padLeft: 64, padRight: 16, padTop: 26, padBottom: 22 };

const C = {
  up: "var(--chart-up, #15803d)",
  down: "var(--chart-down, #b91c1c)",
  grid: "var(--chart-grid, #e2e8f0)",
  axis: "var(--chart-axis, #64748b)",
  marker: "var(--chart-marker, #94a3b8)",
  markerText: "var(--chart-marker-text, #334155)",
  second: "var(--chart-second, #7c3aed)",
};

export function LineChart({
  points,
  label,
  mainName,
  secondName,
  testId,
  box = BOX,
  fontSize = 11,
  format = money,
  live = false,
  caption = true,
}: {
  points: readonly ChartPoint[];
  /** What the chart shows, e.g. "AQS price by step". */
  label: string;
  mainName: string;
  secondName?: string;
  testId?: string;
  /** The drawing's size and margins (the projector draws larger). */
  box?: ChartBox;
  fontSize?: number;
  /** How a value is written on the axis and in the tooltips (money by default). */
  format?: (value: number) => string;
  /** A pulsing dot on the latest point. */
  live?: boolean;
  /** The legend under the chart. */
  caption?: boolean;
}) {
  if (points.length < 2) return null;
  const BOX = box;
  const g = chartGeometry(points, BOX);
  const bottom = BOX.height - BOX.padBottom;
  const up = points.at(-1)!.value >= points[0]!.value;
  const stroke = up ? C.up : C.down;
  const last = g.points.at(-1)!;
  const tickStep = g.yTicks.length > 1 ? g.yTicks[1]!.value - g.yTicks[0]!.value : 1;
  const fmt = format === money ? (v: number) => axisMoney(v, tickStep, g.max, money) : format;
  return (
    <figure className="w-full" data-testid={testId}>
      <svg viewBox={`0 0 ${BOX.width} ${BOX.height}`} className="h-auto w-full" role="img" aria-label={`${label}: ${chartSummary(points, format)}`}>
        {g.yTicks.map((t) => (
          <g key={t.value}>
            <line x1={BOX.padLeft} x2={BOX.width - BOX.padRight} y1={t.y} y2={t.y} stroke={C.grid} strokeWidth="1" />
            <text x={BOX.padLeft - 8} y={t.y + fontSize / 3} textAnchor="end" fontSize={fontSize} fill={C.axis}>
              {fmt(t.value)}
            </text>
          </g>
        ))}
        {g.points
          .filter((p) => p.marker)
          .map((p) => (
            <g key={`m-${p.x}`}>
              <line x1={p.x} x2={p.x} y1={BOX.padTop - 4} y2={bottom} stroke={C.marker} strokeWidth="1" strokeDasharray="2 3" />
              <text x={p.x} y={BOX.padTop - 10} textAnchor="middle" fontSize={fontSize} fontWeight="600" fill={C.markerText}>
                {p.marker}
              </text>
            </g>
          ))}
        <path d={g.area} fill={stroke} opacity="0.12" />
        {g.path2 ? <path d={g.path2} fill="none" stroke={C.second} strokeWidth="2" strokeDasharray="6 4" /> : null}
        <path d={g.path} fill="none" stroke={stroke} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
        {g.points.map((p) => (
          <circle key={`p-${p.x}`} cx={p.x} cy={p.y} r={fontSize / 3.6} fill={stroke}>
            <title>{`${p.label}: ${format(p.value)}${p.second != null && secondName ? ` · ${secondName} ${format(p.second)}` : ""}`}</title>
          </circle>
        ))}
        {live ? (
          <g data-testid={testId ? `${testId}-live` : undefined}>
            <circle cx={last.x} cy={last.y} r={fontSize / 2} fill={stroke} className="msim-live-ping" />
            <circle cx={last.x} cy={last.y} r={fontSize / 2.6} fill={stroke} />
          </g>
        ) : null}
      </svg>
      {caption ? (
      <figcaption className="mt-1 flex flex-wrap gap-x-4 text-xs text-slate-600">
        <span className="inline-flex items-center gap-1">
          <span className="inline-block h-0.5 w-5" style={{ background: stroke }} /> {mainName}
        </span>
        {secondName && g.path2 ? (
          <span className="inline-flex items-center gap-1">
            <span className="inline-block w-5 border-t-2 border-dashed border-violet-600" /> {secondName}
          </span>
        ) : null}
      </figcaption>
      ) : null}
    </figure>
  );
}

/** A small trend line for a table cell; green if the last value is at least the first, red otherwise. */
export function Sparkline({
  values,
  label,
  width = 64,
  height = 20,
  strokeWidth = 1.75,
}: {
  values: readonly number[];
  label: string;
  width?: number;
  height?: number;
  strokeWidth?: number;
}) {
  if (values.length < 2) return <span className="text-xs text-slate-400">—</span>;
  const up = values.at(-1)! >= values[0]!;
  return (
    <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} role="img" aria-label={label} className="shrink-0 overflow-visible">
      <path d={sparkPath(values, width, height)} fill="none" stroke={up ? C.up : C.down} strokeWidth={strokeWidth} strokeLinejoin="round" />
    </svg>
  );
}
