// Backup teams and registration (migrations 20261108000018 and 20): seeded as backups, activated or withdrawn by an organiser before the draw, and only the
// active teams play from the draw on. And organisers giving other people organiser access.

import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { buildSeedPlan } from "../../scripts/lib/seed-plan";
import { createTestDb } from "./pg";
import { anon, as, service } from "./helpers";
import { Night, SEED } from "./night";

let db: Awaited<ReturnType<typeof createTestDb>>;
beforeAll(async () => {
  db = await createTestDb();
});
afterAll(async () => {
  await db.drop();
});

describe("backup teams", () => {
  test("backups wait; organisers swap teams before the draw; only active teams play; fixed once dealt", async () => {
    const n = await Night.create(db.pool, 6, { backupCount: 3, backupLetter: "O" });
    expect(await n.q("select code, status from teams where event_id = $1 and code like 'O%' order by code", [n.eventId])).toEqual([
      { code: "O001", status: "BACKUP" },
      { code: "O002", status: "BACKUP" },
      { code: "O003", status: "BACKUP" },
    ]);
    const [a, b] = n.codes.filter((c) => !c.startsWith("O"));
    // Only organisers; a team cannot change its own status.
    await expect(n.call(n.team(a!), "set_team_status", n.eventId, "O001", "ACTIVE", null)).rejects.toThrow(/organiser/);
    // A walk-in team is activated, a no-show withdrawn, one backup goes back and forth.
    expect(await n.org("set_team_status", n.eventId, "o001", "ACTIVE", "Walk-in team")).toMatchObject({ code: "O001", status: "ACTIVE", active: 7 });
    expect(await n.org("set_team_status", n.eventId, a, "WITHDRAWN", "Did not come")).toMatchObject({ active: 6 });
    await n.org("set_team_status", n.eventId, "O002", "ACTIVE", null);
    await n.org("set_team_status", n.eventId, "O002", "BACKUP", null);
    expect(await n.call(n.lead, "set_team_status", n.eventId, "Z999", "ACTIVE", null)).toMatchObject({ ok: false, code: "NO_TEAM" });
    expect(await n.call(n.lead, "set_team_status", n.eventId, b, "GONE", null)).toMatchObject({ ok: false, code: "BAD_STATUS" });
    expect((await n.q("select count(*)::int as n from audit_log where event_id = $1 and action = 'team_status'", [n.eventId]))[0].n).toBe(4);

    await n.advanceTo("BRIEFING");
    await n.org("run_lottery", n.eventId, SEED, "3");
    // At the draw: a company (and a problem card) for each active team only.
    const playing = await n.q("select t.code from companies c join teams t on t.id = c.founder_team_id where c.event_id = $1 order by t.code", [n.eventId]);
    expect(playing.map((r) => r.code)).toEqual([...n.codes.filter((c) => !c.startsWith("O") && c !== a), "O001"].sort());
    expect(await n.q("select count(*)::int as n from companies where event_id = $1 and problem_card_id is null", [n.eventId])).toEqual([{ n: 0 }]);
    expect(await n.call(n.lead, "set_team_status", n.eventId, "O003", "ACTIVE", null)).toMatchObject({ ok: false, code: "TOO_LATE" });

    // Through to the crisis: the rescue circle and the crisis cards cover the active teams only.
    await n.advanceTo("BUILD");
    await n.advanceTo("JUDGING_1");
    await n.judgeAll("PRD");
    await n.advanceTo("CRISIS_QA");
    const circle = await n.q(
      "select f.code as founder, r.code as rescuer from companies c join teams f on f.id = c.founder_team_id join teams r on r.id = c.rescuer_team_id where c.event_id = $1",
      [n.eventId],
    );
    expect(circle).toHaveLength(6);
    expect(circle.every((r) => r.rescuer !== "O002" && r.rescuer !== "O003" && r.rescuer !== a)).toBe(true);
    const record = await n.ok(n.lead, "lottery_record", n.eventId);
    expect(record.record.teams).toHaveLength(6);
    expect(record.record.teams).not.toContain("O002");
    // The leaderboard has the playing teams only.
    const board = await n.ok(n.lead, "leaderboard", n.eventId);
    expect(board.rows.map((r: { code: string }) => r.code).sort()).toEqual(playing.map((r) => r.code));
  });

  test("the live seed: 200 team logins, no backups by default (at most 20)", () => {
    const base = {
      slug: "primus-test", name: "PRIMUS", rehearsal: false, clockSpeed: 1, startsAt: new Date(), teamCount: 200,
      cardSecret: "test-secret-0123456789", emailDomain: "teams.example.org",
    };
    const plan = buildSeedPlan(base);
    expect(plan.teams.filter((t) => !t.backup)).toHaveLength(200);
    expect(plan.teams.filter((t) => t.backup)).toHaveLength(0);
    expect(buildSeedPlan({ ...base, backupCount: 3 }).teams.filter((t) => t.backup).map((t) => t.code)).toEqual(["B001", "B002", "B003"]);
    expect(() => buildSeedPlan({ ...base, backupCount: 21 })).toThrow(/backup/);
  });
});

describe("registration", () => {
  test("an organiser registers exactly the ticked teams before the draw; unregistered teams cannot trade or play", async () => {
    const n = await Night.create(db.pool, 6);
    const [a, b, c, d, e, f] = n.codes;
    // Only organisers.
    await expect(n.call(n.team(a!), "set_registration", n.eventId, [a])).rejects.toThrow(/organiser/);
    expect(await n.call(n.lead, "set_registration", n.eventId, [a, "Z999"])).toMatchObject({ ok: false, code: "NO_TEAM" });
    // Tick four (lower case and spaces are fine): the other two are unregistered.
    expect(await n.org("set_registration", n.eventId, [a, b!.toLowerCase(), ` ${c} `, d])).toMatchObject({ registered: 0, unregistered: 2, active: 4 });
    expect(await n.q("select code, status from teams where event_id = $1 order by code", [n.eventId])).toEqual(
      [a, b, c, d, e, f].map((code) => ({ code, status: [e, f].includes(code) ? "BACKUP" : "ACTIVE" })),
    );
    // Saving the same list again changes nothing and logs nothing new.
    expect(await n.org("set_registration", n.eventId, [a, b, c, d])).toMatchObject({ registered: 0, unregistered: 0, active: 4 });
    expect(await n.org("set_registration", n.eventId, [a, b, c, d, e])).toMatchObject({ registered: 1, unregistered: 0, active: 5 });
    expect((await n.q("select count(*)::int as n from audit_log where event_id = $1 and action = 'registration'", [n.eventId]))[0].n).toBe(2);

    // An unregistered team cannot place an order.
    const company = (await n.one("select id from companies where event_id = $1 limit 1", [n.eventId])).id;
    expect(await n.call(n.team(f!), "place_order", company, "BUY", 1, null)).toMatchObject({ ok: false, code: "NOT_REGISTERED" });

    // At the draw only the registered teams get a company; then the list is fixed.
    await n.advanceTo("BRIEFING");
    await n.org("run_lottery", n.eventId, SEED, "3");
    const playing = await n.q("select t.code from companies c join teams t on t.id = c.founder_team_id where c.event_id = $1 order by t.code", [n.eventId]);
    expect(playing.map((r) => r.code)).toEqual([a, b, c, d, e]);
    expect(await n.call(n.lead, "set_registration", n.eventId, [a, b, c, d, e, f])).toMatchObject({ ok: false, code: "TOO_LATE" });
  });
});

describe("giving organiser access", () => {
  test("an organiser adds, resets and removes; nobody else can; oneself always stays", async () => {
    const n = await Night.create(db.pool, 3);
    const lead = (await n.one("select user_id from accounts where display_name = 'Event lead'")).user_id;
    const fairness = (await n.one("select user_id from accounts where display_name = 'Fairness officer'")).user_id;
    const newbie = randomUUID();
    await db.pool.query("insert into auth.users (id, email) values ($1, $2)", [newbie, `new-${newbie.slice(0, 6)}@example.org`]);
    const svc = (fn: string, ...args: unknown[]) =>
      as(db.pool, service, async (c) => (await c.query(`select public.${fn}(${args.map((_, i) => `$${i + 1}`).join(", ")}) as r`, args)).rows[0].r, {
        commit: true,
      });

    // Only the server (service role) records it, and only for an organiser asking.
    await expect(n.call(n.lead, "add_organiser", newbie, "New organiser", lead)).rejects.toThrow(/permission denied/);
    await expect(svc("add_organiser", newbie, "New organiser", fairness)).rejects.toThrow(/only an organiser/);
    expect(await svc("add_organiser", newbie, "New organiser", lead)).toMatchObject({ ok: true });
    expect(await svc("add_organiser", newbie, "Again", lead)).toMatchObject({ ok: false, code: "EXISTS" });
    expect((await n.one("select role from accounts where user_id = $1", [newbie])).role).toBe("ORGANISER");

    // The staff list: organisers only, with emails.
    const list = await n.call(n.lead, "staff_list");
    expect(list.some((s: { user_id: string; email: string }) => s.user_id === newbie && s.email.startsWith("new-"))).toBe(true);
    await expect(n.call(n.fairness, "staff_list")).rejects.toThrow(/organiser/);
    await expect(as(db.pool, anon, (c) => c.query("select public.staff_list()"))).rejects.toThrow(/permission denied/);

    expect(await svc("log_password_reset", newbie, lead)).toMatchObject({ ok: true });
    expect(await svc("remove_staff", lead, lead)).toMatchObject({ ok: false, code: "SELF" });
    expect(await svc("remove_staff", newbie, lead)).toMatchObject({ ok: true, role: "ORGANISER" });
    expect(await n.q("select 1 from accounts where user_id = $1", [newbie])).toEqual([]);
    expect((await n.q("select action from audit_log where entity = 'accounts' and entity_id = $1 and action not in ('insert', 'update', 'delete') order by id", [newbie])).map((r) => r.action)).toEqual([
      "access_granted",
      "password_reset",
      "access_removed",
    ]);
  });
});
