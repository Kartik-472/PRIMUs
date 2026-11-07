// Line charts drawn as plain SVG: the geometry (scales, ticks, paths) is computed here so it can be tested, and the
// components (components/ui/line-chart.tsx) only draw it. Values are integer cents; x is the step's index, so every
// round gets the same width whatever its length.

import { clearingPrice } from "@msim/engine";

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
 * One candle: open, close and, when known, the highest and lowest price in between (drawn as the wick). Up candles
 * are green, down candles red, an unchanged one a thin grey bar.
 */
export interface Candle {
  label: string;
  open: number;
  close: number;
  /** The highest and lowest price within the candle; the body's ends when left out. */
  high?: number | null;
  low?: number | null;
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
  /** The wick's ends: the high and the low. */
  wickTop: number;
  wickBottom: number;
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
  /** The moving average of the closes (`average` candles), from the first candle it has a full window for. */
  pathAverage: string;
  /** y of the last close, for the last-price line. */
  lastY: number;
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
export function candleGeometry(input: readonly Candle[], box: ChartBox, ticks = 4, average = 0): CandleGeometry {
  const empty = { box, candles: [], width: 0, path2: "", pathAverage: "", lastY: 0, yTicks: [], min: 0, max: 0, volTop: 0, volBottom: 0, maxVolume: 0 };
  if (input.length === 0) return empty;
  const values = input.flatMap((c) => [c.open, c.close, ...(c.high != null ? [c.high] : []), ...(c.low != null ? [c.low] : []), ...(c.second != null ? [c.second] : [])]);
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
  const width = round1(Math.max(1.5, Math.min(slot * 0.62, 48)));
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
      wickTop: Math.min(top, yAt(Math.max(c.open, c.close, c.high ?? c.close))),
      wickBottom: Math.max(bottom, yAt(Math.min(c.open, c.close, c.low ?? c.close))),
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
  const avg = average > 1 ? movingAverage(input.map((c) => c.close), average) : [];
  const pathAverage = candles
    .map((c, i) => (avg[i] == null ? null : `${c.x} ${yAt(avg[i]!)}`))
    .reduce<string>((d, p) => (p === null ? d : `${d}${d ? " L" : "M"}${p}`), "");
  const yTicks: { y: number; value: number }[] = [];
  for (let v = min; v <= max; v += step) yTicks.push({ y: yAt(v), value: v });
  return { box, candles, width, path2, pathAverage, lastY: yAt(input.at(-1)!.close), yTicks, min, max, volTop: plotBottom - volH, volBottom: plotBottom, maxVolume };
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

/** The average of each value and the n − 1 before it (null until there are n values). */
export function movingAverage(values: readonly number[], n: number): (number | null)[] {
  let sum = 0;
  return values.map((v, i) => {
    sum += v;
    if (i >= n) sum -= values[i - n]!;
    return i >= n - 1 ? sum / n : null;
  });
}

// ───────────────────────────── The detailed chart ─────────────────────────────

/** How many candles each cleared round is drawn as (public.round_flow's slices). */
export const ROUND_SLICES = 10;

/** A price step as the charts read it from round_prices (by id, so in the order of the night). */
export interface FlowStep {
  company_id: string;
  kind: string;
  market_before: number | null;
  market_after: number;
  buy_qty?: number | null;
  sell_qty?: number | null;
  /** The score-based price after this step, when the row carries it (drawn dashed, carried forward). */
  score_after?: number | null;
}

/** One slice of a cleared round for one company (public.round_flow): the running net demand's high, low and end. */
export interface FlowSlice {
  round: number;
  company_id: string;
  slice: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/** public.round_flow's rows ([round, company, slice, high, low, close, volume]) as slices. */
export function flowSlices(rows: readonly (readonly [number, string, number, number, number, number, number])[]): FlowSlice[] {
  return rows.map(([round, company_id, slice, high, low, close, volume]) => ({ round, company_id, slice, high: Number(high), low: Number(low), close: Number(close), volume: Number(volume) }));
}

const STEP_MARKERS: Record<string, string> = { CRISIS: "Crisis", REVEAL: "Reveal", CLOSE: "Close" };
const STEP_LABELS: Record<string, string> = { START: "Starting price", CRISIS: "Crisis", REVEAL: "Score reveal", CLOSE: "Closing price" };

/**
 * One company's night as detailed candles: one candle for each one-off step (start, crisis, reveal, close) and ten for
 * each cleared round. A round's slice runs from the price its running net demand pointed to at the slice's start to
 * the price at its end, with the wick at the highest and lowest point between; the price for a net demand is the
 * clearing rule on the price before the round, so the last slice ends at the round's clearing price exactly. A round
 * with no flow for a slice draws a flat candle there. Appeals correct the latest candle's close.
 */
export function detailedCandles(steps: readonly Omit<FlowStep, "company_id">[], flow: readonly FlowSlice[]): Candle[] {
  const byRound = new Map<string, FlowSlice>();
  for (const f of flow) byRound.set(`${f.round}:${f.slice}`, f);
  const out: Candle[] = [];
  let round = 0;
  let score: number | null = null;
  for (const s of steps) {
    const after = Number(s.market_after);
    if (s.score_after != null) score = Number(s.score_after);
    if (s.kind === "APPEAL") {
      const last = out.at(-1);
      if (last) {
        last.close = after;
        last.high = Math.max(last.high ?? after, after);
        last.low = Math.min(last.low ?? after, after);
      }
      continue;
    }
    if (s.kind !== "CLEARING") {
      const open = s.kind === "START" || s.market_before === null ? after : Number(s.market_before);
      out.push({ label: STEP_LABELS[s.kind] ?? s.kind, open, close: after, marker: STEP_MARKERS[s.kind] ?? null, second: score });
      continue;
    }
    round++;
    const before = Number(s.market_before ?? after);
    let net = 0;
    for (let k = 0; k < ROUND_SLICES; k++) {
      const f = byRound.get(`${round}:${k}`);
      const open = clearingPrice(before, net);
      const close = k === ROUND_SLICES - 1 ? after : clearingPrice(before, f ? f.close : net);
      const high = f ? Math.max(open, close, clearingPrice(before, f.high)) : Math.max(open, close);
      const low = f ? Math.min(open, close, clearingPrice(before, f.low)) : Math.min(open, close);
      out.push({ label: `Round ${round} · ${k + 1}/${ROUND_SLICES}`, open, close, high, low, volume: f ? f.volume : null, marker: k === 0 ? `R${round}` : null, second: score });
      if (f) net = f.close;
    }
  }
  return out;
}

/**
 * The candles from the first trading round on, once trading has begun: the start and the crisis (a 15% fall) would
 * otherwise set the scale and squeeze every round's candles into a thin band. Before round 1 clears, all of them.
 */
export function tradingWindow(candles: readonly Candle[]): Candle[] {
  const i = candles.findIndex((c) => c.marker === "R1");
  return i <= 0 ? [...candles] : candles.slice(i);
}

/**
 * The PRIMUS index as detailed candles: every company's detailed candles, each price over that company's starting
 * price × 1,000 (in hundredths of a point), averaged candle by candle. A candle's wick is the average of the
 * companies' highs and lows (the companies seldom peak at the same moment, so it is the market's typical range in
 * that slice). Volume is the market's shares traded.
 */
export function detailedIndex(steps: readonly FlowStep[], flow: readonly FlowSlice[]): Candle[] {
  const byCompany = new Map<string, FlowStep[]>();
  for (const s of steps) (byCompany.get(s.company_id) ?? byCompany.set(s.company_id, []).get(s.company_id)!).push(s);
  const flowBy = new Map<string, FlowSlice[]>();
  for (const f of flow) (flowBy.get(f.company_id) ?? flowBy.set(f.company_id, []).get(f.company_id)!).push(f);
  const series: Candle[][] = [];
  const starts: number[] = [];
  for (const [id, list] of byCompany) {
    const start = list.find((s) => s.kind === "START");
    if (!start || !(Number(start.market_after) > 0)) continue;
    series.push(detailedCandles(list, flowBy.get(id) ?? []));
    starts.push(Number(start.market_after));
  }
  if (series.length === 0) return [];
  const len = Math.min(...series.map((c) => c.length));
  const out: Candle[] = [];
  const pts = (v: number, i: number) => (v / starts[i]!) * INDEX_BASE * 100;
  for (let k = 0; k < len; k++) {
    let o = 0, c = 0, h = 0, l = 0, vol = 0;
    series.forEach((cs, i) => {
      const x = cs[k]!;
      o += pts(x.open, i);
      c += pts(x.close, i);
      h += pts(x.high ?? Math.max(x.open, x.close), i);
      l += pts(x.low ?? Math.min(x.open, x.close), i);
      vol += x.volume ?? 0;
    });
    const n = series.length;
    const first = series[0]![k]!;
    out.push({
      label: first.label,
      open: Math.round(o / n),
      close: Math.round(c / n),
      high: Math.round(h / n),
      low: Math.round(l / n),
      volume: vol || null,
      marker: first.marker ?? null,
    });
  }
  return out;
}
