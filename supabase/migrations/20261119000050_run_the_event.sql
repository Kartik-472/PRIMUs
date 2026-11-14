-- Run the event by hand. The night's clock runs on planned times (phases, deadlines, trading rounds); these
-- functions let the organiser move that plan instead of waiting for it:
--
--   start_step_now(event, at)      what is planned at `at` happens now, and everything planned after it moves earlier
--                                  by the same amount (the gaps between later steps are kept)
--   delay_step(event, at, minutes) what is planned at `at` and everything after it moves later
--   start_next_phase_now(event, from)  end the current phase and start the next one now, with its schedule pulled in
--   set_manual_starts(event, on)   manual mode: no phase advances by itself, and in Round 2 the clock holds before
--                                  each crisis until the organiser starts it (trading stays open while it holds)
--
-- Every phase start and end, crisis step and trading round is written to event_log (staff only), with whether the
-- organiser did it or the clock did.

alter table public.events add column manual_starts boolean not null default false;

create table public.event_log (
  id bigint generated always as identity primary key,
  event_id uuid not null references public.events (id) on delete cascade,
  at timestamptz not null default clock_timestamp(),
  kind text not null check (kind in ('PHASE', 'CRISIS', 'TRADING', 'CONTROL')),
  what text not null,
  by_organiser boolean not null default false,
  by_name text
);
create index event_log_event_idx on public.event_log (event_id, at);
alter table public.event_log enable row level security;
create policy event_log_read on public.event_log for select to authenticated using (app.is_staff());
grant select on public.event_log to authenticated;

-- Set for the rest of the transaction by the organiser's own actions, so the log can say who did it.
create or replace function app.mark_manual()
returns void
language sql
as $$
  select set_config('msim.manual', coalesce((select display_name from public.accounts where user_id = auth.uid()), 'Organiser'), true);
$$;

create or replace function app.log_event(p_event uuid, p_kind text, p_what text)
returns void
language plpgsql
as $$
declare
  v_by text := nullif(current_setting('msim.manual', true), '');
begin
  insert into public.event_log (event_id, kind, what, by_organiser, by_name)
  values (p_event, p_kind, p_what, v_by is not null, coalesce(v_by, 'Clock'));
end
$$;

create or replace function app.phase_name(p_code public.phase_code)
returns text
language sql immutable
as $$
  select case p_code
    when 'SETUP' then 'Setup' when 'CHECKIN' then 'Check-in' when 'BRIEFING' then 'Briefing'
    when 'SQUAD_DRAW' then 'Squad draw' when 'BUILD' then 'Round 1: Build' when 'READING' then 'Round 1: Judging'
    when 'IPO' then 'IPO' when 'PRESSURE' then 'Round 2: Pressure' when 'SATURATION' then 'Round 3: Saturation'
    when 'CLOSE' then 'Market close' when 'SETTLEMENT' then 'Settlement' when 'APPEALS' then 'Appeals'
    when 'AWARDS' then 'Awards' else initcap(replace(p_code::text, '_', ' ')) end
$$;

-- ───────────────────────────── The log, from the tables themselves ─────────────────────────────

create or replace function app.log_phase()
returns trigger
language plpgsql
as $$
begin
  if new.ended_at is not null and old.ended_at is null then
    perform app.log_event(new.event_id, 'PHASE', app.phase_name(new.code) || ' ended');
  end if;
  if new.started_at is not null and old.started_at is null then
    perform app.log_event(new.event_id, 'PHASE', app.phase_name(new.code) || ' started');
  end if;
  return null;
end
$$;
create trigger log_phase after update of started_at, ended_at on public.phases for each row execute function app.log_phase();

create or replace function app.log_subround()
returns trigger
language plpgsql
as $$
declare
  v_name text := case when new.k = 5 then 'Round 3' else 'Crisis ' || new.k end;
begin
  if new.revealed_at is not null and old.revealed_at is null then
    perform app.log_event(new.event_id, 'CRISIS', 'Crisis ' || new.k || ' revealed (sub-round ' || new.k || ' started)');
  end if;
  if new.hiring_closed_at is not null and old.hiring_closed_at is null then
    perform app.log_event(new.event_id, 'CRISIS', v_name || ': hiring closed');
  end if;
  if new.due_closed_at is not null and old.due_closed_at is null then
    perform app.log_event(new.event_id, 'CRISIS', v_name || ': work due, escrow settled');
  end if;
  if new.rated_at is not null and old.rated_at is null then
    perform app.log_event(new.event_id, 'CRISIS', v_name || ': ratings closed');
  end if;
  return null;
end
$$;
create trigger log_subround after update of revealed_at, hiring_closed_at, due_closed_at, rated_at on public.subrounds
  for each row execute function app.log_subround();

create or replace function app.log_round()
returns trigger
language plpgsql
as $$
begin
  if new.status = 'OPEN' and old.status = 'SCHEDULED' then
    perform app.log_event(new.event_id, 'TRADING', 'Trading round ' || new.number || ' opened');
  elsif new.status = 'CLEARED' and old.status <> 'CLEARED' then
    perform app.log_event(new.event_id, 'TRADING', 'Trading round ' || new.number || ' closed and cleared');
  end if;
  return null;
end
$$;
create trigger log_round after update of status on public.rounds for each row execute function app.log_round();

create or replace function app.log_pause()
returns trigger
language plpgsql
as $$
begin
  if new.paused and not old.paused then
    perform app.log_event(new.id, 'CONTROL', 'Event paused');
  elsif old.paused and not new.paused then
    perform app.log_event(new.id, 'CONTROL', 'Event resumed');
  end if;
  return null;
end
$$;
create trigger log_pause after update of paused on public.events for each row execute function app.log_pause();

revoke all on function app.mark_manual(), app.log_event(uuid, text, text), app.phase_name(public.phase_code), app.log_phase(), app.log_subround(),
  app.log_round(), app.log_pause() from public, anon, authenticated;

-- The organiser's existing buttons count as the organiser's.
select app.patch_functions(
  '  if (select paused from public.events where id = p_event) then
    return app.fail(''PAUSED'', ''Resume the event before advancing.'');
  end if;
  return app.do_advance(p_event, p_from);',
  '  if (select paused from public.events where id = p_event) then
    return app.fail(''PAUSED'', ''Resume the event before advancing.'');
  end if;
  perform app.mark_manual();
  return app.do_advance(p_event, p_from);');

-- ───────────────────────────── Moving the plan earlier ─────────────────────────────

-- Everything planned at or after p_from that has not happened yet moves earlier by p_delta (> 0). Nothing that has
-- happened moves, and an open round never closes before it opened.
create or replace function app.pull_schedule(p_event uuid, p_from timestamptz, p_delta interval)
returns void
language plpgsql
as $$
begin
  if p_delta <= interval '0' then
    return;
  end if;
  update public.phases set starts_at = starts_at - p_delta where event_id = p_event and starts_at >= p_from and started_at is null;
  update public.phases set ends_at = greatest(ends_at - p_delta, starts_at)
   where event_id = p_event and ends_at >= p_from and ended_at is null;
  update public.rounds set opens_at = opens_at - p_delta where event_id = p_event and opens_at >= p_from and status = 'SCHEDULED';
  update public.rounds set closes_at = greatest(closes_at - p_delta, opens_at + interval '1 second')
   where event_id = p_event and closes_at >= p_from and status in ('SCHEDULED', 'OPEN');
  update public.deadlines set at = at - p_delta where event_id = p_event and at >= p_from;
end
$$;
revoke all on function app.pull_schedule(uuid, timestamptz, interval) from public, anon, authenticated;

-- What was planned at p_at happens now: p_at and everything after it moves earlier. p_label names it for the log.
create or replace function public.start_step_now(p_event uuid, p_at timestamptz, p_label text default null)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_event public.events;
  v_now timestamptz := now() - interval '1 second';
begin
  perform app.require_organiser();
  select * into v_event from public.events where id = p_event for no key update;
  if v_event.id is null then
    return app.fail('NO_EVENT', 'No such event.');
  end if;
  if v_event.paused then
    return app.fail('PAUSED', 'Resume the event first.');
  end if;
  if p_at is null or p_at <= now() then
    return app.fail('ALREADY', 'That has already happened.');
  end if;
  perform app.mark_manual();
  perform app.pull_schedule(p_event, p_at, p_at - v_now);
  if p_label is not null then
    perform app.log_event(p_event, 'CONTROL', left(p_label, 120) || ' (started now)');
  end if;
  perform app.broadcast(p_event, 'extended', jsonb_build_object('minutes', -round(extract(epoch from p_at - v_now) / 60)));
  -- Run the clock once now, so what was just pulled in happens at once.
  perform public.tick(p_event);
  return app.ok(jsonb_build_object('moved_minutes', round(extract(epoch from p_at - v_now) / 60)));
end
$$;

-- What is planned at p_at and everything after it moves later by p_minutes.
create or replace function public.delay_step(p_event uuid, p_at timestamptz, p_minutes integer, p_label text default null)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_event public.events;
begin
  perform app.require_organiser();
  if p_minutes < 1 or p_minutes > 120 then
    return app.fail('BAD_MINUTES', 'Add 1 to 120 minutes.');
  end if;
  select * into v_event from public.events where id = p_event for no key update;
  if v_event.id is null then
    return app.fail('NO_EVENT', 'No such event.');
  end if;
  if p_at is null or p_at <= now() then
    return app.fail('ALREADY', 'That has already happened.');
  end if;
  perform app.mark_manual();
  perform app.shift_schedule(p_event, p_at, make_interval(mins => p_minutes));
  perform app.log_event(p_event, 'CONTROL', coalesce(left(p_label, 120), 'Next step') || ': +' || p_minutes || ' min');
  perform app.broadcast(p_event, 'extended', jsonb_build_object('minutes', p_minutes));
  return app.ok();
end
$$;

-- End the current phase and start the next one now. If the next phase was planned for later, its plan (and
-- everything after it) is pulled in first, so its crisis, draft and rounds run on time from now.
create or replace function public.start_next_phase_now(p_event uuid, p_from public.phase_code)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_event public.events;
  v_next public.phase_code;
  v_starts timestamptz;
  v_now timestamptz := now() - interval '1 second';
  v_res jsonb;
begin
  perform app.require_organiser();
  select * into v_event from public.events where id = p_event for no key update;
  if v_event.current_phase is distinct from p_from then
    return app.fail('STALE', format('The event is already in %s.', app.phase_name(v_event.current_phase)));
  end if;
  if v_event.paused then
    return app.fail('PAUSED', 'Resume the event before you start the next phase.');
  end if;
  if app.gate_blocker(p_event) is not null then
    return app.fail('GATE', app.gate_blocker(p_event));
  end if;
  v_next := app.phase_after(p_event, p_from);
  if v_next is null then
    return app.fail('LAST', 'This is the last phase.');
  end if;
  perform app.mark_manual();
  select starts_at into v_starts from public.phases where event_id = p_event and code = v_next;
  if v_starts > v_now then
    perform app.pull_schedule(p_event, v_starts, v_starts - v_now);
  end if;
  -- Round 2 opens with crisis 1: make sure it is due now, not at a time planned apart from the phase.
  if v_next = 'PRESSURE' then
    select at into v_starts from public.deadlines where event_id = p_event and code = 'REVEAL_1';
    if v_starts > v_now then
      perform app.pull_schedule(p_event, v_starts, v_starts - v_now);
    end if;
  end if;
  v_res := app.do_advance(p_event, p_from);
  if (v_res ->> 'ok')::boolean then
    perform public.tick(p_event);
  end if;
  return v_res;
end
$$;

-- Manual mode on: nothing advances by itself (auto-advance off) and Round 2 holds before each crisis. Off: auto-advance
-- back on, and the clock runs the plan.
create or replace function public.set_manual_starts(p_event uuid, p_on boolean)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
begin
  perform app.require_organiser();
  perform 1 from public.events where id = p_event for no key update;
  perform app.mark_manual();
  update public.events set manual_starts = p_on, auto_advance = not p_on where id = p_event;
  perform app.log_event(p_event, 'CONTROL', case when p_on then 'Manual mode on: every round and crisis waits for the organiser'
                                                 else 'Manual mode off: the clock runs the plan' end);
  perform app.broadcast_staff(p_event, 'manual');
  return app.ok();
end
$$;

-- The hold: in manual mode, a Round 2 crisis that is due within a minute and not started is kept two minutes away
-- (with everything after it), until the organiser starts it. The trading round before it stays open meanwhile.
create or replace function app.hold_tick(p_event uuid)
returns text[]
language plpgsql
as $$
declare
  v_event public.events;
  v_at timestamptz;
  v_k int;
begin
  select * into v_event from public.events where id = p_event;
  -- Not while the organiser's own action runs this tick (starting a crisis now must not be held back).
  if not v_event.manual_starts or v_event.current_phase <> 'PRESSURE' or nullif(current_setting('msim.manual', true), '') is not null then
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

select app.patch_functions(
  '  if v_event.format = ''PRIMUS'' then
    v_actions := v_actions || app.primus_tick(p_event);',
  '  if v_event.format = ''PRIMUS'' then
    v_actions := v_actions || app.hold_tick(p_event);
    v_actions := v_actions || app.primus_tick(p_event);');

revoke all on function public.start_step_now(uuid, timestamptz, text), public.delay_step(uuid, timestamptz, integer, text),
  public.start_next_phase_now(uuid, public.phase_code), public.set_manual_starts(uuid, boolean) from public, anon;
grant execute on function public.start_step_now(uuid, timestamptz, text), public.delay_step(uuid, timestamptz, integer, text),
  public.start_next_phase_now(uuid, public.phase_code), public.set_manual_starts(uuid, boolean) to authenticated;
