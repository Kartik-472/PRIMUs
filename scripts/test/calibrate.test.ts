import { expect, test } from "vitest";
import { formatReport, median, parseHumanCalibration, ranks, reportCsv, sampleReport, spearman, summarise, type SampleReadings } from "../lib/calibrate";

const sample = (n: number, type: "PRD" | "SOLUTION", min: number, max: number, totals: number[]): SampleReadings => ({
  sample_no: n,
  type,
  title: `sample ${n}`,
  expected: { min, max },
  totals,
  lines: { problem_user: totals.map((t) => Math.round(t / 5)) },
  failed: 0,
});

test("median, ranks with ties, Spearman", () => {
  expect(median([3, 1, 2])).toBe(2);
  expect(median([4, 1, 2, 3])).toBe(2.5);
  expect(median([])).toBeNull();
  expect(ranks([10, 20, 20, 5])).toEqual([2, 3.5, 3.5, 1]);
  expect(spearman([1, 2, 3, 4], [10, 20, 30, 40])).toBe(1);
  expect(spearman([1, 2, 3, 4], [40, 30, 20, 10])).toBe(-1);
  expect(spearman([1, 2], [1, 2])).toBeNull();
  expect(spearman([1, 1, 1], [1, 2, 3])).toBeNull();
});

test("a sample: median against the band, how far it misses, spread", () => {
  expect(sampleReport(sample(1, "PRD", 60, 80, [70, 72, 69]))).toMatchObject({ median: 70, spread: 3, miss: 0, verdict: "IN_BAND" });
  expect(sampleReport(sample(2, "PRD", 60, 80, [50, 55, 52]))).toMatchObject({ median: 52, miss: 8, verdict: "LOW" });
  expect(sampleReport(sample(3, "PRD", 5, 30, [41, 35, 38]))).toMatchObject({ median: 38, miss: 8, verdict: "HIGH" });
  expect(sampleReport({ ...sample(4, "PRD", 5, 30, []), failed: 3 })).toMatchObject({ median: null, verdict: "FAILED" });
});

test("a round passes when its medians land in band, readings agree and the order is right", () => {
  const good = [
    sample(1, "PRD", 5, 30, [18, 20, 22]),
    sample(2, "PRD", 25, 50, [38, 40, 41]),
    sample(3, "PRD", 60, 80, [70, 71, 74]),
    sample(4, "PRD", 78, 95, [86, 88, 90]),
  ].map((s) => sampleReport(s));
  const s = summarise("PRD", good);
  expect(s).toMatchObject({ samples: 4, judged: 4, inBand: 4, rankCorrelation: 1, unstable: 0, pass: true });

  // Readings 25 points apart and the weak sample scored above the strong one: not ready.
  const bad = [
    sample(1, "PRD", 5, 30, [60, 35, 50]),
    sample(2, "PRD", 25, 50, [38, 40, 41]),
    sample(3, "PRD", 60, 80, [30, 32, 33]),
  ].map((s) => sampleReport(s));
  const b = summarise("PRD", bad);
  expect(b.pass).toBe(false);
  expect(b.checks.filter((c) => !c.ok).map((c) => c.name)).toEqual([
    "at least 80% in band",
    "no miss over 10 points",
    "readings within 10 points",
    "rank order ≥ 0.85",
  ]);
  expect(summarise("SOLUTION", bad)).toMatchObject({ samples: 0, pass: false });
});

test("against a human panel: the median of the panel's judges, the gap and the order", () => {
  const panel = parseHumanCalibration("sample,judge,total\n1,1,20\n1,2,24\n1,3,22\n2,1,45\n3,1,70\n4,1,90\n");
  expect(panel.ok).toBe(true);
  if (!panel.ok) return;
  expect(panel.scores.get(1)).toBe(22);
  const reports = [
    sample(1, "PRD", 5, 30, [18, 20, 22]),
    sample(2, "PRD", 25, 50, [38, 40, 41]),
    sample(3, "PRD", 60, 80, [70, 71, 74]),
    sample(4, "PRD", 78, 95, [86, 88, 90]),
  ].map((s) => sampleReport(s, panel.scores.get(s.sample_no) ?? null));
  const s = summarise("PRD", reports);
  expect(s.human).toEqual({ samples: 4, meanAbsDiff: 2.5, within10: 4, rankCorrelation: 1 });
  expect(s.checks.at(-1)).toMatchObject({ ok: true });
  expect(formatReport(reports, [s])).toMatch(/READY: PRD judge/);
  expect(reportCsv(reports).split("\n")[0]).toBe("sample,type,title,min,max,readings,median,spread,verdict,human,problem_user");

  const broken = parseHumanCalibration("sample,judge,total\n0,1,20\n2,1,101\n");
  expect(broken).toEqual({ ok: false, errors: ["row 2: sample must be a whole number from 1", "row 3: total must be a whole number 0–100"] });
});
