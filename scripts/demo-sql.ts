// Writes one SQL file that loads a demo event into an empty-or-not Supabase database from the SQL editor, with no
// keys or command line: the logins are created straight in auth.users. Run the migrations first.
//
//   pnpm demo-sql --domain teams.primus.example     → out/demo-event.sql and out/demo-logins.txt
//
// The demo event (slug "demo") has 30 team cards D001…D030, all unregistered, plus an organiser, a fairness officer
// and a projector login. Three teams are confirmed at the desk already (D001–D003, so the team portal can be tried
// at once) and two sign-ups are waiting for the desk: PR-0004 (Thapar) and PR-0005 (another college). The demo
// passwords are printed in the logins file; they are not the live night's passwords.
//
// To remove it later, run the cleanup at the end of the logins file.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { eventStartIST } from "@msim/engine";
import { parseArgs } from "./lib/args";
import { bulletinFromCsv, buildSeedPlan, crisisCardsFromCsv, problemCardsFromCsv, toSeedPayload } from "./lib/seed-plan";

const args = parseArgs(process.argv.slice(2));
const domain = String(args.domain ?? "teams.primus.example").toLowerCase();
const slug = "demo";
const read = (p: string) => readFileSync(p, "utf8");

const plan = buildSeedPlan({
  slug,
  name: "PRIMUS demo",
  rehearsal: true,
  clockSpeed: 10,
  startsAt: eventStartIST("2026-11-20"),
  teamCount: 30,
  codeLetter: "D",
  backupCount: 0,
  registration: true,
  // Random each run: the demo passwords exist only in the logins file this writes.
  cardSecret: randomUUID(),
  emailDomain: domain,
  staff: [
    { email: "organiser@primus.demo", role: "ORGANISER", name: "Demo organiser" },
    { email: "fairness@primus.demo", role: "FAIRNESS", name: "Demo fairness officer" },
    { email: "projector@primus.demo", role: "DISPLAY", name: "Demo projector" },
  ],
  problemCards: problemCardsFromCsv(read("seed/problem-cards.csv")),
  crisisCards: crisisCardsFromCsv(read("seed/crisis-cards.csv")),
  twist: bulletinFromCsv(read("seed/twist.csv"), "twist"),
});

const logins = [
  ...plan.teams.map((t) => ({ email: t.email, password: t.password, role: "TEAM", label: t.code })),
  ...plan.staff.map((s) => ({ email: s.email, password: s.password, role: s.role, label: s.role })),
].map((l) => ({ ...l, id: randomUUID() }));
const ids = new Map(logins.map((l) => [l.email, l.id]));
const payload = toSeedPayload(plan, ids);

const q = (s: string) => `'${s.replace(/'/g, "''")}'`;
const json = (v: unknown) => `${q(JSON.stringify(v))}::jsonb`;
const thapar = (team: string, people: [string, string][]) => people.map(([full_name, roll_number]) => ({ full_name, roll_number }));

const sql = `-- PRIMUS demo event (${slug}). Paste into the Supabase SQL editor and run, after the migrations.
-- Team logins use the domain ${domain}: it must equal NEXT_PUBLIC_TEAM_EMAIL_DOMAIN on Vercel.
begin;

-- 1. The logins (team cards and staff), created as confirmed email logins.
with l(id, email, password, role) as (
  select (x ->> 'id')::uuid, x ->> 'email', x ->> 'password', x ->> 'role'
    from jsonb_array_elements(${json(logins.map(({ id, email, password, role }) => ({ id, email, password, role })))}) x
), u as (
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                          raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
                          confirmation_token, email_change, email_change_token_new, recovery_token)
  select '00000000-0000-0000-0000-000000000000', id, 'authenticated', 'authenticated', email,
         extensions.crypt(password, extensions.gen_salt('bf')), now(),
         jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email'), 'msim_role', role), '{}'::jsonb,
         now(), now(), '', '', '', ''
    from l
  returning id, email
)
insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
select gen_random_uuid(), id, id::text, jsonb_build_object('sub', id::text, 'email', email, 'email_verified', true), 'email', now(), now(), now()
  from u;

-- 2. The event, its 30 team cards (unregistered), the staff, the decks and the twist.
select public.seed_event(${json(payload)});

-- 3. A live-style event: the public sign-up page works and only teams confirmed at the desk play.
update public.events set is_rehearsal = false where slug = ${q(slug)};

-- 4. Five sign-ups. 1 to 3 are confirmed at the desk (they get D001, D002, D003); 4 and 5 wait for the desk.
select public.sign_up(${q(slug)}, 'THAPAR', 'Alpha Traders', null, 'alpha@demo.primus', '9876500001',
  ${json(thapar("alpha", [["Aarav Sharma", "102103001"], ["Diya Verma", "102103002"], ["Kabir Singh", "102103003"]]))});
select public.sign_up(${q(slug)}, 'THAPAR', 'Bull Run', null, 'bull@demo.primus', '9876500002',
  ${json(thapar("bull", [["Ishaan Gupta", "102103011"], ["Meera Nair", "102103012"], ["Rohan Mehta", "102103013"], ["Sara Khan", "102103014"], ["Vivaan Jain", "102103015"]]))});
select public.sign_up(${q(slug)}, 'OTHER', '', 'PEC Chandigarh', 'pec@demo.primus', '9876500003',
  ${json([{ full_name: "Ananya Rao" }, { full_name: "Dev Malhotra" }])});
select public.sign_up(${q(slug)}, 'THAPAR', 'Candle Stick', null, 'candle@demo.primus', '9876500004',
  ${json(thapar("candle", [["Tara Bose", "102103021"], ["Arjun Das", "102103022"]]))});
select public.sign_up(${q(slug)}, 'OTHER', 'Chitkara Capital', 'Chitkara University', 'chitkara@demo.primus', '9876500005',
  ${json([{ full_name: "Neha Kapoor" }, { full_name: "Raghav Bansal" }, { full_name: "Simran Kaur" }, { full_name: "Yash Arora" }])});
select public.desk_confirm(e.id, s.id, s.team_name, s.members)
  from public.events e join public.signups s on s.event_id = e.id
 where e.slug = ${q(slug)} and s.number <= 3
 order by s.number;

commit;

-- Check: 30 cards, 3 registered, 5 sign-ups.
select (select count(*) from public.teams t join public.events e on e.id = t.event_id where e.slug = ${q(slug)}) as cards,
       (select count(*) from public.teams t join public.events e on e.id = t.event_id where e.slug = ${q(slug)} and t.status = 'ACTIVE') as registered,
       (select count(*) from public.signups s join public.events e on e.id = s.event_id where e.slug = ${q(slug)}) as signups;
`;

const cleanup = `-- Remove the demo event and its logins (Supabase SQL editor):
begin;
update public.events set is_rehearsal = true where slug = '${slug}';
select public.purge_event('${slug}');
delete from auth.users where email like '%@primus.demo' or email ~ '^d[0-9]{3}@${domain.replace(/\./g, "\\.")}$';
commit;`;

const card = (l: (typeof logins)[number]) =>
  l.role === "TEAM" ? `  ${l.label}   ${l.password}` : `  ${l.role.padEnd(9)} ${l.email}   ${l.password}`;
const text = `PRIMUS demo logins (event "${slug}"; demo only, not the live night's passwords)

Sign in at /login.
Staff (the "Organiser" sign-in, with the email):
${logins.filter((l) => l.role !== "TEAM").map(card).join("\n")}

Team cards (the team sign-in: code and password). D001–D003 are registered; the rest wait for the desk.
${logins.filter((l) => l.role === "TEAM").map(card).join("\n")}

${cleanup}
`;

mkdirSync("out", { recursive: true });
writeFileSync("out/demo-event.sql", sql);
writeFileSync("out/demo-logins.txt", text);
console.log(`Wrote out/demo-event.sql (${Math.round(sql.length / 1024)} KB) and out/demo-logins.txt`);
