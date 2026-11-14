// Running the event by hand (migration 050): start the next phase now with its plan pulled in, start any planned step
// now (later steps keep their gaps), add time to a step, manual mode holding Round 2 before each crisis, and the event
// log with who did what.

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

describe("run the event by hand", () => {
  test("start now, add time, hold before a crisis, and the log", async () => {
    const n = await Night.create(db.pool, 3, "PRIMUS");
    const at = async (code: string) => ms((await n.one("select at from deadlines where event_id = $1 and code = $2", [n.eventId, code])).at);

    const seed = sha256Hex("run");
    await n.org("set_seed_commitment", n.eventId, sha256Hex(seed));
    await n.advanceTo("SQUAD_DRAW");
    await n.org("run_lottery", n.eventId, seed, "3");
    const squads = [await n.squad(1), await n.squad(2), await n.squad(3)];
    await n.advanceTo("BUILD");
    for (const [i, s] of squads.entries()) {
      await n.ok(n.team(s.p_code), "save_draft", "PITCH", { company_name: `Run Co ${i}`, ticker: ["RNA", "RNB", "RNC"][i], problem: "A real problem." }, 0);
      await n.ok(n.team(s.p_code), "submit_submission", "PITCH");
    }
    await n.deadlinePassed("PITCH");
    await n.advanceTo("READING");
    for (const s of squads) await n.judge(s.company_id, "PITCH", [60, 60, 60]);
    await n.deadlinePassed("CALL_1");
    await n.org("release_scores", n.eventId, "PITCH");
    await n.advanceTo("IPO");

    // Manual mode: auto-advance goes off.
    await n.org("set_manual_starts", n.eventId, true);
    expect(await n.one("select manual_starts, auto_advance from events where id = $1", [n.eventId])).toEqual({ manual_starts: true, auto_advance: false });

    // Round 2 is planned an hour from now; starting it now pulls its plan in, so crisis 1 is revealed at once.
    await n.q("update phases set starts_at = starts_at + interval '1 hour', ends_at = ends_at + interval '1 hour' where event_id = $1 and code <> 'IPO' and seq > (select seq from phases where event_id = $1 and code = 'IPO')", [n.eventId]);
    await n.q("update deadlines set at = at + interval '1 hour' where event_id = $1 and code::text ~ '^(REVEAL|HIRE|DUE|RATE|DRAFT)'", [n.eventId]);
    await n.q("update rounds set opens_at = opens_at + interval '1 hour', closes_at = closes_at + interval '1 hour' where event_id = $1", [n.eventId]);
    const gapBefore = (await at("DUE_1")) - (await at("HIRE_1"));
    expect((await n.call(n.lead, "start_next_phase_now", n.eventId, "IPO")).ok).toBe(true);
    expect(await n.phase()).toBe("PRESSURE");
    expect((await n.one("select revealed_at from subrounds where event_id = $1 and k = 1", [n.eventId])).revealed_at).not.toBeNull();
    expect(Math.abs((await at("REVEAL_1")) - Date.now())).toBeLessThan(10_000);

    // Close hiring for crisis 1 now: the later steps move earlier by the same amount, keeping their gaps.
    expect((await n.call(n.lead, "start_step_now", n.eventId, new Date(await at("HIRE_1")).toISOString(), "Crisis 1: close hiring")).ok).toBe(true);
    expect((await n.one("select hiring_closed_at from subrounds where event_id = $1 and k = 1", [n.eventId])).hiring_closed_at).not.toBeNull();
    expect((await at("DUE_1")) - (await at("HIRE_1"))).toBe(gapBefore);

    // A step that already happened cannot be started again.
    expect((await n.call(n.lead, "start_step_now", n.eventId, new Date(Date.now() - 60_000).toISOString(), null)).code).toBe("ALREADY");

    // +5 minutes on plans due: it and everything after it move later.
    const due = await at("DUE_1");
    const reveal2 = await at("REVEAL_2");
    await n.org("delay_step", n.eventId, new Date(due).toISOString(), 5, "Crisis 1: plans due");
    expect((await at("DUE_1")) - due).toBe(5 * 60_000);
    expect((await at("REVEAL_2")) - reveal2).toBe(5 * 60_000);

    // The hold: crisis 2 comes due, but in manual mode the clock keeps it two minutes away.
    await n.q("update deadlines set at = now() + interval '20 seconds' where event_id = $1 and code = 'REVEAL_2'", [n.eventId]);
    await n.ok(n.lead, "tick", n.eventId);
    expect((await n.one("select count(*)::int as c from subrounds where event_id = $1 and k = 2 and revealed_at is not null", [n.eventId])).c).toBe(0);
    const held = (await at("REVEAL_2")) - Date.now();
    expect(held).toBeGreaterThan(90_000);
    expect(held).toBeLessThan(130_000);

    // The organiser starts crisis 2.
    await n.org("start_step_now", n.eventId, new Date(await at("REVEAL_2")).toISOString(), "Crisis 2");
    expect((await n.one("select revealed_at from subrounds where event_id = $1 and k = 2", [n.eventId])).revealed_at).not.toBeNull();

    // Manual mode off: auto-advance back on, no more hold.
    await n.org("set_manual_starts", n.eventId, false);
    expect((await n.one("select auto_advance from events where id = $1", [n.eventId])).auto_advance).toBe(true);

    // The log: phase changes, crisis steps and the organiser's controls, with who did them.
    const log = await n.q("select kind, what, by_organiser from event_log where event_id = $1 order by id", [n.eventId]);
    const whats = log.map((r) => r.what);
    expect(whats).toContain("IPO ended");
    expect(whats).toContain("Crisis 1 revealed (sub-round 1 started)");
    expect(whats).toContain("Crisis 1: hiring closed");
    expect(whats).toContain("Crisis 2 revealed (sub-round 2 started)");
    expect(whats).toContain("Crisis 1: plans due: +5 min");
    expect(log.find((r) => r.what === "Round 2: Pressure started")?.by_organiser).toBe(true);
    expect(log.find((r) => r.what.startsWith("Manual mode on"))?.kind).toBe("CONTROL");

    // Teams can neither run the clock nor read the log.
    const team = n.team(squads[0]!.p_code);
    await expect(n.call(team, "start_step_now", n.eventId, new Date(Date.now() + 60_000).toISOString(), null)).rejects.toThrow(/only an organiser/);
    await expect(n.call(team, "set_manual_starts", n.eventId, true)).rejects.toThrow(/only an organiser/);
  });
});
