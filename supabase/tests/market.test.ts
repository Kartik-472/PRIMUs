// The Round 3 market model in the database: the committed market seed, news that moves prices, the model switch.
// Clearing prices themselves are checked against the engine by Night.clearRound in every night test.

import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { marketZ, sha256Hex } from "@msim/engine";
import { createTestDb } from "./pg";
import { rowsAs } from "./helpers";
import { Night, SEED } from "./night";

let db: Awaited<ReturnType<typeof createTestDb>>;
beforeAll(async () => {
  db = await createTestDb();
});
afterAll(async () => {
  await db.drop();
});

async function toMarket(teams = 4) {
  const n = await Night.create(db.pool, teams);
  await n.advanceTo("BRIEFING");
  await n.org("run_lottery", n.eventId, SEED, "2");
  await n.advanceTo("BUILD");
  for (const c of n.codes) await n.save(c, "PRD", { problem: "A real problem." });
  await n.advanceTo("JUDGING_1");
  await n.judgeAll("PRD");
  await n.advanceTo("RESCUE");
  for (const c of n.codes) await n.save(c, "SOLUTION", { diagnosis: "A diagnosis." });
  await n.advanceTo("JUDGING_2");
  await n.judgeAll("SOLUTION");
  await n.advanceTo("MARKET_BLIND");
  return n;
}

describe("market model", () => {
  test("the market seed: committed before Round 3, hidden from teams and the projector, its hash public", async () => {
    const n = await toMarket();
    const r = await n.ok(n.lead, "market_seed_commitment", n.eventId);
    const seed = (await n.one("select seed from market_secrets where event_id = $1", [n.eventId])).seed;
    expect(r.commitment).toBe(sha256Hex(seed));
    // Asking again keeps the same seed.
    expect((await n.ok(n.lead, "market_seed_commitment", n.eventId)).commitment).toBe(r.commitment);
    const team = n.team(n.codes[0]!);
    expect(await n.call(team, "market_seed_commitment", n.eventId).catch((e: Error) => e.message)).toMatch(/organis/i);
    expect(await rowsAs(db.pool, team, "select market_seed_commitment, market_seed_revealed from events where id = $1", [n.eventId]))
      .toEqual([{ market_seed_commitment: r.commitment, market_seed_revealed: null }]);
    expect(await rowsAs(db.pool, team, "select * from market_secrets")).toEqual([]);
  });

  test("news is hidden until its round clears, then published with its shock inside the move", async () => {
    const n = await toMarket();
    const companies = await n.q("select id, crisis_card_id, market_price from companies where event_id = $1 order by id", [n.eventId]);
    const target = companies[0]!;
    await n.openRound(1);
    const res = await n.ok(n.lead, "schedule_news", n.eventId, 1, "Regulator probes the sector", "Fines expected.", "CRISIS", target.crisis_card_id, -400);
    expect(res.bulletin.published_at).toBeNull();
    expect(await n.call(n.lead, "schedule_news", n.eventId, 1, "x", "", "MARKET", null, 0).catch((e: Error) => e.message)).toMatch(/not zero/);
    const team = n.team(n.codes[0]!);
    expect(await rowsAs(db.pool, team, "select id from bulletins where id = $1", [res.bulletin.id])).toEqual([]);

    await n.clearRound(1); // checks every price against the engine, news included
    const b = await n.one("select published_at from bulletins where id = $1", [res.bulletin.id]);
    expect(b.published_at).not.toBeNull();
    expect(await rowsAs(db.pool, team, "select id from bulletins where id = $1", [res.bulletin.id])).toHaveLength(1);
    const rp = await n.one("select parts, move_ppm from round_prices where company_id = $1 and kind = 'CLEARING'", [target.id]);
    expect(Number(rp.parts.news)).toBe(-0.04);
    const seed = (await n.one("select seed from market_secrets where event_id = $1", [n.eventId])).seed;
    expect(Number(rp.parts.own)).toBeCloseTo(0.007 * marketZ(seed, 1, `company:${target.id}`), 6);
    // Once released it cannot be cancelled; a round that has closed takes no more news.
    expect(await n.call(n.lead, "cancel_news", res.bulletin.id)).toMatchObject({ ok: false, code: "NOT_FOUND" });
    expect(await n.call(n.lead, "schedule_news", n.eventId, 1, "Late", "", "MARKET", null, 100)).toMatchObject({ ok: false, code: "TOO_LATE" });
  });

  test("SIMPLE switches back to the original rule; the model is locked once a round has cleared", async () => {
    const n = await toMarket();
    await n.ok(n.lead, "set_market_model", n.eventId, "SIMPLE");
    await n.openRound(1);
    await n.clearRound(1);
    const moves = await n.q("select move_ppm, parts from round_prices where event_id = $1 and kind = 'CLEARING'", [n.eventId]);
    expect(moves.every((m) => m.move_ppm === 0 && m.parts === null)).toBe(true);
    expect(await n.call(n.lead, "set_market_model", n.eventId, "REALISTIC")).toMatchObject({ ok: false, code: "TOO_LATE" });
  });
});
