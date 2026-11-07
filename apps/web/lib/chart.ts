// Line charts drawn as plain SVG: the geometry (scales, ticks, paths) is computed here so it can be tested, and the
// components (components/ui/line-chart.tsx) only draw it. Values are integer cents; x is the step's index, so every
// round gets the same width whatever its length.

export interface ChartPoint {
  /** Shown in the tooltip and the accessible summary, e.g. "Round 4". */
  label: string;
  /** Cents. */
  value: number;
  /** A second series drawn dashed (the AI price); null where it has no value. */
  second?: number | null;
  /** A short tag drawn above the step (IPO, Crisis, Plan, Flash, Close), or null. */
  marker?: string | null;
}

export interface ChartBox {
  width: number;
  height: number;
  padLeft: number;
  padRight: number;
  padTop: number;
  padBottom: number;
}

export interface PlacedPoint extends ChartPoint {
  x: number;
  y: number;
  /** The second series' y, or null. */
  y2: number | null;
}

export interface ChartGeometry {
  box: ChartBox;
  points: PlacedPoint[];
  /** "M x y L x y …" through every point, or "" with no points. */
  path: string;
  /** The second series' path, broken where it has no value. */
  path2: string;
  /** The area under the main line, closed along the bottom. */
  area: string;
  yTicks: { y: number; value: number }[];
  min: number;
  max: number;
}

/** A tick step of 1, 2 or 5 × 10^k cents that gives about `target` ticks over `span`. */
export function niceStep(span: number, target = 4): number {
  if (!(span > 0)) return 1;
  const raw = span / target;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const f = raw / pow;
  const m = f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10;
  return Math.max(1, Math.round(m * pow));
}

const round1 = (n: number) => Math.round(n * 10) / 10;

export function chartGeometry(input: readonly ChartPoint[], box: ChartBox, ticks = 4): ChartGeometry {
  const values = input.flatMap((p) => [p.value, ...(p.second != null ? [p.second] : [])]);
  if (values.length === 0) return { box, points: [], path: "", path2: "", area: "", yTicks: [], min: 0, max: 0 };
  let lo = Math.min(...values);
  let hi = Math.max(...values);
  if (hi === lo) {
    const pad = Math.max(10, Math.round(hi * 0.02));
    lo -= pad;
    hi += pad;
  }
  const step = niceStep(hi - lo, ticks);
  const min = Math.max(0, Math.floor(lo / step) * step);
  const max = Math.ceil(hi / step) * step;
  const plotW = box.width - box.padLeft - box.padRight;
  const plotH = box.height - box.padTop - box.padBottom;
  const xAt = (i: number) => round1(box.padLeft + (input.length === 1 ? plotW / 2 : (plotW * i) / (input.length - 1)));
  const yAt = (v: number) => round1(box.padTop + plotH - ((v - min) / (max - min)) * plotH);
  const points: PlacedPoint[] = input.map((p, i) => ({ ...p, x: xAt(i), y: yAt(p.value), y2: p.second != null ? yAt(p.second) : null }));
  const path = points.map((p, i) => `${i ? "L" : "M"}${p.x} ${p.y}`).join(" ");
  let path2 = "";
  let pen = false;
  for (const p of points) {
    if (p.y2 === null) {
      pen = false;
      continue;
    }
    path2 += `${path2 ? " " : ""}${pen ? "L" : "M"}${p.x} ${p.y2}`;
    pen = true;
  }
  const bottom = round1(box.padTop + plotH);
  const area = `${path} L${points.at(-1)!.x} ${bottom} L${points[0]!.x} ${bottom} Z`;
  const yTicks: { y: number; value: number }[] = [];
  for (let v = min; v <= max; v += step) yTicks.push({ y: yAt(v), value: v });
  return { box, points, path, path2, area, yTicks, min, max };
}

/** A y-axis label: exact money for prices, "$540k" once values reach $10,000 (whole thousands, or one decimal when the
 * ticks are closer than $1,000 apart). */
export function axisMoney(cents: number, stepCents: number, max: number, fmt: (cents: number) => string): string {
  if (max < 1_000_000) return fmt(cents);
  const k = cents / 100_000;
  return `$${stepCents < 100_000 ? k.toFixed(1) : Math.round(k).toLocaleString("en-US")}k`;
}

/** A sparkline path through the values, scaled to fill width × height (flat values draw a middle line). */
export function sparkPath(values: readonly number[], width: number, height: number): string {
  if (values.length === 0) return "";
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const y = (v: number) => round1(hi === lo ? height / 2 : height - ((v - lo) / (hi - lo)) * height);
  const x = (i: number) => round1(values.length === 1 ? width / 2 : (width * i) / (values.length - 1));
  return values.map((v, i) => `${i ? "L" : "M"}${x(i)} ${y(v)}`).join(" ");
}

/** One sentence for screen readers: first and last value and the range. */
export function chartSummary(points: readonly ChartPoint[], fmt: (cents: number) => string): string {
  if (points.length === 0) return "No values yet.";
  const first = points[0]!;
  const last = points.at(-1)!;
  const vals = points.map((p) => p.value);
  return `${first.label} ${fmt(first.value)}, ${last.label} ${fmt(last.value)}; lowest ${fmt(Math.min(...vals))}, highest ${fmt(Math.max(...vals))}, ${points.length} steps.`;
}

// ───────────────────────────── Market index ─────────────────────────────

/** One price step of a company, as round_prices stores it (an APPEAL step moves one company only). */
export interface IndexStep {
  company_id: string;
  kind: string;
  market_after: number;
}

/** The base of the market index: every company counts as 1,000 points at its starting price. */
export const INDEX_BASE = 1_000;

/** A point of the market index: its level in hundredths of a point and the step it follows. */
export interface IndexPoint {
  level: number;
  kind: string;
}

/**
 * The equal-weight market index after every market-wide step (start, crisis, reveal, each clearing, close): the
 * average over the companies of price ÷ starting price × 1,000, in hundredths of a point, so it starts at 1,000.00.
 * Steps are read in the order given (round_prices by id). Every company gets a row at each market-wide step; an
 * appeal step corrects its company's latest price instead of adding a step. A point is drawn only once every company
 * has its row for that step. Companies without a starting price are left out.
 */
export function marketIndex(steps: readonly IndexStep[]): IndexPoint[] {
  const start = new Map<string, number>();
  const after = new Map<string, number[]>();
  const kinds: string[] = [];
  let first: string | null = null;
  for (const s of steps) {
    const p = Number(s.market_after);
    if (s.kind === "START") {
      if (p > 0) start.set(s.company_id, p);
      first ??= s.company_id;
      continue;
    }
    const list = after.get(s.company_id) ?? [];
    if (s.kind === "APPEAL") {
      if (list.length) list[list.length - 1] = p;
    } else {
      list.push(p);
      if (s.company_id === first) kinds.push(s.kind);
    }
    after.set(s.company_id, list);
  }
  if (start.size === 0) return [];
  const ids = [...start.keys()];
  const full = Math.min(kinds.length, ...ids.map((id) => after.get(id)?.length ?? 0));
  const series: IndexPoint[] = [{ level: INDEX_BASE * 100, kind: "START" }];
  for (let k = 0; k < full; k++) {
    let sum = 0;
    for (const id of ids) sum += (after.get(id)![k]! / start.get(id)!) * INDEX_BASE * 100;
    series.push({ level: Math.round(sum / ids.length), kind: kinds[k]! });
  }
  return series;
}

const INDEX_MARKERS: Record<string, string> = { CRISIS: "Crisis", REVEAL: "Reveal", CLOSE: "Close" };

/** The index as chart points: "Start", "Crisis", "Score reveal", "Round 1"…, "Close", with tags on the big steps. */
export function indexChartPoints(index: readonly IndexPoint[]): ChartPoint[] {
  let round = 0;
  return index.map((p) => {
    const label =
      p.kind === "START" ? "Start" : p.kind === "CRISIS" ? "Crisis" : p.kind === "REVEAL" ? "Score reveal" : p.kind === "CLOSE" ? "Close" : `Round ${++round}`;
    return { label, value: p.level, marker: INDEX_MARKERS[p.kind] ?? null };
  });
}

/** An index level (hundredths of a point) as "1,034.27". */
export function indexText(level: number): string {
  return (level / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
