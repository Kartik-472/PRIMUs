-- Online registration before the night: a public form (/register) where a team signs up and is given its serial
-- number, the team's ID until the night. Sign-ups land in the team list (roster) as source ONLINE, so the desk finds
-- them by number, edits their details, picks their track from the dropdown and admits them onto a login card.
--
-- The form is served by the web app's server, which calls register_team with the service role: anon still executes
-- no function, and every sign-up passes the server's checks first.

alter table public.events add column if not exists registration_open boolean not null default false;

alter table public.roster drop constraint if exists roster_source_check;
alter table public.roster add constraint roster_source_check check (source in ('UPLOAD', 'DESK', 'ONLINE'));

-- The event the form signs teams up for: the named one, or else the newest event with registration open.
create or replace function public.registration_info(p_slug text default null)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select coalesce(
    (select jsonb_build_object('slug', e.slug, 'name', e.name, 'open', e.registration_open,
                               'registered', (select count(*) from public.roster r where r.event_id = e.id))
       from public.events e
      where (p_slug is not null and e.slug = p_slug) or (p_slug is null and e.registration_open)
      order by e.created_at desc limit 1),
    jsonb_build_object('open', false))
$$;

-- One team's sign-up. p_form: {category: THAPAR|OUTSIDE, team_name, college (OUTSIDE), leader_email, leader_phone,
-- members: [{full_name, roll_number}] with the leader first, 2 to 5 of them; Thapar teams give every roll number}.
-- Returns the team's serial number. The same leader email signs up once per event.
create or replace function public.register_team(p_slug text, p_form jsonb)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_event public.events;
  v_cat text := upper(btrim(coalesce(p_form ->> 'category', '')));
  v_name text := btrim(coalesce(p_form ->> 'team_name', ''));
  v_college text := btrim(coalesce(p_form ->> 'college', ''));
  v_email text := lower(btrim(coalesce(p_form ->> 'leader_email', '')));
  v_phone text := btrim(coalesce(p_form ->> 'leader_phone', ''));
  v_members jsonb;
  v_n int;
  v_missing_roll int;
  v_number int;
  v_dup int;
begin
  select * into v_event from public.events where slug = p_slug;
  if not found or not v_event.registration_open then
    return app.fail('CLOSED', 'Registration is closed.');
  end if;
  if v_cat not in ('THAPAR', 'OUTSIDE') then
    return app.fail('BAD_CATEGORY', 'Choose Thapar student or outside Thapar.');
  end if;
  if v_name = '' or length(v_name) > 80 then
    return app.fail('BAD_NAME', 'Enter the team name (up to 80 characters).');
  end if;
  if v_cat = 'OUTSIDE' and (v_college = '' or length(v_college) > 160) then
    return app.fail('BAD_COLLEGE', 'Enter your college name.');
  end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or length(v_email) > 160 then
    return app.fail('BAD_EMAIL', 'Enter the team leader''s email.');
  end if;
  if regexp_replace(v_phone, '[^0-9]', '', 'g') !~ '^[0-9]{10,13}$' or length(v_phone) > 40 then
    return app.fail('BAD_PHONE', 'Enter the team leader''s phone number (10 digits).');
  end if;
  if p_form -> 'members' is null or jsonb_typeof(p_form -> 'members') <> 'array' then
    return app.fail('BAD_MEMBERS', 'Enter the team''s members.');
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
           'full_name', left(btrim(x ->> 'full_name'), 120),
           'roll_number', nullif(left(btrim(coalesce(x ->> 'roll_number', '')), 40), '')) order by i), '[]')
    into v_members
    from jsonb_array_elements(p_form -> 'members') with ordinality as m(x, i)
   where btrim(coalesce(x ->> 'full_name', '')) <> '';
  v_n := jsonb_array_length(v_members);
  if v_n not between 2 and 5 then
    return app.fail('BAD_MEMBERS', 'A team has 2 to 5 members, the leader included.');
  end if;
  if v_cat = 'THAPAR' then
    select count(*) into v_missing_roll from jsonb_array_elements(v_members) x where x ->> 'roll_number' is null;
    if v_missing_roll > 0 then
      return app.fail('BAD_ROLL', 'Enter every member''s roll number.');
    end if;
  end if;

  -- One number at a time per event, so two sign-ups never get the same one.
  perform pg_advisory_xact_lock(hashtextextended('roster:' || v_event.id::text, 0));
  select number into v_dup from public.roster where event_id = v_event.id and lower(email) = v_email limit 1;
  if found then
    return app.fail('ALREADY', format('This email has already registered a team: your team number is %s.', v_dup),
                    jsonb_build_object('number', v_dup));
  end if;
  if (select count(*) from public.roster where event_id = v_event.id) >= 3000 then
    return app.fail('FULL', 'Registration is full.');
  end if;
  select coalesce(max(number), 0) + 1 into v_number from public.roster where event_id = v_event.id;
  insert into public.roster (event_id, number, team_name, college, email, phone, members, extra, source)
  values (v_event.id, v_number, v_name,
          case when v_cat = 'THAPAR' then 'Thapar Institute' else v_college end,
          v_email, v_phone, v_members,
          jsonb_build_object('Category', case when v_cat = 'THAPAR' then 'Thapar student' else 'Outside Thapar' end,
                             'Registered', to_char(now() at time zone v_event.timezone, 'DD Mon HH24:MI')),
          'ONLINE');
  return app.ok(jsonb_build_object('number', v_number, 'team_name', v_name));
end
$$;

-- Open or close the online form.
create or replace function public.set_registration_open(p_event uuid, p_on boolean)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
begin
  perform app.require_organiser();
  update public.events set registration_open = coalesce(p_on, false) where id = p_event;
  if not found then
    return app.fail('NO_EVENT', 'No such event.');
  end if;
  return app.ok(jsonb_build_object('on', coalesce(p_on, false)));
end
$$;

-- Edit a registered team that is not admitted yet: name, track, contact details and members. (An admitted team is
-- edited through desk_check_in, which also updates its login card.)
create or replace function public.update_roster(p_roster uuid, p_name text, p_track public.track, p_members jsonb,
  p_details jsonb default '{}')
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_row public.roster;
  v_name text := btrim(coalesce(p_name, ''));
  v_n int;
begin
  perform app.require_organiser();
  select * into v_row from public.roster where id = p_roster for update;
  if not found then
    return app.fail('NO_ROSTER', 'That team is not in the team list.');
  end if;
  if v_row.team_id is not null then
    return app.fail('ADMITTED', 'This team is already admitted: edit it from the admitted list.');
  end if;
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
  update public.roster
     set team_name = v_name, track = p_track,
         members = (select coalesce(jsonb_agg(jsonb_build_object('full_name', left(btrim(x ->> 'full_name'), 120),
                      'roll_number', nullif(left(btrim(coalesce(x ->> 'roll_number', '')), 40), '')) order by i), '[]')
                      from jsonb_array_elements(p_members) with ordinality as m(x, i) where btrim(coalesce(x ->> 'full_name', '')) <> ''),
         college = case when p_details ? 'college' then nullif(left(btrim(coalesce(p_details ->> 'college', '')), 160), '') else college end,
         email = case when p_details ? 'email' then nullif(left(btrim(coalesce(p_details ->> 'email', '')), 160), '') else email end,
         phone = case when p_details ? 'phone' then nullif(left(btrim(coalesce(p_details ->> 'phone', '')), 40), '') else phone end,
         updated_at = now()
   where id = p_roster;
  return app.ok(jsonb_build_object('number', v_row.number));
end
$$;

revoke all on function public.registration_info(text) from public, anon, authenticated;
revoke all on function public.register_team(text, jsonb) from public, anon, authenticated;
grant execute on function public.registration_info(text) to service_role;
grant execute on function public.register_team(text, jsonb) to service_role;

do $$
declare f text;
begin
  foreach f in array array['public.set_registration_open(uuid, boolean)', 'public.update_roster(uuid, text, public.track, jsonb, jsonb)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
