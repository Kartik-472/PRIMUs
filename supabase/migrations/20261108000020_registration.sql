-- Registration for a 200-team night.
--
-- The live night prints 200 team logins (T001-T200). Every team starts unregistered (status BACKUP) unless the seed
-- says otherwise; before the lottery draw an organiser ticks the teams that turned up on the Registration tab and saves.
-- Only registered (ACTIVE) teams play: the draw removes the others' companies, so they get no card, crisis, rescue,
-- price, points, place on the leaderboard or award, and their team pages show a "not registered" notice instead of
-- the game. A rehearsal still takes 3 to 200 teams, all registered.

create or replace function public.seed_event(p jsonb)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_e jsonb := p -> 'event';
  v_event uuid;
  v_rehearsal boolean := coalesce((v_e ->> 'is_rehearsal')::boolean, false);
  v_team jsonb;
  v_staff jsonb;
  v_team_id uuid;
  v_n int;
  v_start bigint := coalesce((p ->> 'starting_cash_cents')::bigint, 0);
  v_txn uuid;
begin
  perform set_config('app.actor', 'seed', true);

  -- Team logins: every team starts ACTIVE (registered) or BACKUP (not registered yet / a backup). The live night prints
  -- 200 team logins; only the teams an organiser registers before the draw play. A rehearsal has from 3 to 200 teams.
  v_n := jsonb_array_length(coalesce(p -> 'teams', '[]'));
  if (select count(*) from jsonb_array_elements(coalesce(p -> 'teams', '[]')) x where coalesce(x ->> 'status', 'ACTIVE') not in ('ACTIVE', 'BACKUP')) > 0 then
    raise exception 'a team starts ACTIVE or BACKUP';
  end if;
  if v_n not between 3 and 220 then
    raise exception 'between 3 and 220 team logins are needed (got %)', v_n;
  end if;
  if not v_rehearsal and v_n < 200 then
    raise exception 'the live event needs 200 team logins (got %)', v_n;
  end if;
  if v_start < 0 then
    raise exception 'starting cash cannot be negative';
  end if;

  insert into public.events (slug, name, is_rehearsal, clock_speed, timezone, starts_at, seed_commitment)
  values (
    v_e ->> 'slug',
    v_e ->> 'name',
    v_rehearsal,
    coalesce((v_e ->> 'clock_speed')::int, 1),
    coalesce(v_e ->> 'timezone', 'Asia/Kolkata'),
    (v_e ->> 'starts_at')::timestamptz,
    nullif(v_e ->> 'seed_commitment', '')
  )
  returning id into v_event;

  -- The night's timing is organiser-controlled: durations (null = untimed), not clock times. Nothing has a time until
  -- an organiser starts the event; then every time is projected from the actual starts (app.reproject).
  update public.events
     set twist_offset_seconds = coalesce((p -> 'schedule' ->> 'twist_offset_seconds')::int, twist_offset_seconds),
         freeze_offset_seconds = coalesce((p -> 'schedule' ->> 'freeze_offset_seconds')::int, freeze_offset_seconds)
   where id = v_event;

  insert into public.phases (event_id, seq, code, duration_seconds)
  select v_event, (x ->> 'seq')::smallint, (x ->> 'code')::public.phase_code, (x ->> 'duration_seconds')::int
    from jsonb_array_elements(p -> 'schedule' -> 'phases') x;

  insert into public.rounds (event_id, number, phase, duration_seconds)
  select v_event, (x ->> 'number')::smallint, (x ->> 'phase')::public.phase_code, (x ->> 'duration_seconds')::int
    from jsonb_array_elements(p -> 'schedule' -> 'rounds') x;

  insert into public.deadlines (event_id, code)
  select v_event, c from unnest(enum_range(null::public.deadline_code)) c;

  for v_team in select * from jsonb_array_elements(p -> 'teams') loop
    insert into public.teams (event_id, code, name, status)
    values (v_event, v_team ->> 'code', v_team ->> 'name', coalesce(v_team ->> 'status', 'ACTIVE'))
    returning id into v_team_id;

    insert into public.accounts (user_id, role, team_id, display_name)
    values ((v_team ->> 'user_id')::uuid, 'TEAM', v_team_id, v_team ->> 'code');

    insert into public.members (event_id, team_id, full_name, roll_number)
    select v_event, v_team_id, m ->> 'full_name', nullif(m ->> 'roll_number', '')
      from jsonb_array_elements(coalesce(v_team -> 'members', '[]')) m;

    -- Every team founds one company (Round 1).
    insert into public.companies (event_id, founder_team_id) values (v_event, v_team_id);

    -- Every team starts Round 3 with the same virtual cash, paid by the exchange.
    if v_start <> 0 then
      v_txn := gen_random_uuid();
      insert into public.ledger_entries (event_id, txn_id, kind, team_id, cash_delta_cents, memo)
      values (v_event, v_txn, 'START_CASH', v_team_id, v_start, 'Starting cash'),
             (v_event, v_txn, 'START_CASH', null, -v_start, 'Starting cash');
      update public.teams set cash_cents = cash_cents + v_start where id = v_team_id;
      update public.events set exchange_cash_cents = exchange_cash_cents - v_start where id = v_event;
    end if;
  end loop;

  -- Staff accounts are global (they also run the rehearsal event).
  for v_staff in select * from jsonb_array_elements(coalesce(p -> 'staff', '[]')) loop
    if (v_staff ->> 'role') not in ('ORGANISER', 'FAIRNESS', 'DISPLAY') then
      raise exception 'staff role must be ORGANISER, FAIRNESS or DISPLAY (got %)', v_staff ->> 'role';
    end if;
    if exists (select 1 from public.accounts a
               where a.user_id = (v_staff ->> 'user_id')::uuid and a.role = 'TEAM') then
      raise exception 'staff account % is already a team login', v_staff ->> 'display_name';
    end if;
    insert into public.accounts (user_id, role, display_name, roll_number)
    values ((v_staff ->> 'user_id')::uuid, (v_staff ->> 'role')::public.account_role,
            v_staff ->> 'display_name', nullif(v_staff ->> 'roll_number', ''))
    on conflict (user_id) do update
      set role = excluded.role, display_name = excluded.display_name, roll_number = excluded.roll_number;
  end loop;

  insert into public.problem_cards (event_id, number, sector, title, body)
  select v_event, (x ->> 'number')::smallint, x ->> 'sector', x ->> 'title', x ->> 'body'
    from jsonb_array_elements(coalesce(p -> 'problem_cards', '[]')) x;

  insert into public.crisis_cards (event_id, number, category, title, body)
  select v_event, (x ->> 'number')::smallint, x ->> 'category', x ->> 'title', x ->> 'body'
    from jsonb_array_elements(coalesce(p -> 'crisis_cards', '[]')) x;

  -- The twist is prepared before the night and published at 22:15 (a draft until then).
  if nullif(p -> 'twist' ->> 'title', '') is not null then
    insert into public.bulletins (event_id, kind, title, body)
    values (v_event, 'TWIST', p -> 'twist' ->> 'title', coalesce(p -> 'twist' ->> 'body', ''));
  end if;

  return v_event;
end
$$;


-- Organiser: register exactly the teams in p_codes (ACTIVE); every other team in the event becomes unregistered
-- (BACKUP). Before the draw only. One audit entry lists who was registered and who was taken off.
create or replace function public.set_registration(p_event uuid, p_codes text[])
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_event public.events;
  v_codes text[] := array(select distinct upper(btrim(c)) from unnest(coalesce(p_codes, '{}')) c where btrim(c) <> '');
  v_unknown text[];
  v_on text[];
  v_off text[];
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
  v_unknown := array(select c from unnest(v_codes) c
                      where not exists (select 1 from public.teams t where t.event_id = p_event and t.code = c));
  if cardinality(v_unknown) > 0 then
    return app.fail('NO_TEAM', format('There is no team %s in this event.', array_to_string(v_unknown, ', ')));
  end if;

  with up as (
    update public.teams t set status = 'ACTIVE'
     where t.event_id = p_event and t.code = any(v_codes) and t.status <> 'ACTIVE'
    returning t.code
  ) select coalesce(array_agg(code order by code), '{}') into v_on from up;
  with down as (
    update public.teams t set status = 'BACKUP'
     where t.event_id = p_event and not (t.code = any(v_codes)) and t.status <> 'BACKUP'
    returning t.code
  ) select coalesce(array_agg(code order by code), '{}') into v_off from down;

  if cardinality(v_on) + cardinality(v_off) > 0 then
    select * into v_actor from app.audit_actor();
    insert into public.audit_log (event_id, actor_user_id, actor_role, actor_team_id, action, entity, entity_id, before, after)
    values (p_event, v_actor.user_id, v_actor.role, v_actor.team_id, 'registration', 'events', p_event,
            jsonb_build_object('unregistered', to_jsonb(v_off)), jsonb_build_object('registered', to_jsonb(v_on)));
    perform app.broadcast(p_event, 'team_status', jsonb_build_object('registered', cardinality(v_on), 'unregistered', cardinality(v_off)));
    perform app.broadcast(p_event, 'settings', '{}'::jsonb, true);
  end if;
  return app.ok(jsonb_build_object(
    'registered', cardinality(v_on), 'unregistered', cardinality(v_off),
    'active', (select count(*) from public.teams where event_id = p_event and status = 'ACTIVE')));
end
$$;

revoke all on function public.set_registration(uuid, text[]) from public, anon;
grant execute on function public.set_registration(uuid, text[]) to authenticated, service_role;

-- Trading: unchanged except that an unregistered team cannot place an order.
create or replace function public.place_order(p_company uuid, p_type public.order_type, p_qty integer, p_client_ref text default null)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_team public.teams;
  v_round public.rounds;
  v_check jsonb;
  v_order public.orders;
  v_details jsonb := jsonb_build_object('company_id', p_company, 'type', p_type, 'qty', p_qty);
begin
  -- A team action locks only its own team row (after the throttle). A clearing locks every team of the event
  -- before it reads the orders, so an order either commits before the clearing reads the book or waits for it
  -- and then finds the round closed.
  if app.my_team_id() is null then
    raise exception 'only a team can place orders' using errcode = '42501';
  end if;
  if not app.rate_limit(app.my_team_id(), 'orders', 20, interval '10 seconds') then
    return app.fail('RATE_LIMITED', 'Too many order actions. Wait a few seconds.');
  end if;
  v_team := app.lock_caller_team();
  -- Only a registered team trades: an unregistered one has no say in any price.
  if v_team.status <> 'ACTIVE' then
    return app.fail('NOT_REGISTERED', 'Your team is not registered for tonight, so it cannot trade.');
  end if;
  if p_client_ref is not null then
    select * into v_order from public.orders where team_id = v_team.id and client_ref = p_client_ref;
    if v_order.id is not null then
      return app.ok(jsonb_build_object('order', to_jsonb(v_order), 'duplicate', true));
    end if;
  end if;
  v_round := app.open_round(v_team.event_id);
  v_check := app.check_order(app.order_context(v_team),
                             jsonb_build_object('companyId', p_company::text, 'type', p_type, 'qty', p_qty));
  if not (v_check ->> 'ok')::boolean then
    return app.reject(v_team.event_id, 'place_order', v_check ->> 'code', app.order_message(v_check ->> 'code'), v_details);
  end if;
  if v_round.id is null then
    return app.reject(v_team.event_id, 'place_order', 'TRADING_HALTED', app.order_message('TRADING_HALTED'), v_details);
  end if;
  insert into public.orders (event_id, round_id, team_id, company_id, type, qty, entry_price, reserve_cents, client_ref)
  values (v_team.event_id, v_round.id, v_team.id, p_company, p_type, p_qty,
          (v_check ->> 'entryPrice')::int, (v_check ->> 'reserve')::bigint, p_client_ref)
  returning * into v_order;
  return app.ok(jsonb_build_object('order', to_jsonb(v_order)));
end
$$;
