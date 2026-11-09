import { expect, test } from "@playwright/test";
import { STAFF, e2ePool, seedE2eEvent } from "./support/event";
import { loginAsStaff, loginAsTeam } from "./support/login";

// A team signs up on the public page, gets a number, and is confirmed at the desk onto the first free login card;
// before that its card shows only "not registered".
test("sign up online, then the desk confirms the team onto a login card", async ({ page }) => {
  const ev = await seedE2eEvent({ slug: "e2e-register", prefix: "R", teamCount: 3 });
  // As on the live night: sign-ups open to the public, no card registered yet.
  await e2ePool().query("update events set is_rehearsal = false where id = $1", [ev.n.eventId]);
  await e2ePool().query("update teams set status = 'BACKUP' where event_id = $1", [ev.n.eventId]);
  await e2ePool().query("delete from members where event_id = $1", [ev.n.eventId]);

  await page.goto("/register/e2e-register");
  await page.getByLabel("Team name").fill("Masala Labs");
  await page.getByLabel("Contact email").fill("lead@masala.example");
  await page.getByLabel("Member 1 name").fill("Asha Rao");
  await page.getByLabel("Member 1 roll number").fill("r100");
  await page.getByLabel("Member 2 name").fill("Ben Ali");
  await page.getByRole("button", { name: "Register team" }).click();
  await expect(page.getByTestId("signup-number")).toHaveText("PR-0001");

  // The card is not registered yet: no pages.
  await loginAsTeam(page, ev, "R001");
  await expect(page.getByTestId("team-not-playing")).toContainText("not registered");

  await page.context().clearCookies();
  await loginAsStaff(page, ev, STAFF.lead);
  await page.goto("/admin/e2e-register/signups");
  await expect(page.getByText("Masala Labs")).toBeVisible();
  await page.goto("/admin/e2e-register/teams");
  await page.getByTestId("desk-lookup").fill("1");
  await page.getByRole("button", { name: "Find" }).click();
  const editor = page.getByTestId("desk-editor");
  await expect(editor.getByLabel("Team name")).toHaveValue("Masala Labs");
  await editor.getByRole("button", { name: "+ Add member" }).click();
  await editor.getByLabel("Member 3 name").fill("Chen Li");
  await editor.getByRole("button", { name: "Confirm team and give a card" }).click();
  // The desk's result line says which card to give (or, if refused, why).
  await expect(page.locator("p[role=status], p[role=alert]").first()).toContainText("login card R001");
  await expect(page.getByTestId("desk-handed")).toContainText("R001");
  await expect(page.getByRole("cell", { name: "Chen Li", exact: false })).toBeVisible();

  // Now the team's pages open.
  await page.context().clearCookies();
  await loginAsTeam(page, ev, "R001");
  await expect(page.getByTestId("team-not-playing")).toHaveCount(0);
  await expect(page.getByText("Masala Labs").first()).toBeVisible();
});
