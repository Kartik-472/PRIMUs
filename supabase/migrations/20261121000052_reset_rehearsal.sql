-- Reset a rehearsal (the demo) from the Run event page: the event goes back to a fresh Setup with the same teams,
-- staff, logins and cards, its plan starting 5 minutes from now; manual mode stays as it was.
--
--   app.seed_payloads            the payload each rehearsal was seeded with (saved by seed_event)
--   public.reset_rehearsal(ev)   organisers only, rehearsals only: purge the event and seed it again from its payload
--
-- A live (non-rehearsal) event is never reset.

create table if not exists app.seed_payloads (
  slug text primary key,
  payload jsonb not null,
  saved_at timestamptz not null default now()
);
revoke all on app.seed_payloads from public, anon, authenticated;

-- seed_event keeps the payload of every rehearsal it seeds.
select app.patch_functions(
  '  perform set_config(''app.actor'', ''seed'', true);

  select count(*) filter (where x ->> ''track'' = ''PRODUCT''),',
  '  perform set_config(''app.actor'', ''seed'', true);
  if v_rehearsal then
    insert into app.seed_payloads (slug, payload) values (v_e ->> ''slug'', p)
    on conflict (slug) do update set payload = excluded.payload, saved_at = now();
  end if;

  select count(*) filter (where x ->> ''track'' = ''PRODUCT''),');

-- Every time in a payload moved by p_delta (the event's start, phases, trading windows, deadlines).
create or replace function app.shift_payload(p jsonb, p_delta interval)
returns jsonb
language sql immutable
as $$
  select p
    || jsonb_build_object('event', (p -> 'event') || jsonb_build_object('starts_at', (p -> 'event' ->> 'starts_at')::timestamptz + p_delta))
    || jsonb_build_object('schedule', jsonb_build_object(
         'phases', coalesce((select jsonb_agg(x || jsonb_build_object('starts_at', (x ->> 'starts_at')::timestamptz + p_delta,
                                                                         'ends_at', (x ->> 'ends_at')::timestamptz + p_delta) order by o)
                               from jsonb_array_elements(p -> 'schedule' -> 'phases') with ordinality t(x, o)), '[]'),
         'rounds', coalesce((select jsonb_agg(x || jsonb_build_object('opens_at', (x ->> 'opens_at')::timestamptz + p_delta,
                                                                         'closes_at', (x ->> 'closes_at')::timestamptz + p_delta) order by o)
                               from jsonb_array_elements(p -> 'schedule' -> 'rounds') with ordinality t(x, o)), '[]'),
         'deadlines', coalesce((select jsonb_agg(x || jsonb_build_object('at', (x ->> 'at')::timestamptz + p_delta) order by o)
                                  from jsonb_array_elements(p -> 'schedule' -> 'deadlines') with ordinality t(x, o)), '[]')))
$$;
revoke all on function app.shift_payload(jsonb, interval) from public, anon, authenticated;

create or replace function public.reset_rehearsal(p_event uuid)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_event public.events;
  v_payload jsonb;
  v_new uuid;
begin
  perform app.require_organiser();
  select * into v_event from public.events where id = p_event for update;
  if v_event.id is null then
    return app.fail('NO_EVENT', 'No such event.');
  end if;
  if not v_event.is_rehearsal then
    return app.fail('LIVE', 'Only a rehearsal can be reset. This is the live event.');
  end if;
  select payload into v_payload from app.seed_payloads where slug = v_event.slug;
  if v_payload is null then
    return app.fail('NO_PAYLOAD', 'This rehearsal was created before resets existed. Create it again once with its SQL file.');
  end if;
  -- The plan starts again 5 minutes from now.
  v_payload := app.shift_payload(v_payload, (now() + interval '5 minutes') - (v_payload -> 'event' ->> 'starts_at')::timestamptz);
  perform public.purge_event(v_event.slug);
  v_new := public.seed_event(v_payload);
  update public.events set manual_starts = v_event.manual_starts, hold_steps = v_event.hold_steps,
                           auto_advance = not v_event.manual_starts
   where id = v_new;
  perform app.log_event(v_new, 'CONTROL', 'Demo reset: back to Setup');
  return app.ok(jsonb_build_object('event_id', v_new));
end
$$;
revoke all on function public.reset_rehearsal(uuid) from public, anon;
grant execute on function public.reset_rehearsal(uuid) to authenticated;
