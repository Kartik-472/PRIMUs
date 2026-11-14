import { expect, test } from "@playwright/test";
import { sha256Hex } from "@msim/engine";
import type pg from "pg";
import { STAFF, e2ePool, seedE2eEvent, type E2eEvent } from "./support/event";
import { loginAsStaff } from "./support/login";

test.describe.configure({ mode: "serial" });

// Team codes are unique across events and this spec shares the prefix U with display-takeovers: one at a time, each
// purging the other's event first.
let ev: E2eEvent;
let lock: pg.PoolClient | undefined;
test.beforeAll(async () => {
  test.setTimeout(300_000);
  lock = await e2ePool().connect();
  await lock.query("select pg_advisory_lock(hashtext('e2e-common-U'))");
  await lock.query("select public.purge_event($1)", ["e2e-display-takeovers"]);
  ev = await seedE2eEvent({ slug: "e2e-run", prefix: "U", format: "PRIMUS" });
  await ev.n.org("set_seed_commitment", ev.n.eventId, sha256Hex(sha256Hex("e2e-run")));
});
test.afterAll(async () => {
  await lock?.query("select pg_advisory_unlock(hashtext('e2e-common-U'))");
  lock?.release();
});

test("the Run event page: the plan by round, manual mode, start the next phase, a step now, and the log", async ({ page }) => {
  await loginAsStaff(page, ev, STAFF.lead);
  await page.goto(`/admin/${ev.slug}/run`);
  await expect(page.getByRole("navigation", { name: "Sections" }).getByRole("link", { name: "Run event" })).toHaveAttribute("aria-current", "page");
  await expect(page.getByTestId("run-phase")).toHaveText("Setup");
  for (const t of ["Before the rounds", "Round 1: Build", "Round 2: Pressure", "Round 3: Saturation", "Finish"]) {
    await expect(page.getByRole("heading", { name: t })).toBeVisible();
  }
  for (const k of [1, 2, 3, 4]) await expect(page.getByTestId(`group-crisis-${k}`)).toBeVisible();

  // Manual mode.
  await page.getByRole("button", { name: "Switch to manual" }).click();
  await page.getByRole("button", { name: "Click again: I will start every phase and crisis myself" }).click();
  await expect(page.getByRole("button", { name: "Switch to automatic" })).toBeVisible();
  expect((await ev.n.one("select manual_starts, auto_advance from events where id = $1", [ev.n.eventId])).auto_advance).toBe(false);

  // Start the next phase now.
  await page.getByRole("button", { name: "End Setup · start Check-in" }).click();
  await page.getByRole("button", { name: "Click again to end Setup and start Check-in now" }).click();
  await expect(page.getByTestId("run-phase")).toHaveText("Check-in");
  expect(await ev.n.phase()).toBe("CHECKIN");

  // Into Round 1: the next step is the problem pick; do it now, and the plan after it moves earlier.
  await ev.n.advanceTo("SQUAD_DRAW");
  await ev.n.org("run_lottery", ev.n.eventId, sha256Hex("e2e-run"), "4");
  await ev.n.advanceTo("BUILD");
  await page.reload();
  await expect(page.getByTestId("run-next")).toHaveText("Problem cards picked");
  const pitchBefore = new Date((await ev.n.one("select at from deadlines where event_id = $1 and code = 'PITCH'", [ev.n.eventId])).at).getTime();
  await page.getByRole("button", { name: "+5 min" }).first().click();
  await page.getByRole("button", { name: "Click again: +5 min" }).click();
  await expect.poll(async () => new Date((await ev.n.one("select at from deadlines where event_id = $1 and code = 'PITCH'", [ev.n.eventId])).at).getTime() - pitchBefore).toBe(5 * 60_000);
  await page.getByRole("button", { name: "Do it now" }).click();
  await page.getByRole("button", { name: "Click again: problem cards picked now" }).click();
  await expect(page.getByTestId("run-next")).toHaveText("PRDs and crisis memos due");
  await expect(page.getByTestId("step-PROBLEM_PICK")).toContainText("Done");

  // The log: newest first, with who did it, and the CSV.
  const log = page.getByRole("region", { name: "Event log" });
  await expect(log).toContainText("Check-in started");
  await expect(log).toContainText("Problem cards picked (started now)");
  await expect(log).toContainText("Manual mode on");
  const csv = await page.request.get(`/admin/${ev.slug}/exports/timeline`);
  expect(csv.status()).toBe(200);
  const text = await csv.text();
  expect(text.split("\r\n")[0]).toBe("time,kind,what,by");
  expect(text).toContain("Check-in started");
});
