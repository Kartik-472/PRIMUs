// Candlestick charts in plain SVG (geometry in lib/chart.ts candleGeometry). Each step of the night is one candle from
// the price before it to the price after it: green when it rose, red when it fell, a thin grey bar when unchanged.
// The market is blind between clearings, so a candle has no wicks. Shares traded show as volume bars underneath, and
// the score-based price can run through the candles as a dashed line. Colours come from the same CSS variables as the
// line chart, so the dark terminal screens redraw it in their palette. `live` pulses the latest candle: the page is
// re-read at every clearing, so the last candle is always the latest step.

import { axisMoney, candleGeometry, candlesFrom, type Candle, type ChartBox } from "@/lib/chart";
import { count, money } from "@/lib/format";

const BOX: ChartBox = { width: 720, height: 260, padLeft: 64, padRight: 16, padTop: 26, padBottom: 22 };

const C = {
  up: "var(--chart-up, #15803d)",
  down: "var(--chart-down, #b91c1c)",
  flat: "var(--chart-axis, #64748b)",
  grid: "var(--chart-grid, #e2e8f0)",
  axis: "var(--chart-axis, #64748b)",
  marker: "var(--chart-marker, #94a3b8)",
  markerText: "var(--chart-marker-text, #334155)",
  second: "var(--chart-second, #7c3aed)",
  volume: "var(--chart-volume, #cbd5e1)",
};

export function CandleChart({
  candles,
  label,
  secondName,
  testId,
  box = BOX,
  fontSize = 11,
  format = money,
  live = false,
  caption = true,
}: {
  candles: readonly Candle[];
  /** What the chart shows, e.g. "AQS price by step". */
  label: string;
  /** The dashed line's name in the legend (the score-based price), when the candles carry it. */
  secondName?: string;
  testId?: string;
  box?: ChartBox;
  fontSize?: number;
  /** How a value is written on the axis and in the tooltips (money by default). */
  format?: (value: number) => string;
  /** A pulsing ring round the latest candle. */
  live?: boolean;
  caption?: boolean;
}) {
  if (candles.length < 2) return null;
  const g = candleGeometry(candles, box);
  const tickStep = g.yTicks.length > 1 ? g.yTicks[1]!.value - g.yTicks[0]!.value : 1;
  const axis = format === money ? (v: number) => axisMoney(v, tickStep, g.max, money) : format;
  const first = candles[0]!;
  const lastC = candles.at(-1)!;
  const last = g.candles.at(-1)!;
  const tone = { up: C.up, down: C.down, flat: C.flat };
  return (
    <figure className="w-full" data-testid={testId}>
      <svg
        viewBox={`0 0 ${box.width} ${box.height}`}
        className="h-auto w-full"
        role="img"
        aria-label={`${label}: ${first.label} ${format(first.close)}, ${lastC.label} ${format(lastC.close)}, ${candles.length} steps.`}
      >
        {g.yTicks.map((t) => (
          <g key={t.value}>
            <line x1={box.padLeft} x2={box.width - box.padRight} y1={t.y} y2={t.y} stroke={C.grid} strokeWidth="1" />
            <text x={box.padLeft - 8} y={t.y + fontSize / 3} textAnchor="end" fontSize={fontSize} fill={C.axis}>
              {axis(t.value)}
            </text>
          </g>
        ))}
        {g.candles
          .filter((c) => c.marker)
          .map((c) => (
            <g key={`m-${c.x}`}>
              <line x1={c.x} x2={c.x} y1={box.padTop - 4} y2={g.volBottom} stroke={C.marker} strokeWidth="1" strokeDasharray="2 3" />
              <text x={c.x} y={box.padTop - 10} textAnchor="middle" fontSize={fontSize} fontWeight="600" fill={C.markerText}>
                {c.marker}
              </text>
            </g>
          ))}
        {g.maxVolume > 0
          ? g.candles.map((c) =>
              c.volTop < g.volBottom ? (
                <rect key={`v-${c.x}`} x={c.x - g.width / 2} y={c.volTop} width={g.width} height={g.volBottom - c.volTop} fill={C.volume} opacity="0.5">
                  <title>{`${c.label}: ${count(c.volume ?? 0)} shares traded`}</title>
                </rect>
              ) : null,
            )
          : null}
        {g.path2 ? <path d={g.path2} fill="none" stroke={C.second} strokeWidth={fontSize / 5.5} strokeDasharray="6 4" /> : null}
        {live ? (
          <rect
            x={last.x - g.width / 2 - 2}
            y={last.top - 2}
            width={g.width + 4}
            height={last.bottom - last.top + 4}
            fill="none"
            stroke={tone[last.tone]}
            strokeWidth="2"
            className="msim-live-candle"
            data-testid={testId ? `${testId}-live` : undefined}
          />
        ) : null}
        {g.candles.map((c) => (
          <rect key={`c-${c.x}`} x={c.x - g.width / 2} y={c.top} width={g.width} height={c.bottom - c.top} fill={tone[c.tone]}>
            <title>{`${c.label}: ${format(c.open)} → ${format(c.close)}${c.second != null && secondName ? ` · ${secondName} ${format(c.second)}` : ""}`}</title>
          </rect>
        ))}
      </svg>
      {caption ? (
        <figcaption className="mt-1 flex flex-wrap gap-x-4 text-xs text-slate-600">
          <span className="inline-flex items-center gap-1">
            <span className="inline-block h-2.5 w-1.5" style={{ background: C.up }} />
            <span className="inline-block h-2.5 w-1.5" style={{ background: C.down }} /> each step: price before → after
          </span>
          {g.maxVolume > 0 ? (
            <span className="inline-flex items-center gap-1">
              <span className="inline-block h-2 w-2 opacity-50" style={{ background: C.volume }} /> shares traded
            </span>
          ) : null}
          {secondName && g.path2 ? (
            <span className="inline-flex items-center gap-1">
              <span className="inline-block w-5 border-t-2 border-dashed" style={{ borderColor: C.second }} /> {secondName}
            </span>
          ) : null}
        </figcaption>
      ) : null}
    </figure>
  );
}

/** Small candles for a table row or a tile: one per step, from the values in order. */
export function MiniCandles({ values, label, width = 64, height = 20 }: { values: readonly number[]; label: string; width?: number; height?: number }) {
  if (values.length < 2) return <span className="text-xs text-slate-400">—</span>;
  const g = candleGeometry(candlesFrom(values), { width, height, padLeft: 0, padRight: 0, padTop: 1, padBottom: 1 }, 1);
  const tone = { up: C.up, down: C.down, flat: C.flat };
  return (
    <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} role="img" aria-label={label} className="shrink-0 overflow-visible">
      {g.candles.map((c) => (
        <rect key={c.x} x={c.x - g.width / 2} y={c.top} width={g.width} height={Math.max(1, c.bottom - c.top)} fill={tone[c.tone]} />
      ))}
    </svg>
  );
}
