// Resetting a rehearsal (migration 052): the event goes back to a fresh Setup with the same teams, logins, staff and
// cards, its plan 5 minutes from now, manual mode kept; a live event is never reset; teams cannot reset.

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

describe("reset a rehearsal", () => {
  test("back to Setup with the same teams and logins", async () => {
    const n = await Night.create(db.pool, 3, "PRIMUS");
    const slug = (await n.one("select slug from events where id = $1", [n.eventId])).slug;
    const before = await n.q("select code, user_id from teams t join accounts a on a.team_id = t.id where t.event_id = $1 order by code", [n.eventId]);
    const cards = (await n.one("select count(*)::int as c from problem_cards where event_id = $1", [n.eventId])).c;

    // Play a little: manual mode, the draw, Round 1.
    await n.org("set_manual_starts", n.eventId, true);
    const seed = sha256Hex("reset");
    await n.org("set_seed_commitment", n.eventId, sha256Hex(seed));
    await n.advanceTo("SQUAD_DRAW");
    await n.org("run_lottery", n.eventId, seed, "3");
    await n.advanceTo("BUILD");

    // Teams cannot reset.
    const team = n.team((await n.squad(1)).p_code);
    await expect(n.call(team, "reset_rehearsal", n.eventId)).rejects.toThrow(/only an organiser/);

    const r = await n.call(n.lead, "reset_rehearsal", n.eventId);
    expect(r.ok).toBe(true);
    const id = r.event_id as string;
    expect(id).not.toBe(n.eventId);
    const ev = await n.one("select slug, current_phase, seed_commitment, manual_starts, auto_advance from events where id = $1", [id]);
    expect(ev).toMatchObject({ slug, current_phase: "SETUP", seed_commitment: null, manual_starts: true, auto_advance: false });
    expect((await n.one("select count(*)::int as c from events where slug = $1", [slug])).c).toBe(1);
    const after = await n.q("select code, user_id from teams t join accounts a on a.team_id = t.id where t.event_id = $1 order by code", [id]);
    expect(after).toEqual(before);
    expect((await n.one("select count(*)::int as c from problem_cards where event_id = $1", [id])).c).toBe(cards);
    expect((await n.one("select count(*)::int as c from squads where event_id = $1", [id])).c).toBe(0);
    // The plan starts about 5 minutes from now.
    const checkin = new Date((await n.one("select starts_at from phases where event_id = $1 and code = 'CHECKIN'", [id])).starts_at).getTime();
    expect(Math.abs(checkin - Date.now() - 5 * 60_000)).toBeLessThan(60_000);
    expect((await n.q("select what from event_log where event_id = $1", [id])).map((x) => x.what)).toContain("Demo reset: back to Setup");

    // A live event is never reset.
    await n.q("update events set is_rehearsal = false where id = $1", [id]);
    expect((await n.call(n.lead, "reset_rehearsal", id)).code).toBe("LIVE");
  });
});
