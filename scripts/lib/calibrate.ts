// How well the AI judge agrees with what a careful human would give: the pure part of `pnpm calibrate`
// (scripts/calibrate.ts). It takes each calibration sample's readings and reports, per sample and per round:
//
//   in band     the median lands inside the sample's expected range
//   spread      the gap between the highest and lowest reading (consistency)
//   rank order  Spearman correlation between the expected band's middle and the median (does it rank weak below strong?)
//   vs humans   when a panel scored the same samples: mean absolute difference, share within 10 points, Spearman
//
// and a verdict against fixed targets, so a prompt change can be checked like a model evaluation before the night.

import { SUBMISSION_TYPES, parseCsvObjects, type SubmissionType } from "@msim/engine";

export interface SampleReadings {
  sample_no: number;
  type: SubmissionType;
  title: string;
  expected: { min: number; max: number };
  /** Totals of the readings that finished (failed readings are left out). */
  totals: number[];
  /** Per rubric line, every finished reading's points. */
  lines: Record<string, number[]>;
  failed: number;
}

export interface SampleReport {
  sample_no: number;
  type: SubmissionType;
  title: string;
  expected: { min: number; max: number };
  totals: number[];
  median: number | null;
  spread: number | null;
  /** How far the median is outside the band (0 inside it); null until judged. */
  miss: number | null;
  verdict: "IN_BAND" | "LOW" | "HIGH" | "FAILED";
  /** The mean points per rubric line, rounded to one decimal. */
  lineMeans: Record<string, number>;
  human: number | null;
}

export interface TypeSummary {
  type: SubmissionType;
  samples: number;
  judged: number;
  inBand: number;
  meanMiss: number | null;
  meanSpread: number | null;
  maxSpread: number | null;
  /** Samples whose readings spread more than SPREAD_LIMIT points. */
  unstable: number;
  rankCorrelation: number | null;
  human: { samples: number; meanAbsDiff: number; within10: number; rankCorrelation: number | null } | null;
  checks: { name: string; ok: boolean; detail: string }[];
  pass: boolean;
}

/** The targets a round's judge must meet before the night. */
export const TARGETS = {
  /** Share of samples whose median lands in its band. */
  IN_BAND: 0.8,
  /** No sample may miss its band by more than this. */
  MAX_MISS: 10,
  /** Readings of one sample may differ by at most this. */
  SPREAD_LIMIT: 10,
  /** Spearman correlation between the expected order and the judge's order. */
  RANK: 0.85,
  /** Against a human panel: mean absolute difference at most this. */
  HUMAN_MAD: 10,
} as const;

const round1 = (x: number) => Math.round(x * 10) / 10;
const round2 = (x: number) => Math.round(x * 100) / 100;
const mean = (xs: readonly number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;

/** The median; for an even count, the mean of the middle two. */
export function median(xs: readonly number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

/** Ranks from 1, ties sharing the mean of their ranks. */
export function ranks(xs: readonly number[]): number[] {
  const order = xs.map((x, i) => ({ x, i })).sort((a, b) => a.x - b.x);
  const out = new Array<number>(xs.length);
  for (let k = 0; k < order.length; ) {
    let j = k;
    while (j + 1 < order.length && order[j + 1]!.x === order[k]!.x) j++;
    const r = (k + j) / 2 + 1;
    for (let t = k; t <= j; t++) out[order[t]!.i] = r;
    k = j + 1;
  }
  return out;
}

/** Spearman's rank correlation (Pearson on ranks); null with fewer than 3 pairs or no variation. */
export function spearman(a: readonly number[], b: readonly number[]): number | null {
  if (a.length !== b.length) throw new Error("spearman needs pairs");
  if (a.length < 3) return null;
  const ra = ranks(a);
  const rb = ranks(b);
  const ma = mean(ra);
  const mb = mean(rb);
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < ra.length; i++) {
    num += (ra[i]! - ma) * (rb[i]! - mb);
    da += (ra[i]! - ma) ** 2;
    db += (rb[i]! - mb) ** 2;
  }
  if (da === 0 || db === 0) return null;
  return round2(num / Math.sqrt(da * db));
}

export function sampleReport(s: SampleReadings, human: number | null = null): SampleReport {
  const med = median(s.totals);
  const spread = s.totals.length >= 2 ? Math.max(...s.totals) - Math.min(...s.totals) : s.totals.length === 1 ? 0 : null;
  const miss = med === null ? null : med < s.expected.min ? s.expected.min - med : med > s.expected.max ? med - s.expected.max : 0;
  const verdict: SampleReport["verdict"] =
    med === null ? "FAILED" : med < s.expected.min ? "LOW" : med > s.expected.max ? "HIGH" : "IN_BAND";
  const lineMeans = Object.fromEntries(Object.entries(s.lines).filter(([, v]) => v.length).map(([k, v]) => [k, round1(mean(v))]));
  return { sample_no: s.sample_no, type: s.type, title: s.title, expected: s.expected, totals: s.totals, median: med, spread, miss, verdict, lineMeans, human };
}

export function summarise(type: SubmissionType, reports: readonly SampleReport[]): TypeSummary {
  const mine = reports.filter((r) => r.type === type);
  const judged = mine.filter((r) => r.median !== null);
  const inBand = judged.filter((r) => r.verdict === "IN_BAND").length;
  const spreads = judged.map((r) => r.spread!).filter((x) => x !== null);
  const misses = judged.map((r) => r.miss!);
  const rank = spearman(
    judged.map((r) => (r.expected.min + r.expected.max) / 2),
    judged.map((r) => r.median!),
  );
  const withHuman = judged.filter((r) => r.human !== null);
  const human = withHuman.length
    ? {
        samples: withHuman.length,
        meanAbsDiff: round1(mean(withHuman.map((r) => Math.abs(r.median! - r.human!)))),
        within10: withHuman.filter((r) => Math.abs(r.median! - r.human!) <= 10).length,
        rankCorrelation: spearman(withHuman.map((r) => r.human!), withHuman.map((r) => r.median!)),
      }
    : null;
  const maxSpread = spreads.length ? Math.max(...spreads) : null;
  const maxMiss = misses.length ? Math.max(...misses) : null;
  const unstable = spreads.filter((x) => x > TARGETS.SPREAD_LIMIT).length;

  const checks: TypeSummary["checks"] = [];
  if (mine.length) {
    checks.push({ name: "every sample judged", ok: judged.length === mine.length, detail: `${judged.length}/${mine.length}` });
    checks.push({
      name: `at least ${TARGETS.IN_BAND * 100}% in band`,
      ok: judged.length > 0 && inBand / judged.length >= TARGETS.IN_BAND,
      detail: `${inBand}/${judged.length}`,
    });
    checks.push({ name: `no miss over ${TARGETS.MAX_MISS} points`, ok: maxMiss !== null && maxMiss <= TARGETS.MAX_MISS, detail: `worst ${maxMiss ?? "–"}` });
    checks.push({ name: `readings within ${TARGETS.SPREAD_LIMIT} points`, ok: unstable === 0, detail: `${unstable} unstable, widest ${maxSpread ?? "–"}` });
    checks.push({ name: `rank order ≥ ${TARGETS.RANK}`, ok: rank !== null && rank >= TARGETS.RANK, detail: `Spearman ${rank ?? "–"}` });
    if (human) checks.push({ name: `within ${TARGETS.HUMAN_MAD} points of humans on average`, ok: human.meanAbsDiff <= TARGETS.HUMAN_MAD, detail: `MAD ${human.meanAbsDiff}` });
  }
  return {
    type,
    samples: mine.length,
    judged: judged.length,
    inBand,
    meanMiss: misses.length ? round1(mean(misses)) : null,
    meanSpread: spreads.length ? round1(mean(spreads)) : null,
    maxSpread,
    unstable,
    rankCorrelation: rank,
    human,
    checks,
    pass: mine.length > 0 && checks.every((c) => c.ok),
  };
}

export function summariseAll(reports: readonly SampleReport[]): TypeSummary[] {
  return SUBMISSION_TYPES.filter((t) => reports.some((r) => r.type === t)).map((t) => summarise(t, reports));
}

/**
 * A human panel's scores for the samples: CSV with columns sample,judge,total (one row per judge per sample; sample is
 * the 1-based position in samples.json). The panel's score for a sample is the median of its judges.
 */
export function parseHumanCalibration(csv: string): { ok: true; scores: Map<number, number> } | { ok: false; errors: string[] } {
  const rows = parseCsvObjects(csv);
  const errors: string[] = [];
  const bySample = new Map<number, number[]>();
  rows.forEach((row, i) => {
    const where = `row ${i + 2}`;
    const sample = Number(row.sample);
    const total = Number(row.total);
    if (!Number.isInteger(sample) || sample < 1) errors.push(`${where}: sample must be a whole number from 1`);
    else if (!Number.isInteger(total) || total < 0 || total > 100) errors.push(`${where}: total must be a whole number 0–100`);
    else bySample.set(sample, [...(bySample.get(sample) ?? []), total]);
  });
  if (rows.length === 0) errors.push("the CSV has no rows (columns: sample,judge,total)");
  if (errors.length) return { ok: false, errors };
  return { ok: true, scores: new Map([...bySample].map(([k, v]) => [k, median(v)!])) };
}

/** A plain-text table for the terminal. */
export function formatReport(reports: readonly SampleReport[], summaries: readonly TypeSummary[]): string {
  const out: string[] = [];
  for (const s of summaries) {
    out.push(`\n${s.type === "PRD" ? "Round 1 · PRD" : "Round 2 · crisis solution"}`);
    out.push("  #  band     readings        median  spread  verdict   human  sample");
    for (const r of reports.filter((x) => x.type === s.type)) {
      const band = `${r.expected.min}–${r.expected.max}`.padEnd(8);
      const reads = r.totals.join(" ").padEnd(15);
      const med = String(r.median ?? "–").padStart(6);
      const spr = String(r.spread ?? "–").padStart(6);
      const v = (r.verdict === "IN_BAND" ? "ok" : r.verdict === "FAILED" ? "FAILED" : `${r.verdict} ${r.miss}`).padEnd(9);
      const h = String(r.human ?? "").padStart(5);
      out.push(`${String(r.sample_no).padStart(3)}  ${band} ${reads} ${med}  ${spr}  ${v} ${h}  ${r.title}`);
    }
    for (const c of s.checks) out.push(`  ${c.ok ? "PASS" : "FAIL"}  ${c.name} (${c.detail})`);
    if (s.human) out.push(`        vs humans: ${s.human.within10}/${s.human.samples} within 10 points, rank ${s.human.rankCorrelation ?? "–"}`);
    out.push(`  ${s.pass ? "READY" : "NOT READY"}: ${s.type} judge`);
  }
  return out.join("\n");
}

/** CSV of every sample, for a spreadsheet. */
export function reportCsv(reports: readonly SampleReport[]): string {
  const keys = [...new Set(reports.flatMap((r) => Object.keys(r.lineMeans)))];
  const head = ["sample", "type", "title", "min", "max", "readings", "median", "spread", "verdict", "human", ...keys];
  const q = (v: unknown) => {
    const s = String(v ?? "");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const rows = reports.map((r) =>
    [r.sample_no, r.type, r.title, r.expected.min, r.expected.max, r.totals.join(" "), r.median, r.spread, r.verdict, r.human, ...keys.map((k) => r.lineMeans[k] ?? "")]
      .map(q)
      .join(","),
  );
  return [head.join(","), ...rows].join("\n") + "\n";
}
