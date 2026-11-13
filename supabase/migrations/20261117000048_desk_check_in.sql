-- The registration desk: a team can sign in only after the desk has checked it in.
--
-- On the night every team's login card is printed in advance, but a card does nothing until an organiser checks that
-- team in at the registration desk (control panel → Desk): the organiser types the team's name and members, presses
-- Check in, and hands over the card. Until then the login is refused ("check in at the registration desk first"), and a
-- signed-in team that is checked out again loses access at once: the identity helpers below treat it as no team, so it
-- reads nothing of the game and can do nothing.
--
-- The rule is per event (events.desk_check_in). A live event starts with it on; a rehearsal starts with it off, and an
-- organiser can switch it either way on the Desk page (for example to try the desk on the demo event). Events that
-- existed before this migration keep it off, so nobody already playing is locked out.

alter table public.events add column desk_check_in boolean not null default false;
alter table public.teams add column checked_in_at timestamptz;
alter table public.teams add column checked_in_by uuid references auth.users (id) on delete set null;

create or replace function app.events_desk_default()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    new.desk_check_in := not coalesce(new.is_rehearsal, false);
  end if;
  return new;
end
$$;
create trigger events_desk_default before insert on public.events
  for each row execute function app.events_desk_default();

-- Whether a team may use the game now: its event does not require the desk, or the desk has checked it in.
create or replace function app.team_admitted(p_team uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce(
    (select not e.desk_check_in or t.checked_in_at is not null
       from public.teams t join public.events e on e.id = t.event_id
      where t.id = p_team),
    false)
$$;

-- The identity helpers see a team only once it is admitted.
create or replace function app.my_team_id()
returns uuid
language sql stable security definer set search_path = ''
as $$
  select a.team_id from public.accounts a
   where a.user_id = auth.uid() and (a.team_id is null or app.team_admitted(a.team_id))
$$;

create or replace function app.my_event_id()
returns uuid
language sql stable security definer set search_path = ''
as $$
  select t.event_id
  from public.accounts a
  join public.teams t on t.id = a.team_id
  where a.user_id = auth.uid() and app.team_admitted(t.id)
$$;

create or replace function app.my_squad_id()
returns uuid
language sql stable security definer set search_path = ''
as $$
  select s.id
  from public.accounts a
  join public.squads s
    on a.team_id in (s.product_team_id, s.consulting_team_id, s.finance_team_id)
  where a.user_id = auth.uid() and app.team_admitted(a.team_id)
$$;

create or replace function app.lock_caller_team()
returns public.teams
language sql
as $$
  select t.* from public.accounts a join public.teams t on t.id = a.team_id
   where a.user_id = auth.uid() and app.team_admitted(t.id)
   for no key update of t
$$;

-- Asked by the sign-in page right after the password is accepted: is this login a team the desk has not checked in?
create or replace function public.my_desk_status()
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select coalesce(
    (select jsonb_build_object('team', a.team_id is not null, 'admitted', a.team_id is null or app.team_admitted(a.team_id))
       from public.accounts a where a.user_id = auth.uid()),
    jsonb_build_object('team', false, 'admitted', false))
$$;

-- The team list (the roster): the registered teams' details, uploaded from the organisers' Excel sheet before the night
-- (control panel → Desk → Upload team list). The desk finds a team in it, corrects the details and admits it onto a
-- login card. Only staff read it; teams and the projector never see it.
create table public.roster (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  number int not null check (number between 1 and 99999),
  team_name text not null check (length(btrim(team_name)) between 1 and 80),
  track public.track,
  college text check (college is null or length(college) <= 160),
  email text check (email is null or length(email) <= 160),
  phone text check (phone is null or length(phone) <= 40),
  -- [{full_name, roll_number}], the team leader first.
  members jsonb not null default '[]' check (jsonb_typeof(members) = 'array' and jsonb_array_length(members) <= 5),
  -- Anything else the sheet had (column name → text), shown to the desk as it is.
  extra jsonb not null default '{}' check (jsonb_typeof(extra) = 'object'),
  source text not null default 'UPLOAD' check (source in ('UPLOAD', 'DESK')),
  -- The login card this team was admitted on.
  team_id uuid unique references public.teams (id) on delete set null,
  admitted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (event_id, number)
);
create index roster_event_idx on public.roster (event_id);
alter table public.roster enable row level security;
create policy roster_read on public.roster for select to authenticated using ((select app.is_staff()));
grant select on public.roster to authenticated;

-- Load the team list. p_rows: [{team_name, track?, college?, email?, phone?, members: [{full_name, roll_number?}],
-- extra?}]. With p_replace, every team not admitted yet is removed first (admitted teams are kept); new rows are
-- numbered after the highest number in use.
create or replace function public.import_roster(p_event uuid, p_rows jsonb, p_replace boolean)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_r jsonb;
  v_next int;
  v_n int := 0;
  v_track public.track;
begin
  perform app.require_organiser();
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then
    return app.fail('EMPTY', 'The sheet has no teams.');
  end if;
  if jsonb_array_length(p_rows) > 2000 then
    return app.fail('TOO_MANY', 'At most 2,000 teams can be uploaded at once.');
  end if;
  if p_replace then
    delete from public.roster where event_id = p_event and team_id is null;
  end if;
  select coalesce(max(number), 0) + 1 into v_next from public.roster where event_id = p_event;
  for v_r in select x from jsonb_array_elements(p_rows) x loop
    v_track := case upper(left(btrim(coalesce(v_r ->> 'track', '')), 1))
                 when 'P' then 'PRODUCT' when 'C' then 'CONSULTING' when 'F' then 'FINANCE' end;
    insert into public.roster (event_id, number, team_name, track, college, email, phone, members, extra)
    values (p_event, v_next, left(btrim(v_r ->> 'team_name'), 80), v_track,
            nullif(left(btrim(coalesce(v_r ->> 'college', '')), 160), ''),
            nullif(left(btrim(coalesce(v_r ->> 'email', '')), 160), ''),
            nullif(left(btrim(coalesce(v_r ->> 'phone', '')), 40), ''),
            coalesce(v_r -> 'members', '[]'), coalesce(v_r -> 'extra', '{}'));
    v_next := v_next + 1;
    v_n := v_n + 1;
  end loop;
  return app.ok(jsonb_build_object('added', v_n, 'total', (select count(*) from public.roster where event_id = p_event)));
end
$$;

-- Admit a team (check it in), or save changes to one already in (p_edit): its name and 1 to 5 members (the leader
-- first), each a name and an optional roll number. With no card given, the team gets the lowest card of the track not
-- yet checked in. p_roster is the team-list row it came from (null for a walk-in, which is added to the list);
-- p_details holds the list's other fields (college, email, phone), saved back to that row.
create or replace function public.desk_check_in(p_event uuid, p_track public.track, p_code text, p_name text, p_members jsonb,
  p_roster uuid default null, p_edit boolean default false, p_details jsonb default '{}')
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_team public.teams;
  v_name text := btrim(coalesce(p_name, ''));
  v_code text := upper(btrim(coalesce(p_code, '')));
  v_m jsonb;
  v_n int;
  v_new boolean;
  v_roll text;
  v_roster public.roster;
begin
  perform app.require_organiser();
  if v_name = '' or length(v_name) > 80 then
    return app.fail('BAD_NAME', 'Enter the team name (up to 80 characters).');
  end if;
  if p_members is null or jsonb_typeof(p_members) <> 'array' then
    return app.fail('BAD_MEMBERS', 'Enter the team''s members.');
  end if;
  select count(*) into v_n from jsonb_array_elements(p_members) x where btrim(coalesce(x ->> 'full_name', '')) <> '';
  if v_n not between 1 and 5 then
    return app.fail('BAD_MEMBERS', 'A team has 1 to 5 members.');
  end if;

  if p_roster is not null then
    select * into v_roster from public.roster where id = p_roster and event_id = p_event for update;
    if not found then
      return app.fail('NO_ROSTER', 'That team is not in the team list.');
    end if;
    if v_roster.team_id is not null and v_code = '' then
      select code into v_code from public.teams where id = v_roster.team_id;
      p_edit := true;
    end if;
  end if;

  if v_code <> '' then
    select * into v_team from public.teams where event_id = p_event and code = v_code for update;
    if not found then
      return app.fail('NO_CARD', format('There is no login card %s in this event.', v_code));
    end if;
    if v_team.checked_in_at is not null and not coalesce(p_edit, false) then
      return app.fail('CARD_TAKEN', format('Card %s is already checked in to %s.', v_code, v_team.name));
    end if;
  else
    if p_track is null then
      return app.fail('NO_TRACK', 'Choose the team''s track.');
    end if;
    select * into v_team from public.teams
     where event_id = p_event and track = p_track and checked_in_at is null and not disqualified
     order by code limit 1 for update skip locked;
    if not found then
      return app.fail('NO_FREE_CARD', 'Every login card of this track is already checked in.');
    end if;
  end if;

  v_new := v_team.checked_in_at is null;
  update public.teams
     set name = v_name,
         checked_in_at = coalesce(checked_in_at, now()),
         checked_in_by = coalesce(checked_in_by, auth.uid())
   where id = v_team.id
  returning * into v_team;

  delete from public.members where team_id = v_team.id;
  for v_m in select x from jsonb_array_elements(p_members) x where btrim(coalesce(x ->> 'full_name', '')) <> '' loop
    v_roll := nullif(btrim(coalesce(v_m ->> 'roll_number', '')), '');
    if v_roll is not null and exists (select 1 from public.members where event_id = p_event and roll_number = v_roll) then
      raise exception 'roll number % is already in another team', v_roll using errcode = '23505';
    end if;
    insert into public.members (event_id, team_id, full_name, roll_number)
    values (p_event, v_team.id, left(btrim(v_m ->> 'full_name'), 120), v_roll);
  end loop;

  -- The team list keeps the corrected details and which card the team is on.
  if v_roster.id is null then
    select * into v_roster from public.roster where team_id = v_team.id;
  end if;
  if v_roster.id is null then
    insert into public.roster (event_id, number, team_name, track, source)
    values (p_event, (select coalesce(max(number), 0) + 1 from public.roster where event_id = p_event), v_name, v_team.track, 'DESK')
    returning * into v_roster;
  end if;
  update public.roster
     set team_name = v_name, track = v_team.track, team_id = v_team.id, admitted_at = coalesce(admitted_at, now()),
         members = (select coalesce(jsonb_agg(jsonb_build_object('full_name', btrim(x ->> 'full_name'),
                      'roll_number', nullif(btrim(coalesce(x ->> 'roll_number', '')), ''))), '[]')
                      from jsonb_array_elements(p_members) x where btrim(coalesce(x ->> 'full_name', '')) <> ''),
         college = case when p_details ? 'college' then nullif(left(btrim(coalesce(p_details ->> 'college', '')), 160), '') else college end,
         email = case when p_details ? 'email' then nullif(left(btrim(coalesce(p_details ->> 'email', '')), 160), '') else email end,
         phone = case when p_details ? 'phone' then nullif(left(btrim(coalesce(p_details ->> 'phone', '')), 40), '') else phone end,
         updated_at = now()
   where id = v_roster.id;

  return app.ok(jsonb_build_object(
    'card', v_team.code, 'track', v_team.track, 'new', v_new,
    'checked_in', (select count(*) from public.teams where event_id = p_event and checked_in_at is not null)));
exception
  when unique_violation then
    return app.fail('ROLL_TAKEN', sqlerrm);
end
$$;

-- Take a team off again: its login stops working at once (a team already signed in loses access on its next request).
-- Allowed until the lottery draw; after it the squads are fixed.
create or replace function public.desk_check_out(p_event uuid, p_team uuid)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_team public.teams;
begin
  perform app.require_organiser();
  if (select drawn_at from public.events where id = p_event) is not null then
    return app.fail('DRAWN', 'The squads have been drawn: a team cannot be checked out any more.');
  end if;
  update public.teams set checked_in_at = null, checked_in_by = null
   where id = p_team and event_id = p_event
  returning * into v_team;
  if not found then
    return app.fail('NO_CARD', 'That team is not in this event.');
  end if;
  delete from public.members where team_id = v_team.id;
  update public.roster set team_id = null, admitted_at = null, updated_at = now() where team_id = v_team.id;
  return app.ok(jsonb_build_object('card', v_team.code));
end
$$;

-- Switch the rule on or off for an event.
create or replace function public.set_desk_check_in(p_event uuid, p_on boolean)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
begin
  perform app.require_organiser();
  update public.events set desk_check_in = coalesce(p_on, false) where id = p_event;
  if not found then
    return app.fail('NO_EVENT', 'No such event.');
  end if;
  return app.ok(jsonb_build_object('on', coalesce(p_on, false)));
end
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'public.desk_check_in(uuid, public.track, text, text, jsonb, uuid, boolean, jsonb)', 'public.import_roster(uuid, jsonb, boolean)', 'public.desk_check_out(uuid, uuid)',
    'public.set_desk_check_in(uuid, boolean)', 'public.my_desk_status()'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

-- Internal: called only from the SECURITY DEFINER helpers and the trigger.
revoke all on function app.team_admitted(uuid) from public, anon, authenticated;
revoke all on function app.events_desk_default() from public, anon, authenticated;
