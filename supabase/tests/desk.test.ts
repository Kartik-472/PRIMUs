// The registration desk: with desk check-in on, a team's login reads and does nothing until the desk admits it; the
// team list (roster) is uploaded and admitted from; only staff read the list.

import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { createTestDb } from "./pg";
import { rowsAs } from "./helpers";
import { Night } from "./night";

let db: Awaited<ReturnType<typeof createTestDb>>;
beforeAll(async () => {
  db = await createTestDb();
});
afterAll(async () => {
  await db?.drop();
});

describe("registration desk", () => {
  test("a rehearsal starts with desk check-in off; switched on, teams are locked out until admitted", async () => {
    const n = await Night.create(db.pool, 3);
    expect((await n.one("select desk_check_in from events where id = $1", [n.eventId])).desk_check_in).toBe(false);
    const code = n.ev.plan.teams[0]!.code;
    const team = n.team(code);
    expect(await rowsAs(db.pool, team, "select id from teams")).toHaveLength(1);

    await n.ok(n.lead, "set_desk_check_in", n.eventId, true);
    expect(await rowsAs(db.pool, team, "select id from teams")).toHaveLength(0);
    expect(await n.call(team, "my_desk_status")).toEqual({ team: true, admitted: false });
    // Staff are not affected.
    expect((await rowsAs(db.pool, n.lead, "select id from teams where event_id = $1", [n.eventId])).length).toBe(9);

    const r = await n.ok(n.lead, "desk_check_in", n.eventId, null, code, "  Alpha  ", JSON.stringify([
      { full_name: "Asha", roll_number: "R1" },
      { full_name: "Bilal", roll_number: "" },
    ]));
    expect(r).toMatchObject({ card: code, new: true, checked_in: 1 });
    expect(await n.call(team, "my_desk_status")).toEqual({ team: true, admitted: true });
    expect(await rowsAs<{ name: string }>(db.pool, team, "select name from teams")).toEqual([{ name: "Alpha" }]);
    expect(await rowsAs(db.pool, team, "select full_name, roll_number from members order by full_name")).toEqual([
      { full_name: "Asha", roll_number: "R1" },
      { full_name: "Bilal", roll_number: null },
    ]);

    // The card is taken: a second team cannot be admitted onto it, only edited.
    expect(await n.call(n.lead, "desk_check_in", n.eventId, null, code, "Other", JSON.stringify([{ full_name: "X" }]))).toMatchObject({
      ok: false,
      code: "CARD_TAKEN",
    });
    await n.ok(n.lead, "desk_check_in", n.eventId, null, code, "Alpha Two", JSON.stringify([{ full_name: "Asha", roll_number: "R1" }]), null, true, "{}");
    expect((await n.one("select name from teams where code = $1", [code])).name).toBe("Alpha Two");

    // Checked out: locked again, members cleared.
    const id = (await n.one("select id from teams where code = $1", [code])).id;
    await n.ok(n.lead, "desk_check_out", n.eventId, id);
    expect(await rowsAs(db.pool, team, "select id from teams")).toHaveLength(0);
    expect((await n.one("select count(*)::int as c from members where team_id = $1", [id])).c).toBe(0);
  });

  test("next free card per track; only organisers act; validation", async () => {
    const n = await Night.create(db.pool, 3);
    await n.ok(n.lead, "set_desk_check_in", n.eventId, true);
    const one = JSON.stringify([{ full_name: "A" }]);
    const a = await n.ok(n.lead, "desk_check_in", n.eventId, "FINANCE", null, "F team", one);
    const b = await n.ok(n.lead, "desk_check_in", n.eventId, "FINANCE", "", "F team 2", one);
    const finance = n.ev.plan.teams.filter((t) => t.track === "FINANCE").map((t) => t.code).sort();
    expect([a.card, b.card]).toEqual(finance.slice(0, 2));
    await n.ok(n.lead, "desk_check_in", n.eventId, "FINANCE", null, "F team 3", one);
    expect(await n.call(n.lead, "desk_check_in", n.eventId, "FINANCE", null, "F team 4", one)).toMatchObject({ code: "NO_FREE_CARD" });
    expect(await n.call(n.lead, "desk_check_in", n.eventId, "PRODUCT", null, " ", one)).toMatchObject({ code: "BAD_NAME" });
    expect(await n.call(n.lead, "desk_check_in", n.eventId, "PRODUCT", null, "P", "[]")).toMatchObject({ code: "BAD_MEMBERS" });
    expect(await n.call(n.lead, "desk_check_in", n.eventId, "PRODUCT", null, "P", JSON.stringify([{ full_name: "A", roll_number: "R9" }]))).toMatchObject({ ok: true });
    expect(await n.call(n.lead, "desk_check_in", n.eventId, "PRODUCT", null, "Q", JSON.stringify([{ full_name: "B", roll_number: "R9" }]))).toMatchObject({
      ok: false,
      code: "ROLL_TAKEN",
    });
    await expect(n.call(n.fairness, "desk_check_in", n.eventId, "PRODUCT", null, "P", one)).rejects.toThrow(/only an organiser/);
    await expect(n.call(n.team(finance[0]!), "set_desk_check_in", n.eventId, false)).rejects.toThrow(/only an organiser/);
  });

  test("the team list: uploaded, admitted from, kept on replace once admitted, read by staff only", async () => {
    const n = await Night.create(db.pool, 3);
    await n.ok(n.lead, "set_desk_check_in", n.eventId, true);
    const rows = [
      { team_name: "Alpha", track: "Product", college: "TIET", phone: "98", members: [{ full_name: "Asha", roll_number: "1" }], extra: { "S.No": "1" } },
      { team_name: "Beta", track: "consulting", members: [{ full_name: "Bo", roll_number: null }] },
      { team_name: "Gamma", members: [] },
    ];
    expect(await n.ok(n.lead, "import_roster", n.eventId, JSON.stringify(rows), false)).toMatchObject({ added: 3, total: 3 });
    const list = await n.q<{ id: string; number: number; team_name: string; track: string | null }>(
      "select id, number, team_name, track from roster where event_id = $1 order by number",
      [n.eventId],
    );
    expect(list.map((r) => [r.number, r.team_name, r.track])).toEqual([
      [1, "Alpha", "PRODUCT"],
      [2, "Beta", "CONSULTING"],
      [3, "Gamma", null],
    ]);

    const r = await n.ok(n.lead, "desk_check_in", n.eventId, "PRODUCT", null, "Alpha FC", JSON.stringify([{ full_name: "Asha", roll_number: "1" }]), list[0]!.id, false, JSON.stringify({ college: "Thapar", email: "a@x.in", phone: "99" }));
    const row = await n.one("select team_name, college, email, phone, team_id, admitted_at from roster where id = $1", [list[0]!.id]);
    expect(row).toMatchObject({ team_name: "Alpha FC", college: "Thapar", email: "a@x.in", phone: "99" });
    expect(row.admitted_at).not.toBeNull();
    expect((await n.one("select code from teams where id = $1", [row.team_id])).code).toBe(r.card);

    // A walk-in is added to the list.
    await n.ok(n.lead, "desk_check_in", n.eventId, "FINANCE", null, "Walk-in", JSON.stringify([{ full_name: "W" }]));
    expect((await n.one("select source, number from roster where team_name = 'Walk-in'")).source).toBe("DESK");

    // Replacing keeps admitted teams and drops the rest.
    expect(await n.ok(n.lead, "import_roster", n.eventId, JSON.stringify([{ team_name: "Delta", members: [] }]), true)).toMatchObject({ added: 1, total: 3 });
    expect((await n.q("select team_name from roster where event_id = $1 order by number", [n.eventId])).map((x) => x.team_name)).toEqual([
      "Alpha FC",
      "Walk-in",
      "Delta",
    ]);

    // Staff read the list; teams and the projector do not.
    expect((await rowsAs(db.pool, n.fairness, "select id from roster where event_id = $1", [n.eventId])).length).toBe(3);
    const admittedCode = String(r.card);
    expect(await rowsAs(db.pool, n.team(admittedCode), "select id from roster")).toHaveLength(0);
  });
});
