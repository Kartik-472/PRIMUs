// Full control of every round (migration 051): in manual mode with "every step waits", each step of the current phase
// is held two minutes away until the organiser starts it; an open trading window stays open meanwhile; the next
// trading window can be opened now.

import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { sha256Hex } from "@msim/engine";
import { Night } from "./night";
import { createTestDb } from "./pg";

let db: Awaited<ReturnType<typeof createTestDb>>;
beforeAll(async () => {
  db = await createTestDb();
});
afterAll(async () => {
  await db?.drop();
});

const ms = (v: string | Date) => new Date(v).getTime();

describe("full control", () => {
  test("every step waits for the organiser; the next trading window opens now", async () => {
    const n = await Night.create(db.pool, 3, "PRIMUS");
    const at = async (code: string) => ms((await n.one("select at from deadlines where event_id = $1 and code = $2", [n.eventId, code])).at);
    const sub = async (k: number) => n.one("select * from subrounds where event_id = $1 and k = $2", [n.eventId, k]);

    // Not before manual mode.
    expect((await n.call(n.lead, "set_hold_steps", n.eventId, true)).code).toBe("NOT_MANUAL");

    const seed = sha256Hex("full");
    await n.org("set_seed_commitment", n.eventId, sha256Hex(seed));
    await n.advanceTo("SQUAD_DRAW");
    await n.org("run_lottery", n.eventId, seed, "3");
    const squads = [await n.squad(1), await n.squad(2), await n.squad(3)];
    await n.advanceTo("BUILD");
    for (const [i, s] of squads.entries()) {
      await n.ok(n.team(s.p_code), "save_draft", "PITCH", { company_name: `Full Co ${i}`, ticker: ["FUA", "FUB", "FUC"][i], problem: "A real problem." }, 0);
      await n.ok(n.team(s.p_code), "submit_submission", "PITCH");
    }
    await n.deadlinePassed("PITCH");
    await n.advanceTo("READING");
    for (const s of squads) await n.judge(s.company_id, "PITCH", [60, 60, 60]);
    await n.deadlinePassed("CALL_1");
    await n.org("release_scores", n.eventId, "PITCH");
    await n.advanceTo("IPO");

    await n.org("set_manual_starts", n.eventId, true);
    await n.org("set_hold_steps", n.eventId, true);
    expect((await n.one("select hold_steps from events where id = $1", [n.eventId])).hold_steps).toBe(true);

    // Round 2 starts now; crisis 1 is revealed at once (the organiser's own action is never held).
    await n.org("start_next_phase_now", n.eventId, "IPO");
    expect(await n.phase()).toBe("PRESSURE");
    expect((await sub(1)).revealed_at).not.toBeNull();

    // Hiring for crisis 1 comes due: the clock holds it two minutes away, with the steps after it, and an open window
    // stays open.
    await n.openRound(1);
    const due = await at("DUE_1");
    await n.q("update deadlines set at = now() + interval '20 seconds' where event_id = $1 and code = 'HIRE_1'", [n.eventId]);
    await n.ok(n.lead, "tick", n.eventId);
    const held = (await at("HIRE_1")) - Date.now();
    expect(held).toBeGreaterThan(90_000);
    expect(held).toBeLessThan(130_000);
    expect(await at("DUE_1")).toBeGreaterThan(due);
    expect((await sub(1)).hiring_closed_at).toBeNull();
    expect(ms((await n.one("select closes_at from rounds where event_id = $1 and number = 1", [n.eventId])).closes_at)).toBeGreaterThan(Date.now());

    // The organiser closes hiring now.
    await n.org("start_step_now", n.eventId, new Date(await at("HIRE_1")).toISOString(), "Crisis 1: hiring closes");
    expect((await sub(1)).hiring_closed_at).not.toBeNull();

    // Plans due comes due next: held too.
    await n.q("update deadlines set at = now() + interval '20 seconds' where event_id = $1 and code = 'DUE_1'", [n.eventId]);
    await n.ok(n.lead, "tick", n.eventId);
    expect((await at("DUE_1")) - Date.now()).toBeGreaterThan(90_000);

    // Steps on their timers again: plans due passes by itself.
    await n.org("set_hold_steps", n.eventId, false);
    await n.deadlinePassed("DUE_1");
    await n.ok(n.lead, "tick", n.eventId);
    expect((await sub(1)).due_closed_at).not.toBeNull();

    // Trading: window 2 cannot open while window 1 is open; close 1, then open 2 now for its planned length.
    expect((await n.call(n.lead, "open_round_now", n.eventId, 2)).code).toBe("ROUND_OPEN");
    await n.org("close_round_now", n.eventId, 1);
    await n.roundReaches(1, "CLEARED", 20_000);
    expect((await n.call(n.lead, "open_round_now", n.eventId, 3)).code).toBe("NOT_NEXT");
    const r2 = await n.one("select opens_at, closes_at from rounds where event_id = $1 and number = 2", [n.eventId]);
    const length = ms(r2.closes_at) - ms(r2.opens_at);
    await n.org("open_round_now", n.eventId, 2);
    const o2 = await n.one("select status, opens_at, closes_at from rounds where event_id = $1 and number = 2", [n.eventId]);
    expect(o2.status).toBe("OPEN");
    expect(Math.abs(ms(o2.closes_at) - Date.now() - length)).toBeLessThan(10_000);
    expect((await n.call(n.lead, "open_round_now", n.eventId, 2)).code).toBe("ROUND_OPEN");

    // Manual off also turns "every step waits" off.
    await n.org("set_hold_steps", n.eventId, true);
    await n.org("set_manual_starts", n.eventId, false);
    expect(await n.one("select manual_starts, hold_steps from events where id = $1", [n.eventId])).toEqual({ manual_starts: false, hold_steps: false });

    const whats = (await n.q("select what from event_log where event_id = $1", [n.eventId])).map((r) => r.what);
    expect(whats).toContain("Every step waits for the organiser");
    expect(whats).toContain("Trading window 2 opened now");

    const team = n.team(squads[0]!.p_code);
    await expect(n.call(team, "set_hold_steps", n.eventId, true)).rejects.toThrow(/only an organiser/);
    await expect(n.call(team, "open_round_now", n.eventId, 3)).rejects.toThrow(/only an organiser/);
  });
});
