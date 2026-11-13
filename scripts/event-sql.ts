// Writes the files to create an event (the live night or a rehearsal) from the Supabase SQL editor, with no service
// key on any laptop: out/<slug>-event.sql (logins and event in one transaction), out/<slug>-login-cards.pdf (one
// card per team, eight per A4 page) and out/<slug>-logins.txt (every password; keep it private).
//
//   pnpm event-sql --slug primus-2026 --name "PRIMUS 2026" --date 2026-11-20 --staff seed/staff.csv \
//     --problems seed/sectors/problem-cards.csv --crises seed/sectors/crisis-cards.csv \
//     --domain teams.primus.mrdev4u.com --app-url https://primus.mrdev4u.com
//
// Takes every option of pnpm seed (pnpm seed --help). Team names are placeholders unless --teams is given: the
// registration desk renames each team when it admits it. CARD_SECRET is random unless set (set it to reprint the same
// passwords). A live event starts with desk check-in on: printed cards sign in only after the desk admits the team.

import { mkdirSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { parseArgs } from "./lib/args";
import { renderLoginCards } from "./lib/cards";
import { USAGE, optionsFromArgs } from "./lib/event-options";
import { eventSql } from "./lib/event-sql";
import { buildSeedPlan } from "./lib/seed-plan";

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(`${USAGE}\n  --domain <domain>        team email domain (= NEXT_PUBLIC_TEAM_EMAIL_DOMAIN)\n  --app-url <url>          printed on the cards`);
    return;
  }
  process.env.CARD_SECRET ??= randomUUID();
  if (typeof args.domain === "string") process.env.TEAM_EMAIL_DOMAIN = args.domain.toLowerCase();
  const plan = buildSeedPlan(optionsFromArgs(args));
  const slug = plan.event.slug;
  const appUrl = String(args["app-url"] ?? process.env.APP_URL ?? "https://your-app.vercel.app").replace(/\/$/, "");
  const { sql, logins } = eventSql(
    plan,
    `-- ${plan.event.name} (${slug}${plan.event.is_rehearsal ? ", rehearsal" : ""}): ${plan.teams.length} teams, ${plan.staff.length} staff.
-- Paste into the Supabase SQL editor and run once, after the migrations. Team logins use ${process.env.TEAM_EMAIL_DOMAIN}:
-- it must equal NEXT_PUBLIC_TEAM_EMAIL_DOMAIN on Vercel.`,
  );
  mkdirSync("out", { recursive: true });
  writeFileSync(`out/${slug}-event.sql`, sql);
  const pdf = await renderLoginCards(
    plan.teams.map((t) => ({ code: t.code, password: t.password, track: t.track, teamName: t.name })),
    { eventName: plan.event.name, loginUrl: `${appUrl}/login`, rehearsal: plan.event.is_rehearsal },
  );
  writeFileSync(`out/${slug}-login-cards.pdf`, pdf);
  writeFileSync(
    `out/${slug}-logins.txt`,
    `${plan.event.name} logins (${slug}). Private: these sign in to the event.\n\nStaff (Organiser sign-in, with the email):\n` +
      logins.filter((l) => l.role !== "TEAM").map((l) => `  ${l.role.padEnd(9)} ${l.email}   ${l.password}`).join("\n") +
      `\n\nTeam cards:\n` +
      logins.filter((l) => l.role === "TEAM").map((l) => `  ${l.label.padEnd(16)} ${l.password}`).join("\n") +
      `\n\nCARD_SECRET (keep it to reprint the same cards): ${process.env.CARD_SECRET}\n`,
  );
  console.log(
    `Wrote out/${slug}-event.sql (${Math.round(sql.length / 1024)} KB), out/${slug}-login-cards.pdf and out/${slug}-logins.txt: ` +
      `${plan.teams.length} teams, ${plan.staff.length} staff, ${plan.problem_cards.length} problem cards, ${plan.crisis_cards.length} crisis cards.`,
  );
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
