// Online sign-ups and the registration desk (migration 20261108000021): anyone signs a team up and gets a number; at
// the desk an organiser confirms it (or a walk-in team) onto the next free login card, edits or removes it; only
// confirmed teams are ACTIVE and play.

import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { createTestDb } from "./pg";
import { anon, as } from "./helpers";
import { Night, SEED } from "./night";

let db: Awaited<ReturnType<typeof createTestDb>>;
beforeAll(async () => {
  db = await createTestDb();
});
afterAll(async () => {
  await db.drop();
});

describe("sign-ups and the desk", () => {
  test("sign up online, confirm at the desk, edit, remove, walk-ins; only confirmed teams play", async () => {
    // Six login cards, none registered (as on the live night).
    const n = await Night.create(db.pool, 6);
    const slug = (await n.one("select slug from events where id = $1", [n.eventId])).slug as string;
    await db.pool.query("update events set is_rehearsal = false where id = $1", [n.eventId]);
    await db.pool.query("update teams set status = 'BACKUP' where event_id = $1", [n.eventId]);
    await db.pool.query("delete from members where event_id = $1", [n.eventId]);
    const signUp = (name: string, email: string, members: unknown) =>
      as(db.pool, anon, async (c) => (await c.query("select public.sign_up($1, $2, $3, $4, $5) as r", [slug, name, email, "+91 98765 43210", JSON.stringify(members)])).rows[0].r, { commit: true });

    // Anyone can see the event and sign up; each gets the next number.
    const info = await as(db.pool, anon, async (c) => (await c.query("select public.signup_event($1) as r", [slug])).rows[0].r);
    expect(info).toMatchObject({ open: true });
    expect(await signUp("Alpha", "a@x.org", [{ full_name: "Asha", roll_number: "r1" }, { full_name: " ", roll_number: "" }, { full_name: "Ben", roll_number: "R2" }])).toMatchObject({ ok: true, number: "PR-0001" });
    expect(await signUp("Beta", "b@x.org", [{ full_name: "Chen", roll_number: "R3" }])).toMatchObject({ ok: true, number: "PR-0002" });
    // Same email again, a roll number already signed up, no members, bad email: refused with a reason.
    expect(await signUp("Again", "A@X.org", [{ full_name: "Dev", roll_number: "R9" }])).toMatchObject({ ok: false, code: "ALREADY", number: "PR-0001" });
    expect(await signUp("Gamma", "g@x.org", [{ full_name: "Esha", roll_number: "R1" }])).toMatchObject({ ok: false, code: "ROLL_TAKEN" });
    expect(await signUp("Delta", "d@x.org", [])).toMatchObject({ ok: false, code: "BAD_MEMBERS" });
    expect(await signUp("Delta", "nope", [{ full_name: "Farah" }])).toMatchObject({ ok: false, code: "BAD_EMAIL" });
    // Anonymous visitors and teams cannot read the sign-ups.
    await expect(as(db.pool, anon, (c) => c.query("select * from signups"))).rejects.toThrow(/permission denied/);
    expect(await n.q("select 1 from signups where event_id = $1", [n.eventId])).toHaveLength(2);
    expect(await n.call(n.team(n.codes[0]!), "find_signup", n.eventId, "1").catch((e: Error) => e.message)).toMatch(/organiser/);

    // The desk finds a sign-up however the number is typed, and confirms it on the first free card.
    const a = await n.org("find_signup", n.eventId, "pr1");
    expect(a).toMatchObject({ number: "PR-0001", team_name: "Alpha", card: null });
    expect(a.members).toEqual([{ full_name: "Asha", roll_number: "R1" }, { full_name: "Ben", roll_number: "R2" }]);
    const first = n.codes[0]!;
    expect(await n.org("desk_confirm", n.eventId, a.id, "Alpha Squad", JSON.stringify([...a.members, { full_name: "Gita", roll_number: "R7" }]))).toMatchObject({ card: first, new: true, active: 1 });
    expect(await n.q("select name, status from teams where code = $1", [first])).toEqual([{ name: "Alpha Squad", status: "ACTIVE" }]);
    expect((await n.q("select full_name from members m join teams t on t.id = m.team_id where t.code = $1 order by full_name", [first])).map((r) => r.full_name)).toEqual(["Asha", "Ben", "Gita"]);

    // Editing keeps the card: a member removed.
    expect(await n.org("desk_confirm", n.eventId, a.id, "Alpha Squad", JSON.stringify([{ full_name: "Asha", roll_number: "R1" }]))).toMatchObject({ card: first, new: false, active: 1 });
    expect(await n.q("select count(*)::int as n from members m join teams t on t.id = m.team_id where t.code = $1", [first])).toEqual([{ n: 1 }]);

    // A walk-in team gets the next card; a student cannot be in two confirmed teams.
    const walkIn = await n.org("desk_confirm", n.eventId, null, "Walk-ins", JSON.stringify([{ full_name: "Hari", roll_number: "R8" }]));
    expect(walkIn).toMatchObject({ card: n.codes[1], signup: "PR-0003", new: true, active: 2 });
    expect(await n.call(n.lead, "desk_confirm", n.eventId, null, "Copycats", JSON.stringify([{ full_name: "Asha", roll_number: "R1" }]))).toMatchObject({ ok: false, code: "ROLL_TAKEN" });

    // Removing frees the card for the next team.
    expect(await n.org("desk_remove", n.eventId, a.id)).toMatchObject({ card: first, active: 1 });
    expect(await n.q("select name, status from teams where code = $1", [first])).toEqual([{ name: `Team ${first}`, status: "BACKUP" }]);
    const b = await n.org("find_signup", n.eventId, "PR-0002");
    expect(await n.org("desk_confirm", n.eventId, b.id, "Beta", JSON.stringify(b.members))).toMatchObject({ card: first });
    expect(await n.org("desk_confirm", n.eventId, a.id, "Alpha", JSON.stringify(a.members))).toMatchObject({ card: n.codes[2] });

    // At the draw only the confirmed teams get a company; then the desk is closed, and so are sign-ups.
    await n.advanceTo("BRIEFING");
    await n.org("run_lottery", n.eventId, SEED, "3");
    const playing = await n.q("select t.code from companies c join teams t on t.id = c.founder_team_id where c.event_id = $1 order by t.code", [n.eventId]);
    expect(playing.map((r) => r.code)).toEqual(n.codes.slice(0, 3));
    expect(await n.call(n.lead, "desk_remove", n.eventId, a.id)).toMatchObject({ ok: false, code: "TOO_LATE" });
    expect(await signUp("Late", "late@x.org", [{ full_name: "Ira" }])).toMatchObject({ ok: false, code: "CLOSED" });
  });
});
