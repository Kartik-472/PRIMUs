// Round 2 extras in a browser, on the local stack: the organiser's rescue pairs (one from the form, a whole Excel
// sheet, the template), the two private rescue chats of a team (live between the two teams), and a ticket that the
// organiser answers after reading the chat it is about.

import path from "node:path";
import { expect, test } from "@playwright/test";
import { STAFF, seedE2eEvent } from "./support/event";
import { building, pricesRevealed } from "./support/game";
import { loginAsStaff, loginAsTeam } from "./support/login";

const fixture = (name: string) => path.join(__dirname, "fixtures", name);

test("organiser sets rescue pairs from the form and from an Excel sheet; bad rows are named", async ({ page }) => {
  const ev = await seedE2eEvent({ slug: "e2e-pairs", prefix: "P" });
  await building(ev);
  await loginAsStaff(page, ev, STAFF.lead);
  await page.goto(`/admin/${ev.slug}/rescue`);
  await expect(page.getByText("No pairs set: the lottery pairs every team.")).toBeVisible();

  // One pair from the form.
  await page.getByLabel("Rescuing team").selectOption("P005");
  await page.getByLabel("Rescues the company of").selectOption("P006");
  await page.getByRole("button", { name: "Save pair" }).click();
  await expect(page.getByText("P005 will rescue P006's company.")).toBeVisible();
  const table = page.getByRole("region", { name: "Pairs set by organisers" });
  await expect(table).toContainText("P005");

  // The template lists every team playing, with the pair set so far.
  const template = await page.request.get(`/admin/${ev.slug}/rescue/template`);
  expect(template.status()).toBe(200);
  const csv = await template.text();
  expect(csv).toContain("Rescuing team,Rescues the company of");
  expect(csv).toContain("P005,P006");

  // A sheet with mistakes: nothing saved, each bad row named by its row in the sheet.
  const file = page.getByLabel(/Excel \(\.xlsx\) or CSV file/);
  await file.setInputFiles(fixture("rescue-pairs-bad.xlsx"));
  await page.getByRole("button", { name: "Upload pairs" }).click();
  await expect(page.getByText(/Nothing was saved: 2 rows to correct\..*Row 2: P001 cannot rescue its own company\..*Row 3: there is no team ZZ99\./)).toBeVisible();
  await expect(table).toContainText("P005");

  // A good sheet replaces every pair; a team without a company is left to the lottery.
  await page.getByLabel(/Excel \(\.xlsx\) or CSV file/).setInputFiles(fixture("rescue-pairs-good.xlsx"));
  await page.getByRole("button", { name: "Upload pairs" }).click();
  await expect(page.getByText(/Saved 3 pairs from the sheet; the previous pairs were replaced\. 1 team without a company is left to the lottery\./)).toBeVisible();
  await expect(table).not.toContainText("P005");
  await expect(table).toContainText("P004");

  // Remove one pair.
  await table.getByRole("row", { name: /P002/ }).getByRole("button", { name: "Remove" }).click();
  await expect(page.getByText("P002's pair removed; the lottery will pair it.")).toBeVisible();
  await expect(table.getByRole("row")).toHaveCount(3); // header + 2 pairs
});

test("two teams chat live in their rescue chat; a ticket opens that chat for the organiser, who replies", async ({ browser }) => {
  const ev = await seedE2eEvent({ slug: "e2e-chats", prefix: "S", teamCount: 4 });
  await ev.n.org("set_rescue_pairs", ev.n.eventId, JSON.stringify([{ rescuer: "S001", founder: "S002" }, { rescuer: "S002", founder: "S001" }]), true);
  await pricesRevealed(ev);
  await ev.n.advanceTo("CRISIS_QA");

  const rescuer = await (await browser.newContext()).newPage();
  const founder = await (await browser.newContext()).newPage();
  await loginAsTeam(rescuer, ev, "S001");
  await loginAsTeam(founder, ev, "S002");
  await rescuer.goto("/team/chat");
  await founder.goto("/team/chat");
  await expect(rescuer.getByRole("heading", { name: /Get information/ })).toBeVisible();
  await expect(rescuer.getByRole("heading", { name: /Give information/ })).toBeVisible();

  // S001 rescues S002's company: it asks in its "get information" chat; S002 sees it in its "give information" chat.
  const ask = rescuer.getByRole("form", { name: /Write in: Chat with .*'s founders/ });
  await ask.getByRole("textbox").fill("Who are your main customers?");
  await ask.getByRole("textbox").press("Enter");
  const askList = rescuer.getByRole("list", { name: /Chat with .*'s founders/ });
  await expect(askList).toContainText("Who are your main customers?");
  await expect(askList.getByTestId("chat-message").first()).toContainText("You");

  const answerList = founder.getByRole("list", { name: /Chat with team S001, rescuing/ });
  await expect(answerList).toContainText("Who are your main customers?", { timeout: 20_000 });
  await expect(answerList).toContainText("S001 (rescuer)");
  const answer = founder.getByRole("form", { name: /Write in: Chat with team S001/ });
  await answer.getByRole("textbox").fill("Kirana shops in coastal towns.");
  await answer.getByRole("button", { name: "Send" }).click();
  await expect(askList).toContainText("Kirana shops in coastal towns.", { timeout: 20_000 });
  await expect(askList).toContainText("S002 (founder)");

  // A third team cannot read this chat (RLS): its own chats do not show these messages.
  const other = await (await browser.newContext()).newPage();
  await loginAsTeam(other, ev, "S003");
  await other.goto("/team/chat");
  await expect(other.getByRole("heading", { name: /Get information/ })).toBeVisible();
  await expect(other.getByText("Who are your main customers?")).toHaveCount(0);

  // S001 raises a ticket about its chat with the founders.
  await rescuer.getByLabel(/What is wrong/).fill("The founders take too long to reply.");
  await rescuer.getByRole("button", { name: "Send ticket" }).click();
  await expect(rescuer.getByText(/Ticket #1 sent\./)).toBeVisible();

  // The organiser sees it, opens the chat it is about, and replies.
  const org = await (await browser.newContext()).newPage();
  await loginAsStaff(org, ev, STAFF.lead);
  await org.goto(`/admin/${ev.slug}/tickets`);
  const ticket = org.getByTestId("ticket").filter({ hasText: "The founders take too long to reply." });
  await expect(ticket).toContainText("S001");
  await expect(ticket).toContainText("about the chat");
  await ticket.getByRole("link", { name: "Read the chat" }).click();
  await expect(org.getByRole("list", { name: /Chat .*S001 rescues S002/ })).toContainText("Kirana shops in coastal towns.");
  const reply = org.getByTestId("ticket").filter({ hasText: "The founders take too long to reply." });
  await reply.getByLabel(/Reply to S001/).fill("We have nudged S002.");
  await reply.getByRole("button", { name: "Send" }).click();
  await expect(org.getByText("Ticket #1 resolved.")).toBeVisible();

  // The team sees the reply without reloading.
  await expect(rescuer.getByTestId("ticket")).toContainText("We have nudged S002.", { timeout: 20_000 });
  await expect(rescuer.getByTestId("ticket")).toContainText("Resolved");

  // The admin rescue page shows the pairs as set by the organiser.
  await org.goto(`/admin/${ev.slug}/rescue`);
  await expect(org.getByRole("region", { name: "Rescue pairs" }).getByRole("row", { name: /S001.*S002/ })).toContainText("Organiser");
});
