import { describe, expect, test } from "vitest";
import { axisMoney, candleGeometry, candlesFrom, detailedCandles, detailedIndex, flowSlices, movingAverage, tradingWindow, chartGeometry, chartSummary, indexCandles, indexChartPoints, marketIndex, niceStep, sparkPath, type ChartBox } from "./chart";

const box: ChartBox = { width: 400, height: 200, padLeft: 50, padRight: 10, padTop: 10, padBottom: 30 };

describe("niceStep", () => {
  test("1, 2 or 5 × 10^k for about four ticks", () => {
    expect(niceStep(400)).toBe(100);
    expect(niceStep(700)).toBe(200);
    expect(niceStep(1600)).toBe(500);
    expect(niceStep(3)).toBe(1);
    expect(niceStep(0)).toBe(1);
  });
});

describe("chartGeometry", () => {
  test("no points: empty paths", () => {
    expect(chartGeometry([], box)).toMatchObject({ path: "", area: "", points: [] });
  });

  test("the first point sits on the left edge, the last on the right; higher values are higher up", () => {
    const g = chartGeometry(
      [
        { label: "IPO", value: 1050, marker: "IPO" },
        { label: "Round 1", value: 1100 },
        { label: "Round 2", value: 1000 },
      ],
      box,
    );
    expect(g.points.map((p) => p.x)).toEqual([50, 220, 390]);
    expect(g.points[1]!.y).toBeLessThan(g.points[0]!.y);
    expect(g.points[2]!.y).toBeGreaterThan(g.points[0]!.y);
    expect(g.path.startsWith("M50 ")).toBe(true);
    expect(g.area.endsWith("Z")).toBe(true);
    // Ticks span the data on round values.
    expect(g.min).toBeLessThanOrEqual(1000);
    expect(g.max).toBeGreaterThanOrEqual(1100);
    const step = g.yTicks[1]!.value - g.yTicks[0]!.value;
    expect(String(step)).toMatch(/^[125]0*$/);
    expect(g.yTicks.every((t) => t.value % step === 0)).toBe(true);
  });

  test("a flat series still gets a range; prices never tick below zero", () => {
    const g = chartGeometry([{ label: "IPO", value: 1000 }, { label: "Round 1", value: 1000 }], box);
    expect(g.max).toBeGreaterThan(g.min);
    expect(g.points[0]!.y).toBe(g.points[1]!.y);
    expect(chartGeometry([{ label: "a", value: 5 }], box).min).toBeGreaterThanOrEqual(0);
  });

  test("the second series breaks where it has no value", () => {
    const g = chartGeometry(
      [
        { label: "a", value: 1000, second: 1000 },
        { label: "b", value: 1100, second: null },
        { label: "c", value: 1200, second: 900 },
        { label: "d", value: 1300, second: 950 },
      ],
      box,
    );
    expect(g.path2.match(/M/g)).toHaveLength(2);
    expect(g.path2.match(/L/g)).toHaveLength(1);
    expect(g.points[1]!.y2).toBeNull();
  });
});

describe("sparkPath and summary", () => {
  test("a sparkline fills its box", () => {
    expect(sparkPath([1000, 1100, 1050], 60, 20)).toBe("M0 20 L30 0 L60 10");
    expect(sparkPath([], 60, 20)).toBe("");
    expect(sparkPath([5, 5], 60, 20)).toBe("M0 10 L60 10");
  });

  test("the summary names the first and last steps and the range", () => {
    const fmt = (c: number) => `$${(c / 100).toFixed(2)}`;
    expect(chartSummary([{ label: "IPO price", value: 1050 }, { label: "Round 1", value: 900 }, { label: "Round 2", value: 1263 }], fmt)).toBe(
      "IPO price $10.50, Round 2 $12.63; lowest $9.00, highest $12.63, 3 steps.",
    );
  });
});

describe("axisMoney", () => {
  const fmt = (c: number) => `$${(c / 100).toFixed(2)}`;
  test("prices stay exact; fund values read in thousands", () => {
    expect(axisMoney(1050, 50, 1200, fmt)).toBe("$10.50");
    expect(axisMoney(54_000_000, 2_000_000, 56_000_000, fmt)).toBe("$540k");
    expect(axisMoney(51_750_000, 50_000, 52_000_000, fmt)).toBe("$517.5k");
  });
});

describe("marketIndex", () => {
  const row = (company_id: string, kind: string, market_after: number) => ({ company_id, kind, market_after });

  test("starts at 1,000 and averages each company's price over its starting price", () => {
    const steps = [row("a", "START", 1000), row("b", "START", 2000), row("a", "CRISIS", 850), row("b", "CRISIS", 1700), row("a", "CLEARING", 1100), row("b", "CLEARING", 1800)];
    expect(marketIndex(steps)).toEqual([
      { level: 100_000, kind: "START", volume: 0 },
      { level: 85_000, kind: "CRISIS", volume: 0 },
      { level: 100_000, kind: "CLEARING", volume: 0 },
    ]);
  });

  test("draws a step only once every company has it, and lets an appeal correct the latest price", () => {
    const steps = [row("a", "START", 1000), row("b", "START", 1000), row("a", "CRISIS", 850), row("b", "CRISIS", 850), row("b", "APPEAL", 1050), row("a", "CLEARING", 900)];
    expect(marketIndex(steps)).toEqual([
      { level: 100_000, kind: "START", volume: 0 },
      { level: 95_000, kind: "CRISIS", volume: 0 },
    ]);
  });

  test("is empty before the starting prices", () => {
    expect(marketIndex([])).toEqual([]);
  });

  test("labels the points for the chart", () => {
    const pts = indexChartPoints([
      { level: 100_000, kind: "START", volume: 0 },
      { level: 85_000, kind: "CRISIS", volume: 0 },
      { level: 90_000, kind: "CLEARING", volume: 0 },
      { level: 91_000, kind: "CLEARING", volume: 0 },
    ]);
    expect(pts.map((p) => p.label)).toEqual(["Start", "Crisis", "Round 1", "Round 2"]);
    expect(pts[1]!.marker).toBe("Crisis");
  });
});

describe("candles", () => {
  test("open at the value before, close at the value", () => {
    expect(candlesFrom([100, 120, 90]).map((c) => [c.open, c.close])).toEqual([
      [100, 100],
      [100, 120],
      [120, 90],
    ]);
  });

  test("the index sums the shares traded at each step and opens each candle at the level before", () => {
    const row = (company_id: string, kind: string, market_after: number, buy_qty = 0, sell_qty = 0) => ({ company_id, kind, market_after, buy_qty, sell_qty });
    const index = marketIndex([row("a", "START", 1000), row("b", "START", 1000), row("a", "CLEARING", 1100, 30, 10), row("b", "CLEARING", 900, 5, 25)]);
    expect(index.at(-1)).toEqual({ level: 100_000, kind: "CLEARING", volume: 70 });
    const candles = indexCandles(index);
    expect(candles[1]).toMatchObject({ label: "Round 1", open: 100_000, close: 100_000, volume: 70 });
  });

  test("place up, down and unchanged steps, with volume bars in the bottom fifth", () => {
    const box: ChartBox = { width: 300, height: 200, padLeft: 0, padRight: 0, padTop: 0, padBottom: 0 };
    const g = candleGeometry(
      [
        { label: "a", open: 100, close: 100, volume: null },
        { label: "b", open: 100, close: 200, volume: 50 },
        { label: "c", open: 200, close: 150, volume: 100 },
      ],
      box,
    );
    expect(g.candles.map((c) => c.tone)).toEqual(["flat", "up", "down"]);
    expect(g.candles.map((c) => c.x)).toEqual([50, 150, 250]);
    expect(g.candles[0]!.bottom - g.candles[0]!.top).toBeGreaterThanOrEqual(2);
    expect(g.volBottom).toBe(200);
    expect(g.volTop).toBe(160);
    expect(g.candles[2]!.volTop).toBe(160);
    expect(g.candles[1]!.volTop).toBe(180);
    expect(g.candles[0]!.volTop).toBe(200);
  });
});

describe("detailed candles", () => {
  const steps = [
    { company_id: "c1", kind: "START", market_before: null, market_after: 1000, score_after: 1000 },
    { company_id: "c1", kind: "CRISIS", market_before: 1000, market_after: 850, score_after: 850 },
    { company_id: "c1", kind: "CLEARING", market_before: 850, market_after: 864, buy_qty: 3300, sell_qty: 800 },
  ];
  // Slice 0: +500 then −800 (running net 500, −300); slice 9: +2,000 (running net 1,700).
  const flow = flowSlices([
    [1, "c1", 0, 500, -300, -300, 1300],
    [1, "c1", 9, 1700, 1700, 1700, 2000],
  ]);

  test("a round draws as ten candles priced by the clearing rule, ending at the clearing price", () => {
    const c = detailedCandles(steps, flow);
    expect(c).toHaveLength(12);
    expect(c[2]).toMatchObject({ label: "Round 1 · 1/10", open: 850, high: 854, low: 847, close: 847, volume: 1300, marker: "R1", second: 850 });
    expect(c[3]).toMatchObject({ open: 847, close: 847, high: 847, low: 847, volume: null });
    expect(c[11]).toMatchObject({ open: 847, close: 864, high: 864, low: 847, volume: 2000 });
  });

  test("the index follows the companies candle by candle", () => {
    const idx = detailedIndex(steps, flow);
    expect(idx).toHaveLength(12);
    expect(idx[0]).toMatchObject({ open: 100_000, close: 100_000 });
    expect(idx.at(-1)).toMatchObject({ open: 84_700, close: 86_400, volume: 2000 });
  });

  test("the trading window starts at round 1 once it has cleared", () => {
    const c = detailedCandles(steps, flow);
    expect(tradingWindow(c)).toHaveLength(10);
    expect(tradingWindow(c.slice(0, 2))).toHaveLength(2);
  });

  test("moving average", () => {
    expect(movingAverage([1, 2, 3, 4], 2)).toEqual([null, 1.5, 2.5, 3.5]);
  });
});
