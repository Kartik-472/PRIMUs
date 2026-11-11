// Round 2 extras (migration 20261111000022): the organisers' rescue pairs (one by one or a whole sheet), the two private
// rescue chats of every team, and help tickets.

import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { checkLotteryRecord, rescuePlan, rootSeed, type LotteryRecord } from "@msim/engine";
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

const DICE = "4";

/** Round 1 played up to the moment before the crisis. */
async function toReveal(n: Night) {
  await n.advanceTo("BRIEFING");
  await n.org("run_lottery", n.eventId, SEED, DICE);
  await n.advanceTo("BUILD");
  await n.advanceTo("JUDGING_1");
  await n.judgeAll("PRD");
  await n.advanceTo("REVEAL_1");
}

const rescues = async (n: Night) =>
  Object.fromEntries(
    (
      await n.q(
        `select r.code as rescuer, f.code as founder from companies c
           join teams f on f.id = c.founder_team_id join teams r on r.id = c.rescuer_team_id where c.event_id = $1`,
        [n.eventId],
      )
    ).map((x) => [x.rescuer, x.founder]),
  );

describe("rescue pairs", () => {
  test("pairs one by one and from a sheet; bad rows are listed and nothing is saved; the lottery pairs the rest; the record checks out", async () => {
    const n = await Night.create(db.pool, 6);
    const [a, b, c, d, e, f] = n.codes as [string, string, string, string, string, string];
    const plan = async () => (await n.q("select r.code as r, f.code as f from rescue_plan p join teams r on r.id = p.rescuer_team_id join teams f on f.id = p.founder_team_id where p.event_id = $1 order by 1", [n.eventId])).map((x) => `${x.r}>${x.f}`);

    // Only an organiser; teams cannot read the pairs.
    expect(await n.call(n.team(a), "set_rescue_pairs", n.eventId, JSON.stringify([{ rescuer: a, founder: b }]), false).catch((err: Error) => err.message)).toMatch(/organiser/);
    // One pair, typed loosely.
    expect(await n.org("set_rescue_pairs", n.eventId, JSON.stringify([{ rescuer: ` ${a.toLowerCase()} `, founder: b }]), false)).toMatchObject({ ok: true, pairs: 1 });
    expect(await plan()).toEqual([`${a}>${b}`]);
    expect(await rowsAs(db.pool, n.team(a), "select * from rescue_plan")).toEqual([]);
    // A new pair replaces the older pair of the same rescuing team, and of the same company.
    expect(await n.org("set_rescue_pairs", n.eventId, JSON.stringify([{ rescuer: a, founder: c }]), false)).toMatchObject({ ok: true, pairs: 1 });
    expect(await n.org("set_rescue_pairs", n.eventId, JSON.stringify([{ rescuer: d, founder: c }]), false)).toMatchObject({ ok: true, pairs: 1 });
    expect(await plan()).toEqual([`${d}>${c}`]);

    // A sheet with mistakes: every bad row is named and nothing changes.
    const bad = await n.call(n.lead, "set_rescue_pairs", n.eventId, JSON.stringify([
      { rescuer: a, founder: a },
      { rescuer: "ZZ99", founder: b },
      { rescuer: b, founder: c },
      { rescuer: b, founder: d },
      { rescuer: e, founder: c },
      { rescuer: "", founder: f },
    ]), true);
    expect(bad).toMatchObject({ ok: false, code: "BAD_PAIRS" });
    expect(bad.problems).toEqual([
      `Row 1: ${a} cannot rescue its own company.`,
      "Row 2: there is no team ZZ99.",
      `Row 4: ${b} is given two companies to rescue.`,
      `Row 5: ${c}'s company is given to two teams.`,
      "Row 6: both teams are needed.",
    ]);
    expect(await plan()).toEqual([`${d}>${c}`]);

    // A sheet replaces everything; one pair can be removed, or all.
    expect(await n.org("set_rescue_pairs", n.eventId, JSON.stringify([{ rescuer: a, founder: b }, { rescuer: b, founder: a }, { rescuer: c, founder: d }]), true)).toMatchObject({ ok: true, saved: 3, pairs: 3 });
    expect(await n.org("clear_rescue_pairs", n.eventId, c)).toMatchObject({ removed: 1, pairs: 2 });
    expect(await plan()).toEqual([`${a}>${b}`, `${b}>${a}`]);

    await toReveal(n);
    // The teams are final now: pairs that leave one team with only its own company are refused, and so is a team that does not play.
    const five = [{ rescuer: a, founder: b }, { rescuer: b, founder: a }, { rescuer: c, founder: d }, { rescuer: d, founder: e }, { rescuer: e, founder: c }];
    expect(await n.call(n.lead, "set_rescue_pairs", n.eventId, JSON.stringify(five), true).catch((err: Error) => err.message)).toMatch(new RegExp(`leave ${f} with only its own company`));
    expect(await plan()).toEqual([`${a}>${b}`, `${b}>${a}`]);

    await n.advanceTo("CRISIS_QA");
    const got = await rescues(n);
    const fixed = [{ rescuer: a, founder: b }, { rescuer: b, founder: a }];
    expect(got).toEqual(Object.fromEntries(rescuePlan(rootSeed(SEED, DICE), n.codes, fixed)));
    expect(got[a]).toBe(b);
    expect(got[b]).toBe(a);
    expect(new Set(Object.values(got)).size).toBe(6);
    for (const [r, fo] of Object.entries(got)) expect(r).not.toBe(fo);
    // The published record lists the fixed pairs and repeats exactly; without them it would not.
    const record = (await n.one("select app.lottery_record_json($1) as r", [n.eventId])).r as LotteryRecord;
    expect(record.rescuePairs).toEqual(fixed);
    expect(checkLotteryRecord(record)).toEqual([]);
    expect(checkLotteryRecord({ ...record, rescuePairs: [] }).length).toBeGreaterThan(0);
    // After the crisis the pairs are fixed.
    expect(await n.call(n.lead, "set_rescue_pairs", n.eventId, JSON.stringify([{ rescuer: c, founder: d }]), false)).toMatchObject({ ok: false, code: "TOO_LATE" });
    expect(await n.call(n.lead, "clear_rescue_pairs", n.eventId, null)).toMatchObject({ ok: false, code: "TOO_LATE" });
    await n.checkInvariants();
  });

  test("no pairs: the rescue circle as before; pairs that can no longer be used are dropped and the lottery pairs everyone", async () => {
    const plain = await Night.create(db.pool, 5);
    await toReveal(plain);
    await plain.advanceTo("CRISIS_QA");
    expect(await rescues(plain)).toEqual(Object.fromEntries(rescuePlan(rootSeed(SEED, DICE), plain.codes)));
    expect((await plain.one("select rescue_fixed from events where id = $1", [plain.eventId])).rescue_fixed).toEqual([]);

    // Four of five teams paired among themselves before the teams were final: the fifth is left with its own company.
    const n = await Night.create(db.pool, 5);
    const [a, b, c, d] = n.codes as [string, string, string, string];
    expect(await n.org("set_rescue_pairs", n.eventId, JSON.stringify([{ rescuer: a, founder: b }, { rescuer: b, founder: a }, { rescuer: c, founder: d }, { rescuer: d, founder: c }]), true)).toMatchObject({ ok: true, pairs: 4 });
    await toReveal(n);
    await n.advanceTo("CRISIS_QA");
    expect(await rescues(n)).toEqual(Object.fromEntries(rescuePlan(rootSeed(SEED, DICE), n.codes)));
    expect((await n.one("select rescue_fixed from events where id = $1", [n.eventId])).rescue_fixed).toEqual([]);
    expect(await n.q("select 1 from audit_log where event_id = $1 and action = 'rescue_pairs_dropped'", [n.eventId])).toHaveLength(1);
    expect(checkLotteryRecord((await n.one("select app.lottery_record_json($1) as r", [n.eventId])).r as LotteryRecord)).toEqual([]);
  });
});

describe("rescue chats and tickets", () => {
  test("two private chats per team, open from the crisis to the solution lock; tickets reach staff with the chat they are about", async () => {
    const n = await Night.create(db.pool, 4);
    const [a, b, c, d] = n.codes as [string, string, string, string];
    // a rescues b's company, b rescues c's, c rescues d's, d rescues a's.
    expect(await n.org("set_rescue_pairs", n.eventId, JSON.stringify([{ rescuer: a, founder: b }, { rescuer: b, founder: c }, { rescuer: c, founder: d }, { rescuer: d, founder: a }]), true)).toMatchObject({ ok: true });
    const co = async (code: string) => (await n.company(code)).id as string;
    const [coA, coB, coC] = [await co(a), await co(b), await co(c)];
    await toReveal(n);

    // Before the crisis there is no chat.
    expect(await n.call(n.team(a), "send_chat", coB, "hello")).toMatchObject({ ok: false, code: "NOT_ALLOWED" });
    await n.advanceTo("CRISIS_QA");
    expect(await rescues(n)).toEqual({ [a]: b, [b]: c, [c]: d, [d]: a });

    // a asks b's founders; b answers in the same chat; a helps d in the chat about a's own company.
    expect(await n.call(n.team(a), "send_chat", coB, "  What does a pack cost you?  ")).toMatchObject({ ok: true });
    expect(await n.call(n.team(b), "send_chat", coB, "12 rupees.")).toMatchObject({ ok: true });
    expect(await n.call(n.team(d), "send_chat", coA, "Who buys it?")).toMatchObject({ ok: true });
    expect(await n.call(n.team(a), "send_chat", coA, "Hostel students.")).toMatchObject({ ok: true });
    // Not your chat, empty, too long.
    expect(await n.call(n.team(a), "send_chat", coC, "hi")).toMatchObject({ ok: false, code: "NOT_ALLOWED" });
    expect(await n.call(n.team(a), "send_chat", coB, "   ")).toMatchObject({ ok: false, code: "BAD_LENGTH" });
    expect(await n.call(n.team(a), "send_chat", coB, "x".repeat(501))).toMatchObject({ ok: false, code: "BAD_LENGTH" });
    expect(await n.call(n.lead, "send_chat", coB, "hi").catch((err: Error) => err.message)).toMatch(/only a team/);

    // Each team reads exactly its two chats; staff read all; the projector reads none.
    const read = async (who: Parameters<typeof rowsAs>[1]) =>
      (await rowsAs<{ company_id: string; from_rescuer: boolean; body: string }>(db.pool, who, "select company_id, from_rescuer, body from chat_messages order by created_at, body")).map((m) => `${m.company_id === coA ? "A" : m.company_id === coB ? "B" : "?"}${m.from_rescuer ? "<" : ">"}${m.body}`);
    expect(await read(n.team(a))).toEqual(["B<What does a pack cost you?", "B>12 rupees.", "A<Who buys it?", "A>Hostel students."]);
    expect(await read(n.team(b))).toEqual(["B<What does a pack cost you?", "B>12 rupees."]);
    expect(await read(n.team(c))).toEqual([]);
    expect(await read(n.team(d))).toEqual(["A<Who buys it?", "A>Hostel students."]);
    expect(await read(n.lead)).toHaveLength(4);
    // Each message is signalled on its chat's own channel, not on the event channel.
    const topics = (await n.q("select topic from realtime.messages where event = 'chat'")).map((r) => r.topic);
    expect(new Set(topics)).toEqual(new Set([`chat:${coA}`, `chat:${coB}`]));
    const hears = async (who: Parameters<typeof rowsAs>[1], topic: string) => (await rowsAs<{ ok: boolean }>(db.pool, who, "select app.can_hear($1) as ok", [topic]))[0]!.ok;
    expect(await hears(n.team(a), `chat:${coB}`)).toBe(true);
    expect(await hears(n.team(a), `chat:${coA}`)).toBe(true);
    expect(await hears(n.team(a), `chat:${coC}`)).toBe(false);
    expect(await hears(n.lead, `chat:${coC}`)).toBe(true);
    expect(await hears(n.team(a), `team:${n.teamId(a)}`)).toBe(true);
    expect(await hears(n.team(a), `team:${n.teamId(b)}`)).toBe(false);

    // Tickets: about a chat or about anything; numbered 1, 2, 3; at most five open per team.
    expect(await n.call(n.team(a), "raise_ticket", coB, "They are not answering.")).toMatchObject({ ok: true, number: 1 });
    expect(await n.call(n.team(c), "raise_ticket", null, "Our screen froze.")).toMatchObject({ ok: true, number: 2 });
    expect(await n.call(n.team(a), "raise_ticket", coC, "Not my chat")).toMatchObject({ ok: false, code: "NOT_ALLOWED" });
    expect(await n.call(n.team(a), "raise_ticket", null, " ")).toMatchObject({ ok: false, code: "BAD_LENGTH" });
    // A team reads its own tickets only; staff read all.
    expect(await rowsAs(db.pool, n.team(a), "select number from tickets")).toEqual([{ number: 1 }]);
    expect(await rowsAs(db.pool, n.team(b), "select number from tickets")).toEqual([]);
    expect(await rowsAs(db.pool, n.lead, "select number from tickets order by 1")).toEqual([{ number: 1 }, { number: 2 }]);
    // Staff reply and resolve; a team cannot.
    const t1 = (await n.one("select id from tickets where event_id = $1 and number = 1", [n.eventId])).id as string;
    expect(await n.call(n.team(a), "answer_ticket", t1, "done", true).catch((err: Error) => err.message)).toMatch(/organiser or the fairness officer/);
    expect(await n.call(n.lead, "answer_ticket", t1, "", false)).toMatchObject({ ok: false, code: "BAD_LENGTH" });
    expect(await n.org("answer_ticket", t1, "We have told them to reply.", false)).toMatchObject({ status: "OPEN" });
    expect(await n.org("answer_ticket", t1, "", true)).toMatchObject({ status: "RESOLVED" });
    expect(await rowsAs(db.pool, n.team(a), "select status, reply, company_id from tickets")).toEqual([{ status: "RESOLVED", reply: "We have told them to reply.", company_id: coB }]);
    for (let i = 0; i < 4; i++) expect(await n.call(n.team(c), "raise_ticket", null, `Again ${i}`)).toMatchObject({ ok: true, number: 3 + i });
    expect(await n.call(n.team(c), "raise_ticket", null, "A sixth")).toMatchObject({ ok: false, code: "TOO_MANY" });

    // The chats stay open through the Rescue round and close at the solution lock; everything stays readable.
    await n.advanceTo("RESCUE");
    expect(await n.call(n.team(b), "send_chat", coB, "Anything else?")).toMatchObject({ ok: true });
    await n.advanceTo("JUDGING_2");
    expect(await n.call(n.team(a), "send_chat", coB, "Too late")).toMatchObject({ ok: false, code: "CHAT_CLOSED" });
    expect(await read(n.team(b))).toHaveLength(3);
    // A ticket can still be raised.
    expect(await n.call(n.team(b), "raise_ticket", coB, "The chat closed early?")).toMatchObject({ ok: true });
  });
});
