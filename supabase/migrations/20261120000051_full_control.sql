-- Full control of every round (Run event page).
--
--   set_hold_steps(event, on)    in manual mode, every step inside a round also waits for the organiser: when the next
--                                step of the current phase (problem pick, PRD due, consultant call, IPO bids, each
--                                crisis's hiring, plans due and ratings, the Round 3 draft, hiring, solutions and
--                                ratings) comes due, the clock holds two minutes before it, with everything after it,
--                                until the organiser presses "Do it now". Off: those steps run on their timers.
--   open_round_now(event, n)     opens trading window n now (the next one), for its planned length.
--
-- The hold moves the plan the way "+ time" does (app.shift_schedule): an open trading window stays open while it holds.

alter table public.events add column if not exists hold_steps boolean not null default false;

-- The phase a deadline belongs to on a PRIMUS night (NULL for the classic game's codes).
create or replace function app.step_phase(p_code public.deadline_code)
returns public.phase_code
language sql immutable
as $$
  select case
    when p_code::text in ('PROBLEM_PICK', 'PITCH') then 'BUILD'::public.phase_code
    when p_code::text = 'CALL_1' then 'READING'::public.phase_code
    when p_code::text = 'IPO_BIDS' then 'IPO'::public.phase_code
    when p_code::text ~ '^(REVEAL|HIRE|DUE|RATE)_[1-4]$' then 'PRESSURE'::public.phase_code
    when p_code::text in ('DRAFT', 'HIRE_5', 'DUE_5', 'RATE_5') then 'SATURATION'::public.phase_code
  end
$$;
revoke all on function app.step_phase(public.deadline_code) from public, anon, authenticated;

-- The hold, now for every step when hold_steps is on (before: only Round 2's crises 2 to 4).
create or replace function app.hold_tick(p_event uuid)
returns text[]
language plpgsql
as $$
declare
  v_event public.events;
  v_at timestamptz;
  v_code text;
  v_k int;
begin
  select * into v_event from public.events where id = p_event;
  -- Not while the organiser's own action runs this tick (a step started now must not be held back).
  if not v_event.manual_starts or v_event.paused or nullif(current_setting('msim.manual', true), '') is not null then
    return '{}';
  end if;
  if v_event.hold_steps then
    -- The current phase's next step that has not happened: a crisis not yet revealed, or a deadline still ahead.
    select d.code::text, d.at into v_code, v_at
      from public.deadlines d
     where d.event_id = p_event
       and app.step_phase(d.code) = v_event.current_phase
       and case when d.code::text like 'REVEAL\_%'
                then not exists (select 1 from public.subrounds s
                                  where s.event_id = p_event and s.k = substr(d.code::text, 8)::int and s.revealed_at is not null)
                else d.at > now() end
     order by d.at
     limit 1;
    if v_code is not null and v_at < now() + interval '1 minute' then
      perform app.shift_schedule(p_event, v_at, (now() + interval '2 minutes') - v_at);
      return array['holding before ' || v_code];
    end if;
    return '{}';
  end if;
  if v_event.current_phase <> 'PRESSURE' then
    return '{}';
  end if;
  for v_k in 2..4 loop
    continue when exists (select 1 from public.subrounds s where s.event_id = p_event and s.k = v_k and s.revealed_at is not null);
    select at into v_at from public.deadlines where event_id = p_event and code = ('REVEAL_' || v_k)::public.deadline_code;
    if v_at is not null and v_at < now() + interval '1 minute' then
      perform app.shift_schedule(p_event, v_at, (now() + interval '2 minutes') - v_at);
      return array['holding before crisis ' || v_k];
    end if;
    return '{}';
  end loop;
  return '{}';
end
$$;
revoke all on function app.hold_tick(uuid) from public, anon, authenticated;

-- Every step waits for the organiser (only in manual mode).
create or replace function public.set_hold_steps(p_event uuid, p_on boolean)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_event public.events;
begin
  perform app.require_organiser();
  select * into v_event from public.events where id = p_event for no key update;
  if v_event.id is null then
    return app.fail('NO_EVENT', 'No such event.');
  end if;
  if p_on and not v_event.manual_starts then
    return app.fail('NOT_MANUAL', 'Switch to manual first.');
  end if;
  perform app.mark_manual();
  update public.events set hold_steps = p_on where id = p_event;
  perform app.log_event(p_event, 'CONTROL', case when p_on then 'Every step waits for the organiser'
                                                 else 'Steps inside a round run on their timers' end);
  perform app.broadcast_staff(p_event, 'manual');
  return app.ok();
end
$$;

-- Manual mode off also ends "every step waits".
select app.patch_functions(
  'update public.events set manual_starts = p_on, auto_advance = not p_on where id = p_event;',
  'update public.events set manual_starts = p_on, auto_advance = not p_on, hold_steps = hold_steps and p_on where id = p_event;');

-- Open trading window n now, for its planned length. Only the next window, and only when none is open.
create or replace function public.open_round_now(p_event uuid, p_number integer)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_event public.events;
  v_round public.rounds;
  v_next integer;
begin
  perform app.require_organiser();
  select * into v_event from public.events where id = p_event for no key update;
  if v_event.id is null then
    return app.fail('NO_EVENT', 'No such event.');
  end if;
  if v_event.paused then
    return app.fail('PAUSED', 'Resume the event first.');
  end if;
  if exists (select 1 from public.rounds where event_id = p_event and status = 'OPEN') then
    return app.fail('ROUND_OPEN', 'A trading window is already open. Close it first.');
  end if;
  select min(number) into v_next from public.rounds where event_id = p_event and status = 'SCHEDULED';
  select * into v_round from public.rounds where event_id = p_event and number = p_number for update;
  if v_round.number is null or v_round.status <> 'SCHEDULED' then
    return app.fail('ALREADY', format('Window %s has already opened.', p_number));
  end if;
  if v_next is distinct from p_number then
    return app.fail('NOT_NEXT', format('Window %s opens first.', v_next));
  end if;
  if v_round.phase is distinct from v_event.current_phase then
    return app.fail('WRONG_PHASE', format('Window %s belongs to %s.', p_number, app.phase_name(v_round.phase)));
  end if;
  perform app.mark_manual();
  update public.rounds
     set closes_at = now() + (closes_at - opens_at), opens_at = now() - interval '1 second'
   where event_id = p_event and number = p_number;
  perform app.log_event(p_event, 'CONTROL', format('Trading window %s opened now', p_number));
  perform public.tick(p_event);
  return app.ok();
end
$$;

revoke all on function public.set_hold_steps(uuid, boolean), public.open_round_now(uuid, integer) from public, anon;
grant execute on function public.set_hold_steps(uuid, boolean), public.open_round_now(uuid, integer) to authenticated;
