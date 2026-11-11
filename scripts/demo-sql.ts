// Writes one SQL file that loads a demo event into Supabase from the SQL editor, with no keys or command line: the
// logins are created straight in auth.users. Run the migrations first.
//
//   pnpm demo-sql --domain teams.example.org   → out/demo-event.sql and out/demo-logins.txt
//
// The demo event (slug "demo") is a rehearsal with 3 teams per track (P01–P03, C01–C03, F01–F03) plus an organiser,
// a fairness officer and a projector login. Passwords are random each run and only in the logins file.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { eventStartIST } from "@msim/engine";
import { parseArgs } from "./lib/args";
import { buildSeedPlan, crisisCardsFromCsv, problemCardsFromCsv, toSeedPayload } from "./lib/seed-plan";

const args = parseArgs(process.argv.slice(2));
const domain = String(args.domain ?? "teams.example.org").toLowerCase();
const slug = "demo";
const read = (p: string) => readFileSync(p, "utf8");

const plan = buildSeedPlan({
  slug,
  name: "Market Simulation demo",
  rehearsal: true,
  clockSpeed: 10,
  startsAt: eventStartIST(String(args.date ?? "2026-11-20")),
  teamsPerTrack: Number(args["teams-per-track"] ?? 3),
  cardSecret: randomUUID(),
  emailDomain: domain,
  codePrefix: "",
  staff: [
    { email: "organiser@msim.demo", role: "ORGANISER", name: "Demo organiser" },
    { email: "fairness@msim.demo", role: "FAIRNESS", name: "Demo fairness officer" },
    { email: "projector@msim.demo", role: "DISPLAY", name: "Demo projector" },
  ],
  problemCards: problemCardsFromCsv(read("seed/problem-cards.csv")),
  crisisCards: crisisCardsFromCsv(read("seed/crisis-cards.csv")),
});

const logins = [
  ...plan.teams.map((t) => ({ email: t.email, password: t.password, role: "TEAM", label: `${t.code} (${t.track})` })),
  ...plan.staff.map((s) => ({ email: s.email, password: s.password, role: s.role, label: s.role })),
].map((l) => ({ ...l, id: randomUUID() }));
const payload = toSeedPayload(plan, new Map(logins.map((l) => [l.email, l.id])));

const q = (s: string) => `'${s.replace(/'/g, "''")}'`;
const json = (v: unknown) => `${q(JSON.stringify(v))}::jsonb`;

const sql = `-- Market Simulation demo event (${slug}). Paste into the Supabase SQL editor and run, after the migrations.
-- Team logins use the domain ${domain}: it must equal NEXT_PUBLIC_TEAM_EMAIL_DOMAIN on Vercel.
begin;

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

select public.seed_event(${json(payload)});

commit;

select count(*) as teams from public.teams t join public.events e on e.id = t.event_id where e.slug = ${q(slug)};
`;

const cleanup = `-- Remove the demo event and its logins (Supabase SQL editor):
begin;
select public.purge_event('${slug}');
delete from auth.users where email like '%@msim.demo' or email ~ '^[pcf][0-9]{2}@${domain.replace(/\./g, "\\.")}$';
commit;`;

const text = `Market Simulation demo logins (event "${slug}"; demo only)

Sign in at /login.
Staff (the "Organiser" sign-in, with the email):
${logins.filter((l) => l.role !== "TEAM").map((l) => `  ${l.role.padEnd(9)} ${l.email}   ${l.password}`).join("\n")}

Team cards (the team sign-in: code and password):
${logins.filter((l) => l.role === "TEAM").map((l) => `  ${l.label.padEnd(16)} ${l.password}`).join("\n")}

${cleanup}
`;

mkdirSync("out", { recursive: true });
writeFileSync("out/demo-event.sql", sql);
writeFileSync("out/demo-logins.txt", text);
console.log(`Wrote out/demo-event.sql (${Math.round(sql.length / 1024)} KB) and out/demo-logins.txt`);
