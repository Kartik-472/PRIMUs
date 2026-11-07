// Tests the AI judge like a model evaluation, on an organiser's laptop, before the night: judges every calibration
// sample (prompts/calibration/samples.json) with the real model, exactly as on the night (same prompt, same request
// wrapper, injection lines removed, three readings), then reports how many medians land in their expected band, how
// consistent the readings are, whether the judge ranks weak work below strong work, and (with --human) how close it
// is to a human panel. Exits 1 when a round's judge misses a target (scripts/lib/calibrate.ts TARGETS).
//
//   pnpm calibrate [--type PRD|SOLUTION] [--slot PRIMARY|BACKUP] [--runs 3] [--human panel.csv] [--out reports/calibration]
//
// Needs only ANTHROPIC_API_KEY (and the JUDGE_* settings): no database. --human is a CSV of sample,judge,total (the
// sample number is its position in samples.json, as printed). JUDGE_FAKE=1 checks the plumbing without the API; its
// scores mean nothing. The control panel's calibration page is the same check run through the database queue.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { RUBRICS, SUBMISSION_TYPES, type SubmissionType } from "@msim/engine";
import { buildCalibrationRequest, createJudge, hasApiCredential, judgeConfig, loadCalibrationSamples, promptLoader, type JudgeSlot } from "../apps/web/lib/judge/index";
import { parseArgs } from "./lib/args";
import { formatReport, parseHumanCalibration, reportCsv, sampleReport, summariseAll, type SampleReadings } from "./lib/calibrate";

const USAGE = "usage: pnpm calibrate [--type PRD|SOLUTION] [--slot PRIMARY|BACKUP] [--runs 3] [--human panel.csv] [--out <folder>]";

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(USAGE);
    return 0;
  }
  const only = typeof args.type === "string" ? (args.type.toUpperCase() as SubmissionType) : null;
  if (only && !SUBMISSION_TYPES.includes(only)) throw new Error(`--type must be PRD or SOLUTION\n${USAGE}`);
  const slot: JudgeSlot = typeof args.slot === "string" && args.slot.toUpperCase() === "BACKUP" ? "BACKUP" : "PRIMARY";
  const runs = typeof args.runs === "string" ? Number(args.runs) : 3;
  if (!Number.isInteger(runs) || runs < 1 || runs > 9 || runs % 2 === 0) throw new Error("--runs must be an odd number from 1 to 9");

  const config = judgeConfig();
  if (!config.fake && !hasApiCredential()) throw new Error("ANTHROPIC_API_KEY is not set (or set JUDGE_FAKE=1 to test the plumbing)");
  const human = typeof args.human === "string" ? parseHumanCalibration(readFileSync(args.human, "utf8")) : null;
  if (human && !human.ok) throw new Error(`the human CSV has errors:\n  ${human.errors.join("\n  ")}`);

  const prompts = promptLoader();
  const judge = createJudge(config);
  const all = loadCalibrationSamples().map((s, i) => ({ ...s, sample_no: i + 1 }));
  const samples = all.filter((s) => !only || s.type === only);
  const models = Object.fromEntries(SUBMISSION_TYPES.map((t) => [t, config.fake ? "fake-judge" : config.models[t][slot]]));
  console.log(
    `Calibrating ${samples.length} samples × ${runs} readings with ${SUBMISSION_TYPES.filter((t) => samples.some((s) => s.type === t))
      .map((t) => `${t} → ${models[t]}`)
      .join(", ")} (effort ${config.effort}, ${config.concurrency} calls at a time).`,
  );

  // Every (sample, reading) is one job; run them with the configured concurrency.
  const readings: SampleReadings[] = samples.map((s) => ({
    sample_no: s.sample_no,
    type: s.type,
    title: s.title,
    expected: s.expected,
    totals: [],
    lines: Object.fromEntries(RUBRICS[s.type].map((l) => [l.key, [] as number[]])),
    failed: 0,
  }));
  const jobs = samples.flatMap((s, i) => Array.from({ length: runs }, (_, r) => ({ s, i, runNo: r + 1 })));
  let next = 0;
  let done = 0;
  let tokensIn = 0;
  let tokensOut = 0;
  const started = Date.now();
  const worker = async () => {
    for (;;) {
      const job = jobs[next++];
      if (!job) return;
      const { s, i, runNo } = job;
      const prompt = prompts(s.type);
      const req = buildCalibrationRequest(
        { run_id: `cal-${s.sample_no}-${runNo}`, sample_no: s.sample_no, type: s.type, ticker: s.ticker, company_name: s.company_name, context_text: s.context, text: s.text },
        prompt.text,
      );
      const res = await judge({ type: s.type, model: models[s.type]!, system: req.system, userText: req.userText, requestText: req.requestText, runNo });
      tokensIn += res.usage.input_tokens + res.usage.cache_read_input_tokens + res.usage.cache_creation_input_tokens;
      tokensOut += res.usage.output_tokens;
      const r = readings[i]!;
      if (res.ok) {
        r.totals.push(res.total);
        for (const [k, v] of Object.entries(res.breakdown)) r.lines[k]?.push(v);
      } else {
        r.failed++;
        console.error(`  sample ${s.sample_no} reading ${runNo} failed: ${res.error}`);
        if (res.fatal) throw new Error(`stopping: ${res.error}`);
      }
      done++;
      if (done % 10 === 0 || done === jobs.length) console.log(`  ${done}/${jobs.length} readings · ${((Date.now() - started) / 1000).toFixed(0)} s`);
    }
  };
  await Promise.all(Array.from({ length: Math.min(config.concurrency, jobs.length) }, worker));

  const reports = readings.map((r) => sampleReport(r, human?.ok ? (human.scores.get(r.sample_no) ?? null) : null));
  const summaries = summariseAll(reports);
  console.log(formatReport(reports, summaries));
  console.log(`\nTokens: ${tokensIn} in, ${tokensOut} out · ${((Date.now() - started) / 1000).toFixed(0)} s`);
  if (config.fake) console.log("FAKE JUDGE: these scores mean nothing; run again with ANTHROPIC_API_KEY.");

  const outDir = typeof args.out === "string" ? args.out : path.join("reports", "calibration");
  mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const prompt = (t: SubmissionType) => ({ file: prompts(t).file, sha: prompts(t).sha });
  writeFileSync(
    path.join(outDir, `${stamp}.json`),
    JSON.stringify({ at: new Date().toISOString(), slot, runs, models, fake: config.fake, prompts: Object.fromEntries(SUBMISSION_TYPES.map((t) => [t, prompt(t)])), summaries, reports }, null, 2),
  );
  writeFileSync(path.join(outDir, `${stamp}.csv`), reportCsv(reports));
  console.log(`Saved ${path.join(outDir, `${stamp}.json`)} and .csv`);
  return summaries.every((s) => s.pass) ? 0 : 1;
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  },
);
