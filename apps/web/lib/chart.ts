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
  /** Shares bought and sold at a clearing (0 at the other steps). */
  buy_qty?: number | null;
  sell_qty?: number | null;
}

/** The base of the market index: every company counts as 1,000 points at its starting price. */
export const INDEX_BASE = 1_000;

/** A point of the market index: its level in hundredths of a point and the step it follows. */
export interface IndexPoint {
  level: number;
  kind: string;
  /** Shares traded across the market at this step (bought + sold). */
  volume: number;
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
  const volume: number[] = [];
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
      const k = list.length - 1;
      volume[k] = (volume[k] ?? 0) + Number(s.buy_qty ?? 0) + Number(s.sell_qty ?? 0);
    }
    after.set(s.company_id, list);
  }
  if (start.size === 0) return [];
  const ids = [...start.keys()];
  const full = Math.min(kinds.length, ...ids.map((id) => after.get(id)?.length ?? 0));
  const series: IndexPoint[] = [{ level: INDEX_BASE * 100, kind: "START", volume: 0 }];
  for (let k = 0; k < full; k++) {
    let sum = 0;
    for (const id of ids) sum += (after.get(id)![k]! / start.get(id)!) * INDEX_BASE * 100;
    series.push({ level: Math.round(sum / ids.length), kind: kinds[k]!, volume: volume[k] ?? 0 });
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

// ───────────────────────────── Candlesticks ─────────────────────────────

/**
 * One candle: a step's price before (open) and after (close). The market is blind, so no price exists between the
 * two and the candle has no wicks. Up steps are green, down steps red, an unchanged step a thin grey bar.
 */
export interface Candle {
  label: string;
  open: number;
  close: number;
  /** Shares traded at this step (bought + sold), drawn as a bar under the candle; null for none. */
  volume?: number | null;
  /** A second series drawn as a dashed line through the candles (the score-based price), or null. */
  second?: number | null;
  /** A short tag drawn above the step (Start, Crisis, Reveal, Close), or null. */
  marker?: string | null;
}

export interface PlacedCandle extends Candle {
  /** Centre x of the candle. */
  x: number;
  /** Top and bottom y of the body (at least 2 units apart, so an unchanged step still shows). */
  top: number;
  bottom: number;
  tone: "up" | "down" | "flat";
  /** The volume bar's top y (equal to `volBottom` for no volume). */
  volTop: number;
  /** The second series' y, or null. */
  y2: number | null;
}

export interface CandleGeometry {
  box: ChartBox;
  candles: PlacedCandle[];
  /** Body width. */
  width: number;
  /** The second series' path, broken where it has no value. */
  path2: string;
  yTicks: { y: number; value: number }[];
  min: number;
  max: number;
  /** The volume pane (empty when no candle has volume). */
  volTop: number;
  volBottom: number;
  maxVolume: number;
}

/** Candles from consecutive values: each step opens at the value before it (the first opens and closes at its own). */
export function candlesFrom(values: readonly number[], labels: readonly string[] = []): Candle[] {
  return values.map((v, i) => ({ label: labels[i] ?? `Step ${i + 1}`, open: i === 0 ? v : values[i - 1]!, close: v }));
}

/** Where every candle goes in `box`; the bottom fifth holds the volume bars when any candle has volume. */
export function candleGeometry(input: readonly Candle[], box: ChartBox, ticks = 4): CandleGeometry {
  const empty = { box, candles: [], width: 0, path2: "", yTicks: [], min: 0, max: 0, volTop: 0, volBottom: 0, maxVolume: 0 };
  if (input.length === 0) return empty;
  const values = input.flatMap((c) => [c.open, c.close, ...(c.second != null ? [c.second] : [])]);
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
  const maxVolume = Math.max(0, ...input.map((c) => c.volume ?? 0));
  const plotW = box.width - box.padLeft - box.padRight;
  const plotBottom = box.height - box.padBottom;
  const plotH = plotBottom - box.padTop;
  const volH = maxVolume > 0 ? round1(plotH * 0.2) : 0;
  const gap = volH > 0 ? round1(plotH * 0.05) : 0;
  const priceBottom = plotBottom - volH - gap;
  const priceH = priceBottom - box.padTop;
  const slot = plotW / input.length;
  const width = round1(Math.max(2, Math.min(slot * 0.62, 48)));
  const yAt = (v: number) => round1(box.padTop + priceH - ((v - min) / (max - min)) * priceH);
  const candles: PlacedCandle[] = input.map((c, i) => {
    const x = round1(box.padLeft + slot * (i + 0.5));
    const a = yAt(c.open);
    const b = yAt(c.close);
    let top = Math.min(a, b);
    let bottom = Math.max(a, b);
    if (bottom - top < 2) {
      const mid = (top + bottom) / 2;
      top = round1(mid - 1);
      bottom = round1(mid + 1);
    }
    const v = c.volume ?? 0;
    return {
      ...c,
      x,
      top,
      bottom,
      tone: c.close > c.open ? "up" : c.close < c.open ? "down" : "flat",
      volTop: maxVolume > 0 ? round1(plotBottom - (v / maxVolume) * volH) : plotBottom,
      y2: c.second != null ? yAt(c.second) : null,
    };
  });
  let path2 = "";
  let pen = false;
  for (const c of candles) {
    if (c.y2 === null) {
      pen = false;
      continue;
    }
    path2 += `${path2 ? " " : ""}${pen ? "L" : "M"}${c.x} ${c.y2}`;
    pen = true;
  }
  const yTicks: { y: number; value: number }[] = [];
  for (let v = min; v <= max; v += step) yTicks.push({ y: yAt(v), value: v });
  return { box, candles, width, path2, yTicks, min, max, volTop: plotBottom - volH, volBottom: plotBottom, maxVolume };
}

/** The index as candles: each step opens at the level before it; the volume is the market's shares traded. */
export function indexCandles(index: readonly IndexPoint[]): Candle[] {
  const points = indexChartPoints(index);
  return index.map((p, i) => ({
    label: points[i]!.label,
    open: i === 0 ? p.level : index[i - 1]!.level,
    close: p.level,
    volume: p.volume || null,
    marker: points[i]!.marker ?? null,
  }));
}
