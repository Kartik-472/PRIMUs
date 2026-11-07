// Load on the database: 150 teams with four people on each login (600 screens, three times the 200 people the
// venue expects at once) hammer the hot functions at the same moment, through a small connection pool like the
// hosted pooler's, while the clock ticks. It checks that nothing deadlocks or errors, that every refusal is a
// proper game answer, and prints the latencies and the clearing time.
//
//   pnpm test:db supabase/tests/load.test.ts
//   LOAD_TEAMS=150 LOAD_MEMBERS=4 LOAD_POOL=20 pnpm test:db supabase/tests/load.test.ts

import { afterAll, beforeAll, describe, expect, test } from "vitest";
import pg from "pg";
import { createTestDb } from "./pg";
import { as, type Caller } from "./helpers";
import { Night, SEED } from "./night";

const TEAMS = Number(process.env.LOAD_TEAMS ?? 150);
const MEMBERS = Number(process.env.LOAD_MEMBERS ?? 4);
const POOL = Number(process.env.LOAD_POOL ?? 20);

let db: Awaited<ReturnType<typeof createTestDb>>;
let n: Night;
let load: pg.Pool;

beforeAll(async () => {
  db = await createTestDb();
  n = await Night.create(db.pool, TEAMS);
  // A separate pool sized like the hosted pooler: every simulated screen waits its turn for a connection.
  load = new pg.Pool({ connectionString: db.url, max: POOL });
  load.on("error", () => {});
}, 600_000);
afterAll(async () => {
  await load?.end();
  await db?.drop();
});

const pct = (xs: number[], p: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return Math.round(s[Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1))] ?? 0);
};
const stats = (xs: number[]) => ({ n: xs.length, p50: pct(xs, 50), p95: pct(xs, 95), p99: pct(xs, 99), max: pct(xs, 100) });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function timed(caller: Caller, fn: string, args: unknown[], lat: number[], errors: string[]) {
  const placeholders = args.map((_, i) => `$${i + 1}`).join(", ");
  const t = performance.now();
  try {
    const r = await as(load, caller, async (c) => (await c.query(`select public.${fn}(${placeholders}) as r`, args)).rows[0].r, { commit: true });
    lat.push(performance.now() - t);
    return r;
  } catch (err) {
    errors.push(`${fn}: ${(err as Error).message}`);
    return null;
  }
}

const prd = (i: number, words: number) => ({
  company_name: `Company ${i}`,
  ticker: `Z${String.fromCharCode(65 + (i % 26))}${String.fromCharCode(65 + Math.floor(i / 26) % 26)}${String.fromCharCode(65 + Math.floor(i / 676) % 26)}`,
  problem: Array.from({ length: words }, (_, k) => `w${k}`).join(" "),
  target_user: "Students.",
  must_have: "A pouch.",
  should_have: "Packs.",
  not_in_v1: "Subs.",
  per_pack_maths: "20 - 12 = 8.",
  go_to_market: "Campus.",
  success_metrics: "10k.",
  risks: "Copycats.",
});

describe(`load: ${TEAMS} teams × ${MEMBERS} screens through a pool of ${POOL}`, () => {
  test("Round 1 autosave storm: every member of every team saves the PRD while typing", async () => {
    await n.advanceTo("BRIEFING");
    await n.org("run_lottery", n.eventId, SEED, "4");
    await n.advanceTo("BUILD");

    const lat: number[] = [];
    const pingLat: number[] = [];
    const errors: string[] = [];
    const codes: Record<string, number> = {};
    const started = performance.now();
    const ticker = (async () => {
      while (performance.now() - started < 12_000) {
        await n.call(n.lead, "tick", n.eventId).catch((e) => errors.push(`tick: ${e.message}`));
        await sleep(1000);
      }
    })();
    // Each screen saves 6 times about every 2 s (autosave while typing), starting at a random moment, and pings once.
    await Promise.all(
      n.codes.flatMap((code, i) =>
        Array.from({ length: MEMBERS }, async (_, m) => {
          const who = n.team(code);
          let version = 0;
          await sleep(Math.random() * 2000);
          await timed(who, "ping", [crypto.randomUUID(), n.eventId, "team", "SUBSCRIBED"], pingLat, errors);
          for (let k = 0; k < 6; k++) {
            const r = await timed(who, "save_draft", ["PRD", prd(i, 50 + k * 20 + m), version], lat, errors);
            if (r) {
              codes[r.ok ? "OK" : r.code] = (codes[r.ok ? "OK" : r.code] ?? 0) + 1;
              version = r.ok ? r.draft.version : (r.draft?.version ?? version);
            }
            await sleep(1500 + Math.random() * 1000);
          }
        }),
      ),
    );
    await ticker;
    console.log("autosave", JSON.stringify({ saves: stats(lat), pings: stats(pingLat), results: codes, errors: errors.slice(0, 5), wallMs: Math.round(performance.now() - started) }));
    expect(errors).toEqual([]);
    // Every team ends with a saved PRD.
    expect((await n.one("select count(*)::int as c from drafts where event_id = $1 and type = 'PRD'", [n.eventId])).c).toBe(TEAMS);
    expect(pct(lat, 95)).toBeLessThan(1000);
  }, 600_000);

  test("Last minute of a trading round: every member places orders while the clock ticks; then the clearing", async () => {
    await n.advanceTo("JUDGING_1");
    await n.judgeAll("PRD");
    await n.advanceTo("CRISIS_QA");
    await n.advanceTo("RESCUE");
    await n.advanceTo("JUDGING_2");
    await n.judgeAll("SOLUTION");
    await n.advanceTo("MARKET_BLIND");
    await n.openRound(1);

    const companies = await n.q("select id, founder_team_id, rescuer_team_id from companies where event_id = $1", [n.eventId]);
    const lat: number[] = [];
    const errors: string[] = [];
    const codes: Record<string, number> = {};
    const started = performance.now();
    const ticker = (async () => {
      while (performance.now() - started < 8_000) {
        await n.call(n.lead, "tick", n.eventId).catch((e) => errors.push(`tick: ${e.message}`));
        await sleep(1000);
      }
    })();
    // Everyone in the final seconds: each screen places 2 orders in a 5-second window.
    await Promise.all(
      n.codes.flatMap((code) =>
        Array.from({ length: MEMBERS }, async () => {
          const teamId = n.teamId(code);
          const allowed = companies.filter((c) => c.founder_team_id !== teamId && c.rescuer_team_id !== teamId);
          for (let k = 0; k < 2; k++) {
            await sleep(Math.random() * 2500);
            const c = allowed[Math.floor(Math.random() * allowed.length)]!;
            const r = await timed(n.team(code), "place_order", [c.id, "BUY", 10 + Math.floor(Math.random() * 90), crypto.randomUUID()], lat, errors);
            if (r) codes[r.ok ? "OK" : r.code] = (codes[r.ok ? "OK" : r.code] ?? 0) + 1;
          }
        }),
      ),
    );
    await ticker;
    const result = await n.clearRound(1);
    await n.checkInvariants();
    const clearing = n.clearings.at(-1)!;
    console.log("orders", JSON.stringify({ orders: stats(lat), results: codes, errors: errors.slice(0, 5), clearing, filled: Object.keys(result.traders).length }));
    expect(errors).toEqual([]);
    expect(pct(lat, 95)).toBeLessThan(1000);
    expect(clearing.ms).toBeLessThan(5000);
  }, 600_000);
});
