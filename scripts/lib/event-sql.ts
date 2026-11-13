// One SQL file that loads an event into Supabase from the SQL editor, with no keys or command line: the logins are
// created straight in auth.users (bcrypt through pgcrypto), then public.seed_event() writes the event. Used by
// demo-sql.ts (the demo) and event-sql.ts (the live night or a rehearsal).

import { randomUUID } from "node:crypto";
import { toSeedPayload, type SeedPlan } from "./seed-plan";

export interface SqlLogin {
  id: string;
  email: string;
  password: string;
  role: string;
  label: string;
}

const q = (s: string) => `'${s.replace(/'/g, "''")}'`;
const json = (v: unknown) => `${q(JSON.stringify(v))}::jsonb`;

export function eventSql(plan: SeedPlan, heading: string): { sql: string; logins: SqlLogin[] } {
  const logins: SqlLogin[] = [
    ...plan.teams.map((t) => ({ email: t.email, password: t.password, role: "TEAM", label: `${t.code} (${t.track})` })),
    ...plan.staff.map((s) => ({ email: s.email, password: s.password, role: s.role, label: s.role })),
  ].map((l) => ({ ...l, id: randomUUID() }));
  const payload = toSeedPayload(plan, new Map(logins.map((l) => [l.email, l.id])));
  const slug = plan.event.slug;

  const sql = `${heading}
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
  return { sql, logins };
}
