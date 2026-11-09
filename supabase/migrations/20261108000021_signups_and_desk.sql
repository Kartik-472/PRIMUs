-- Online sign-ups and the registration desk.
--
-- Sign-ups: before the night, students sign their team up on a public page (/register/<event>). Nobody is committed by
-- it: it tells the organisers how many teams and students to expect, and it gives each team a sign-up number
-- (PR-0001…) to bring to the desk. A sign-up does not create a login and is never seen by any team or the projector.
--
-- The desk (control panel → Registration): on the night an organiser looks a team up by its sign-up number (or adds a
-- walk-in team), corrects its name and members, and confirms it. Confirming hands the team the next free printed login
-- card (T001…T200): that team row gets the name and members and becomes ACTIVE (registered), so it plays and is shown
-- everywhere. Only confirmed teams are ever ACTIVE. An organiser can edit a confirmed team or take it off again until
-- the problem cards are dealt.
--
-- Two kinds of team sign up. A Thapar team (THAPAR) gives a team name, and a roll number for every member. A team from
-- another college (OTHER) gives its college and names only; its team name is the college's unless it gives one. Both
-- give the team leader's email and phone. A team has 2 to 5 people, the leader first.

-- Teams are now up to five people (they were up to four).
create or replace function app.members_max_four()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if (select count(*) from public.members m where m.team_id = new.team_id and m.id <> new.id) >= 5 then
    raise exception 'a team has at most five members' using errcode = '23514';
  end if;
  return new;
end
$$;

create table public.signups (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  number int not null check (number between 1 and 9999),
  team_name text not null check (length(btrim(team_name)) between 1 and 80),
  category text not null default 'THAPAR' check (category in ('THAPAR', 'OTHER')),
  -- Another college's name (OTHER teams only).
  college text check (college is null or length(btrim(college)) between 1 and 120),
  contact_email text check (contact_email is null or contact_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  contact_phone text check (contact_phone is null or length(contact_phone) between 6 and 20),
  -- [{full_name, roll_number}], 1 to 5 people, the team leader first. contact_email and contact_phone are the leader's.
  members jsonb not null default '[]' check (jsonb_typeof(members) = 'array' and jsonb_array_length(members) between 1 and 5),
  source text not null default 'ONLINE' check (source in ('ONLINE', 'DESK')),
  -- The login card this team was given at the desk (set when confirmed).
  team_id uuid unique references public.teams (id) on delete set null,
  confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (event_id, number)
);
create index signups_event_idx on public.signups (event_id);
create unique index signups_email_idx on public.signups (event_id, lower(contact_email)) where contact_email is not null;

alter table public.signups enable row level security;
grant select on public.signups to authenticated;
create policy signups_read on public.signups for select to authenticated using ((select app.is_staff()));

-- Sign-ups stay open until the problem cards are dealt; an organiser can close them earlier.
alter table public.events add column signups_open boolean not null default true;

/** "PR-0042" */
create or replace function app.signup_code(p_number int)
returns text language sql immutable as $$ select 'PR-' || lpad(p_number::text, 4, '0') $$;

/** "pr42", "PR-0042", "42" → 42; null if it is not a sign-up number. */
create or replace function app.signup_number(p_text text)
returns int language sql immutable as $$
  select case when upper(regexp_replace(coalesce(p_text, ''), '\s', '', 'g')) ~ '^(PR-?)?0*[0-9]{1,4}$'
              then nullif(regexp_replace(p_text, '[^0-9]', '', 'g'), '')::int end
$$;

/**
 * Cleans a members list: names trimmed, empty rows dropped, roll numbers upper-case. Raises on a bad list: fewer than
 * p_min or more than 5 people, a repeated roll number, or (p_need_roll) a member without a roll number.
 */
create or replace function app.clean_members(p_members jsonb, p_min int default 1, p_need_roll boolean default false)
returns jsonb language plpgsql immutable as $$
declare
  v jsonb;
  m jsonb;
  v_out jsonb := '[]';
  rolls text[] := '{}';
  r text;
begin
  if p_members is null or jsonb_typeof(p_members) <> 'array' then
    raise exception 'members must be a list';
  end if;
  for m in select * from jsonb_array_elements(p_members) loop
    continue when nullif(btrim(coalesce(m ->> 'full_name', '')), '') is null;
    r := nullif(upper(btrim(coalesce(m ->> 'roll_number', ''))), '');
    if length(btrim(m ->> 'full_name')) > 120 then
      raise exception 'a name is at most 120 characters';
    end if;
    if r is null and p_need_roll then
      raise exception 'give a roll number for %', btrim(m ->> 'full_name');
    end if;
    if r is not null and length(r) > 30 then
      raise exception 'a roll number is at most 30 characters';
    end if;
    if r is not null and r = any(rolls) then
      raise exception 'roll number % appears twice', r;
    end if;
    if r is not null then rolls := rolls || r; end if;
    v := jsonb_build_object('full_name', btrim(m ->> 'full_name'), 'roll_number', r);
    v_out := v_out || jsonb_build_array(v);
  end loop;
  if jsonb_array_length(v_out) not between p_min and 5 then
    raise exception 'a team has % to 5 members, including the team leader (got %)', p_min, jsonb_array_length(v_out);
  end if;
  return v_out;
end
$$;

-- ───────────────────────────── The public sign-up ─────────────────────────────

-- Anyone (no login): sign a team up. p_category is THAPAR or OTHER; p_members is the whole team, the leader first (2 to 5
-- people). Returns the sign-up number. One sign-up per leader email; a roll number can be in one sign-up only.
create or replace function public.sign_up(p_slug text, p_category text, p_team_name text, p_college text,
                                          p_contact_email text, p_contact_phone text, p_members jsonb)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_event public.events;
  v_category text := upper(btrim(coalesce(p_category, '')));
  v_college text := nullif(btrim(coalesce(p_college, '')), '');
  v_name text := nullif(btrim(coalesce(p_team_name, '')), '');
  v_members jsonb;
  v_email text := nullif(lower(btrim(coalesce(p_contact_email, ''))), '');
  v_phone text := nullif(regexp_replace(coalesce(p_contact_phone, ''), '[^0-9+]', '', 'g'), '');
  v_existing public.signups;
  v_clash text;
  v_number int;
begin
  select * into v_event from public.events where slug = lower(btrim(coalesce(p_slug, ''))) and not is_rehearsal;
  if v_event.id is null then
    return app.fail('NO_EVENT', 'There is no such event.');
  end if;
  if not v_event.signups_open or v_event.drawn_at is not null then
    return app.fail('CLOSED', 'Sign-ups are closed. You can still register at the desk on the night if there is room.');
  end if;
  if v_category not in ('THAPAR', 'OTHER') then
    return app.fail('BAD_CATEGORY', 'Choose whether your team is from Thapar or from another college.');
  end if;
  if v_category = 'OTHER' then
    if v_college is null or length(v_college) > 120 then
      return app.fail('BAD_COLLEGE', 'Give your college''s name (up to 120 characters).');
    end if;
    v_name := coalesce(v_name, left(v_college, 80));
  else
    v_college := null;
  end if;
  if v_name is null or length(v_name) > 80 then
    return app.fail('BAD_NAME', 'Give your team a name (up to 80 characters).');
  end if;
  if v_email is null or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    return app.fail('BAD_EMAIL', 'Give the team leader''s email.');
  end if;
  if v_phone is null or length(v_phone) not between 6 and 20 then
    return app.fail('BAD_PHONE', 'Give the team leader''s phone number.');
  end if;
  begin
    if v_category = 'OTHER' then
      -- Other colleges give names only.
      v_members := app.clean_members((select coalesce(jsonb_agg(jsonb_build_object('full_name', x ->> 'full_name')), '[]')
                                        from jsonb_array_elements(case when jsonb_typeof(p_members) = 'array' then p_members else '[]' end) x), 2);
    else
      v_members := app.clean_members(p_members, 2, true);
    end if;
  exception when others then
    return app.fail('BAD_MEMBERS', initcap(left(sqlerrm, 1)) || substr(sqlerrm, 2) || '.');
  end;

  -- One sign-up per leader email, one sign-up per student: say which number they already have.
  perform pg_advisory_xact_lock(hashtext('signups:' || v_event.id::text));
  select * into v_existing from public.signups where event_id = v_event.id and lower(contact_email) = v_email;
  if v_existing.id is not null then
    return app.fail('ALREADY', format('This email has already signed up a team: %s. Bring that number to the desk.', app.signup_code(v_existing.number)),
                    jsonb_build_object('number', app.signup_code(v_existing.number)));
  end if;
  select m ->> 'roll_number' into v_clash
    from public.signups s, jsonb_array_elements(s.members) m
   where s.event_id = v_event.id and m ->> 'roll_number' is not null
     and m ->> 'roll_number' in (select x ->> 'roll_number' from jsonb_array_elements(v_members) x)
   limit 1;
  if v_clash is not null then
    return app.fail('ROLL_TAKEN', format('Roll number %s is already in another team''s sign-up.', v_clash));
  end if;
  if (select count(*) from public.signups where event_id = v_event.id) >= 3000 then
    return app.fail('FULL', 'Sign-ups are full.');
  end if;

  v_number := coalesce((select max(number) from public.signups where event_id = v_event.id), 0) + 1;
  insert into public.signups (event_id, number, team_name, category, college, contact_email, contact_phone, members, source)
  values (v_event.id, v_number, v_name, v_category, v_college, v_email, v_phone, v_members, 'ONLINE');
  return app.ok(jsonb_build_object('number', app.signup_code(v_number), 'event', v_event.name));
end
$$;

-- Anyone: is this event taking sign-ups (for the page's heading)?
create or replace function public.signup_event(p_slug text)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object('name', e.name, 'open', e.signups_open and e.drawn_at is null, 'starts_at', e.starts_at)
    from public.events e where e.slug = lower(btrim(coalesce(p_slug, ''))) and not e.is_rehearsal
$$;

-- Organiser: open or close the public sign-ups.
create or replace function public.set_signups_open(p_event uuid, p_open boolean)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
begin
  perform app.require_organiser();
  update public.events set signups_open = p_open where id = p_event;
  if not found then raise exception 'no such event'; end if;
  return app.ok(jsonb_build_object('open', p_open));
end
$$;

-- ───────────────────────────── The registration desk ─────────────────────────────

-- Organiser: confirm a team at the desk. p_signup is a sign-up's id, or null for a walk-in team (a DESK sign-up is
-- made for it). The name and members given replace the sign-up's. An unconfirmed team gets the free login card with
-- the lowest code; a confirmed one keeps its card and only its name and members change. Before the draw only.
create or replace function public.desk_confirm(p_event uuid, p_signup uuid, p_team_name text, p_members jsonb)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_event public.events;
  v_signup public.signups;
  v_team public.teams;
  v_members jsonb;
  v_name text := btrim(coalesce(p_team_name, ''));
  v_actor record;
  v_clash text;
  v_new boolean;
begin
  perform app.require_organiser();
  select * into v_event from public.events where id = p_event for no key update;
  if v_event.id is null then
    raise exception 'no such event';
  end if;
  if v_event.drawn_at is not null then
    return app.fail('TOO_LATE', 'The problem cards have been dealt: the teams playing tonight are fixed.');
  end if;
  if v_name = '' or length(v_name) > 80 then
    return app.fail('BAD_NAME', 'The team needs a name (up to 80 characters).');
  end if;
  begin
    v_members := app.clean_members(p_members);
  exception when others then
    return app.fail('BAD_MEMBERS', initcap(left(sqlerrm, 1)) || substr(sqlerrm, 2) || '.');
  end;

  if p_signup is null then
    insert into public.signups (event_id, number, team_name, members, source)
    values (p_event, coalesce((select max(number) from public.signups where event_id = p_event), 0) + 1, v_name, v_members, 'DESK')
    returning * into v_signup;
  else
    select * into v_signup from public.signups where id = p_signup and event_id = p_event for update;
    if v_signup.id is null then
      return app.fail('NO_SIGNUP', 'There is no such sign-up.');
    end if;
  end if;

  -- A student plays in one team only.
  select m.roll_number into v_clash
    from public.members m
   where m.event_id = p_event and m.roll_number is not null
     and (v_signup.team_id is null or m.team_id <> v_signup.team_id)
     and m.roll_number in (select x ->> 'roll_number' from jsonb_array_elements(v_members) x)
   limit 1;
  if v_clash is not null then
    return app.fail('ROLL_TAKEN', format('Roll number %s is already in a confirmed team (%s).', v_clash,
      (select t.code from public.members m join public.teams t on t.id = m.team_id where m.event_id = p_event and m.roll_number = v_clash)));
  end if;

  v_new := v_signup.team_id is null;
  if v_new then
    select t.* into v_team from public.teams t
     where t.event_id = p_event and t.status <> 'ACTIVE'
       and not exists (select 1 from public.signups s where s.team_id = t.id)
     order by t.code limit 1 for update skip locked;
    if v_team.id is null then
      return app.fail('NO_CARDS', 'Every login card is in use: no free card is left for this team.');
    end if;
  else
    select * into v_team from public.teams where id = v_signup.team_id for update;
  end if;

  update public.teams set name = v_name, status = 'ACTIVE' where id = v_team.id;
  delete from public.members where team_id = v_team.id;
  insert into public.members (event_id, team_id, full_name, roll_number)
  select p_event, v_team.id, x ->> 'full_name', x ->> 'roll_number' from jsonb_array_elements(v_members) x;
  update public.signups
     set team_name = v_name, members = v_members, team_id = v_team.id,
         confirmed_at = coalesce(confirmed_at, now()), updated_at = now()
   where id = v_signup.id;

  select * into v_actor from app.audit_actor();
  insert into public.audit_log (event_id, actor_user_id, actor_role, actor_team_id, action, entity, entity_id, before, after)
  values (p_event, v_actor.user_id, v_actor.role, v_actor.team_id, case when v_new then 'desk_confirm' else 'desk_edit' end,
          'teams', v_team.id,
          jsonb_build_object('signup', app.signup_code(v_signup.number), 'name', v_signup.team_name, 'members', v_signup.members),
          jsonb_build_object('name', v_name, 'members', v_members));
  perform app.broadcast(p_event, 'team_status', jsonb_build_object('code', v_team.code));
  perform app.broadcast(p_event, 'settings', '{}'::jsonb, true);
  return app.ok(jsonb_build_object('card', v_team.code, 'signup', app.signup_code(v_signup.number), 'new', v_new,
    'active', (select count(*) from public.teams where event_id = p_event and status = 'ACTIVE')));
end
$$;

-- Organiser: take a confirmed team off again (it did not stay, or was confirmed by mistake). Its login card is free for
-- the next team: the card's name and members are cleared and it is no longer registered. Before the draw only.
create or replace function public.desk_remove(p_event uuid, p_signup uuid)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_event public.events;
  v_signup public.signups;
  v_team public.teams;
  v_actor record;
begin
  perform app.require_organiser();
  select * into v_event from public.events where id = p_event for no key update;
  if v_event.id is null then
    raise exception 'no such event';
  end if;
  if v_event.drawn_at is not null then
    return app.fail('TOO_LATE', 'The problem cards have been dealt: the teams playing tonight are fixed.');
  end if;
  select * into v_signup from public.signups where id = p_signup and event_id = p_event for update;
  if v_signup.id is null or v_signup.team_id is null then
    return app.fail('NOT_CONFIRMED', 'That team is not confirmed.');
  end if;
  select * into v_team from public.teams where id = v_signup.team_id for update;
  update public.teams set status = 'BACKUP', name = 'Team ' || v_team.code where id = v_team.id;
  delete from public.members where team_id = v_team.id;
  update public.signups set team_id = null, confirmed_at = null, updated_at = now() where id = v_signup.id;

  select * into v_actor from app.audit_actor();
  insert into public.audit_log (event_id, actor_user_id, actor_role, actor_team_id, action, entity, entity_id, before, after)
  values (p_event, v_actor.user_id, v_actor.role, v_actor.team_id, 'desk_remove', 'teams', v_team.id,
          jsonb_build_object('signup', app.signup_code(v_signup.number), 'name', v_team.name), '{}'::jsonb);
  perform app.broadcast(p_event, 'team_status', jsonb_build_object('code', v_team.code));
  perform app.broadcast(p_event, 'settings', '{}'::jsonb, true);
  return app.ok(jsonb_build_object('card', v_team.code,
    'active', (select count(*) from public.teams where event_id = p_event and status = 'ACTIVE')));
end
$$;

-- Organiser: find a sign-up by its number as people type it ("42", "pr42", "PR-0042").
create or replace function public.find_signup(p_event uuid, p_number text)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v public.signups;
begin
  perform app.require_organiser();
  select * into v from public.signups where event_id = p_event and number = app.signup_number(p_number);
  if v.id is null then
    return app.fail('NO_SIGNUP', format('No sign-up %s.', coalesce(nullif(btrim(p_number), ''), '(empty)')));
  end if;
  return app.ok(jsonb_build_object('id', v.id, 'number', app.signup_code(v.number), 'team_name', v.team_name, 'members', v.members,
    'category', v.category, 'college', v.college,
    'contact_email', v.contact_email, 'contact_phone', v.contact_phone,
    'card', (select code from public.teams where id = v.team_id)));
end
$$;

revoke all on function public.sign_up(text, text, text, text, text, text, jsonb) from public;
grant execute on function public.sign_up(text, text, text, text, text, text, jsonb) to anon, authenticated, service_role;
revoke all on function public.signup_event(text) from public;
grant execute on function public.signup_event(text) to anon, authenticated, service_role;
do $$
declare f text;
begin
  foreach f in array array['public.set_signups_open(uuid, boolean)', 'public.desk_confirm(uuid, uuid, text, jsonb)',
                           'public.desk_remove(uuid, uuid)', 'public.find_signup(uuid, text)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
end $$;
revoke all on function app.signup_code(int), app.signup_number(text), app.clean_members(jsonb, int, boolean) from public, anon, authenticated;
