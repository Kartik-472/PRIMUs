-- Round 2: the organisers' rescue pairs, the rescue chats and help tickets.
--
-- Rescue pairs: by default the lottery shuffles the teams into a circle and each team rescues the next team's company.
-- An organiser can now say which team rescues which company (control panel → Rescue pairs), one pair at a time or all
-- at once from a spreadsheet, until the crisis is dealt. Teams the organiser did not pair are still paired by the
-- lottery, so every company always has exactly one rescuer and nobody rescues its own. The pairs the organiser fixed
-- are published in the lottery record, and anyone can still repeat the draw.
--
-- Rescue chats: each company has one private chat between the team that founded it and the team that rescues it. So
-- every team has two chats: one to ask the founders of the company it rescues, and one to help the team that rescues
-- its own company. They are open from the crisis until the solutions lock. Organisers and the fairness officer can read
-- every chat.
--
-- Tickets: a team can raise a ticket at any time, about one of its two chats or about anything else. Staff see it in
-- the control panel, open the chat it is about, reply and resolve it.

-- ───────────────────────────── Rescue pairs ─────────────────────────────

create table public.rescue_plan (
  event_id uuid not null references public.events (id) on delete cascade,
  rescuer_team_id uuid not null references public.teams (id) on delete cascade,
  founder_team_id uuid not null references public.teams (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (event_id, rescuer_team_id),
  unique (event_id, founder_team_id),
  check (rescuer_team_id <> founder_team_id)
);

alter table public.rescue_plan enable row level security;
grant select on public.rescue_plan to authenticated;
create policy rescue_plan_read on public.rescue_plan for select to authenticated using ((select app.is_staff()));

-- The pairs the organisers fixed, as they were used at the crisis ([{rescuer, founder}] by team code). Part of the
-- published lottery record.
alter table public.events add column rescue_fixed jsonb not null default '[]'::jsonb;

/**
 * Who rescues whom: the organisers' pairs as given, and every other team paired by the lottery. The teams are shuffled
 * into the rescue circle (as app.lottery_circle does). The teams still without a company to rescue, and the companies
 * still without a rescuer, are each taken in circle order, and each such team rescues the company one step on; if that
 * would give a team its own company, two steps on, and so on. With no fixed pairs this is exactly the rescue circle.
 * Mirrors rescuePlan() in packages/engine/src/lottery.ts.
 * @param p_fixed [{rescuer, founder}] by team code
 */
create or replace function app.lottery_plan(p_root text, p_teams text[], p_fixed jsonb)
returns table (rescuer text, founder text)
language plpgsql immutable parallel safe
as $$
declare
  v_fixed jsonb := coalesce(p_fixed, '[]'::jsonb);
  v_circle text[];
  r text[];
  f text[];
  m int;
  k int;
  s int;
  i int;
  v_ok boolean;
begin
  v_circle := array(select d.a from app.lottery_circle(p_root, p_teams) with ordinality d(a, b, ord) order by d.ord);
  if exists (select 1 from jsonb_array_elements(v_fixed) x
              where not (x->>'rescuer' = any (p_teams)) or not (x->>'founder' = any (p_teams))) then
    raise exception 'a fixed pair names a team that is not playing';
  end if;
  if exists (select 1 from jsonb_array_elements(v_fixed) x where x->>'rescuer' = x->>'founder') then
    raise exception 'a team cannot rescue its own company';
  end if;
  if (select count(distinct x->>'rescuer') from jsonb_array_elements(v_fixed) x) <> jsonb_array_length(v_fixed)
     or (select count(distinct x->>'founder') from jsonb_array_elements(v_fixed) x) <> jsonb_array_length(v_fixed) then
    raise exception 'a team is in two fixed pairs';
  end if;

  return query select x->>'rescuer', x->>'founder' from jsonb_array_elements(v_fixed) x;

  r := array(select u.c from unnest(v_circle) with ordinality u(c, ord)
              where not exists (select 1 from jsonb_array_elements(v_fixed) x where x->>'rescuer' = u.c) order by u.ord);
  f := array(select u.c from unnest(v_circle) with ordinality u(c, ord)
              where not exists (select 1 from jsonb_array_elements(v_fixed) x where x->>'founder' = u.c) order by u.ord);
  m := coalesce(array_length(r, 1), 0);
  if m = 0 then
    return;
  end if;
  for s in 1..m loop
    k := s % m; -- 1, 2, …, m − 1, 0
    v_ok := true;
    for i in 1..m loop
      if r[i] = f[((i - 1 + k) % m) + 1] then
        v_ok := false;
        exit;
      end if;
    end loop;
    if v_ok then
      for i in 1..m loop
        rescuer := r[i];
        founder := f[((i - 1 + k) % m) + 1];
        return next;
      end loop;
      return;
    end if;
  end loop;
  raise exception 'the fixed pairs leave one team with only its own company to rescue';
end
$$;

/** The organisers' pairs between teams that play tonight, by team code. */
create or replace function app.rescue_fixed_json(p_event uuid)
returns jsonb
language sql stable
as $$
  select coalesce(jsonb_agg(jsonb_build_object('rescuer', r.code, 'founder', f.code) order by r.code), '[]'::jsonb)
    from public.rescue_plan p
    join public.teams r on r.id = p.rescuer_team_id and r.status = 'ACTIVE'
    join public.teams f on f.id = p.founder_team_id and f.status = 'ACTIVE'
   where p.event_id = p_event
$$;

-- The crisis, now with the organisers' pairs. Everything else is as before.
create or replace function app.apply_crisis(p_event uuid)
returns void
language plpgsql
as $$
declare
  v_event public.events;
  v_seed text;
  v_root text;
  v_teams text[];
  v_fixed jsonb;
begin
  select * into v_event from public.events where id = p_event for no key update;
  if v_event.crisis_applied_at is not null then
    return;
  end if;
  if v_event.prices_started_at is null then
    raise exception 'the crisis comes after the starting prices';
  end if;
  select seed into v_seed from public.event_secrets where event_id = p_event;
  if v_seed is null or v_event.dice is null then
    raise exception 'the crisis draw needs the lottery seed and dice';
  end if;
  v_root := app.sha256_hex(v_seed || v_event.dice);
  v_teams := array(select code from public.teams where event_id = p_event and status = 'ACTIVE');

  update public.companies c set crisis_card_id = cc.id
    from app.lottery_crises(v_root, v_teams,
           (select jsonb_agg(jsonb_build_object('id', number::text, 'number', number)) from public.crisis_cards where event_id = p_event)) d
    join public.teams t on t.event_id = p_event and t.code = d.team
    join public.crisis_cards cc on cc.event_id = p_event and cc.number = d.card::int
   where c.founder_team_id = t.id;

  -- The night never stops on the pairs: if they cannot be used as they stand, the lottery pairs every team.
  v_fixed := app.rescue_fixed_json(p_event);
  begin
    update public.companies c set rescuer_team_id = r.id
      from app.lottery_plan(v_root, v_teams, v_fixed) d
      join public.teams r on r.event_id = p_event and r.code = d.rescuer
      join public.teams f on f.event_id = p_event and f.code = d.founder
     where c.founder_team_id = f.id;
  exception when others then
    insert into public.audit_log (event_id, actor_role, action, entity, entity_id, after)
    values (p_event, 'system', 'rescue_pairs_dropped', 'events', p_event::text, jsonb_build_object('reason', sqlerrm, 'pairs', v_fixed));
    v_fixed := '[]'::jsonb;
    update public.companies c set rescuer_team_id = r.id
      from app.lottery_circle(v_root, v_teams) d
      join public.teams r on r.event_id = p_event and r.code = d.rescuer
      join public.teams f on f.event_id = p_event and f.code = d.founder
     where c.founder_team_id = f.id;
  end;

  perform set_config('app.price_writer', 'CRISIS', true);
  insert into public.round_prices (event_id, company_id, kind, market_before, market_after, score_before, score_after)
  select p_event, c.id, 'CRISIS', c.market_price, app.crisis_shock(c.market_price), c.score_price, app.crisis_shock(c.score_price)
    from public.companies c where c.event_id = p_event;
  update public.companies c set market_price = rp.market_after, score_price = rp.score_after, post_crisis_price = rp.market_after
    from public.round_prices rp
   where c.event_id = p_event and rp.event_id = p_event and rp.company_id = c.id and rp.kind = 'CRISIS';
  perform set_config('app.price_writer', '', true);

  update public.events set crisis_applied_at = now(), seed_revealed = v_seed, rescue_fixed = v_fixed where id = p_event;
  delete from public.event_secrets where event_id = p_event;
  insert into public.bulletins (event_id, kind, title, body, published_at)
  values (p_event, 'CRISIS', 'Crisis: every company is hit',
          'Each company has received its crisis card and every share price fell 15%. Each team now rescues another '
          || 'team''s company: see your rescue card. The Q&A board is open until 00:15, and your two rescue chats are open '
          || 'until the solutions lock.', now());
  perform app.broadcast(p_event, 'crisis', jsonb_build_object('seed', v_seed, 'dice', v_event.dice));
end
$$;

create or replace function app.lottery_record_json(p_event uuid)
returns jsonb
language sql stable
as $$
  select jsonb_build_object(
    'seed', e.seed_revealed,
    'dice', e.dice,
    'commitment', e.seed_commitment,
    'teams', (select jsonb_agg(code order by code) from public.teams where event_id = p_event and status = 'ACTIVE'),
    'problemCards', (select jsonb_agg(number::text order by number) from public.problem_cards where event_id = p_event),
    'crisisCards', (select jsonb_agg(number::text order by number) from public.crisis_cards where event_id = p_event),
    'rescuePairs', e.rescue_fixed,
    'draws', (select jsonb_agg(jsonb_build_object('team', t.code, 'problem', pc.number::text, 'crisis', cc.number::text,
                                                  'rescues', ft.code) order by t.code)
                from public.teams t
                join public.companies own on own.founder_team_id = t.id
                left join public.problem_cards pc on pc.id = own.problem_card_id
                left join public.crisis_cards cc on cc.id = own.crisis_card_id
                left join public.companies res on res.rescuer_team_id = t.id
                left join public.teams ft on ft.id = res.founder_team_id
               where t.event_id = p_event and t.status = 'ACTIVE'))
    from public.events e where e.id = p_event
$$;

/**
 * Organiser: sets rescue pairs. p_pairs is [{rescuer, founder}] by team code: `rescuer` rescues `founder`'s company.
 * With p_replace the list replaces every pair set so far (a spreadsheet upload); otherwise the pairs are added, and a
 * new pair replaces an older pair of the same rescuing team or the same company. Nothing is saved unless every row is
 * good; the refusal lists what is wrong, row by row.
 */
create or replace function public.set_rescue_pairs(p_event uuid, p_pairs jsonb, p_replace boolean default false)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_event public.events;
  v_actor record;
  v_problems text[] := '{}';
  v_rescuers uuid[] := '{}';
  v_founders uuid[] := '{}';
  v_row record;
  v_r public.teams;
  v_f public.teams;
  v_left_r uuid[];
  v_left_f uuid[];
  v_total int;
begin
  perform app.require_organiser();
  select * into v_event from public.events where id = p_event for no key update;
  if v_event.id is null then
    raise exception 'no such event';
  end if;
  if v_event.crisis_applied_at is not null then
    return app.fail('TOO_LATE', 'The crisis has been dealt: who rescues whom is fixed.');
  end if;
  if p_pairs is null or jsonb_typeof(p_pairs) <> 'array' then
    raise exception 'the pairs must be a list';
  end if;
  if jsonb_array_length(p_pairs) = 0 and not p_replace then
    return app.fail('NO_PAIRS', 'There are no pairs to save.');
  end if;
  if jsonb_array_length(p_pairs) > 1000 then
    return app.fail('BAD_PAIRS', 'That is more than 1,000 rows.');
  end if;

  for v_row in
    select x.ord::int as n, upper(btrim(coalesce(x.p->>'rescuer', ''))) as r, upper(btrim(coalesce(x.p->>'founder', ''))) as f
      from jsonb_array_elements(p_pairs) with ordinality x(p, ord) order by x.ord
  loop
    v_r := null;
    v_f := null;
    if v_row.r = '' or v_row.f = '' then
      v_problems := v_problems || format('Row %s: both teams are needed.', v_row.n);
      continue;
    end if;
    select * into v_r from public.teams where event_id = p_event and code = v_row.r;
    select * into v_f from public.teams where event_id = p_event and code = v_row.f;
    if v_r.id is null then
      v_problems := v_problems || format('Row %s: there is no team %s.', v_row.n, v_row.r);
    elsif v_event.drawn_at is not null and v_r.status <> 'ACTIVE' then
      v_problems := v_problems || format('Row %s: %s is not playing tonight.', v_row.n, v_row.r);
    end if;
    if v_f.id is null then
      v_problems := v_problems || format('Row %s: there is no team %s.', v_row.n, v_row.f);
    elsif v_event.drawn_at is not null and v_f.status <> 'ACTIVE' then
      v_problems := v_problems || format('Row %s: %s is not playing tonight.', v_row.n, v_row.f);
    end if;
    if v_r.id is null or v_f.id is null then
      continue;
    end if;
    if v_r.id = v_f.id then
      v_problems := v_problems || format('Row %s: %s cannot rescue its own company.', v_row.n, v_row.r);
      continue;
    end if;
    if v_r.id = any (v_rescuers) then
      v_problems := v_problems || format('Row %s: %s is given two companies to rescue.', v_row.n, v_row.r);
    end if;
    if v_f.id = any (v_founders) then
      v_problems := v_problems || format('Row %s: %s''s company is given to two teams.', v_row.n, v_row.f);
    end if;
    v_rescuers := v_rescuers || v_r.id;
    v_founders := v_founders || v_f.id;
  end loop;
  if array_length(v_problems, 1) > 0 then
    return app.fail('BAD_PAIRS',
      format('Nothing was saved: %s row%s to correct.', array_length(v_problems, 1), case when array_length(v_problems, 1) = 1 then '' else 's' end),
      jsonb_build_object('problems', to_jsonb(v_problems[1:50])));
  end if;

  if p_replace then
    delete from public.rescue_plan where event_id = p_event;
  else
    delete from public.rescue_plan
     where event_id = p_event and (rescuer_team_id = any (v_rescuers) or founder_team_id = any (v_founders));
  end if;
  insert into public.rescue_plan (event_id, rescuer_team_id, founder_team_id)
  select p_event, r, f from unnest(v_rescuers, v_founders) as u(r, f);

  -- Once the teams playing are final, the teams left to the lottery must still be pairable: a single team left with
  -- only its own company cannot be.
  if v_event.drawn_at is not null then
    v_left_r := array(select t.id from public.teams t where t.event_id = p_event and t.status = 'ACTIVE'
                        and not exists (select 1 from public.rescue_plan p where p.event_id = p_event and p.rescuer_team_id = t.id));
    v_left_f := array(select t.id from public.teams t where t.event_id = p_event and t.status = 'ACTIVE'
                        and not exists (select 1 from public.rescue_plan p where p.event_id = p_event and p.founder_team_id = t.id));
    if array_length(v_left_r, 1) = 1 and v_left_r = v_left_f then
      raise exception 'Nothing was saved: these pairs leave % with only its own company to rescue. Pair it too.',
        (select code from public.teams where id = v_left_r[1]);
    end if;
  end if;

  select count(*) into v_total from public.rescue_plan where event_id = p_event;
  select * into v_actor from app.audit_actor();
  insert into public.audit_log (event_id, actor_user_id, actor_role, actor_team_id, action, entity, entity_id, after)
  values (p_event, v_actor.user_id, v_actor.role, v_actor.team_id, 'rescue_pairs_set', 'events', p_event::text,
          jsonb_build_object('replace', p_replace, 'rows', jsonb_array_length(p_pairs), 'pairs', v_total));
  perform app.broadcast(p_event, 'settings', '{}'::jsonb, true);
  return app.ok(jsonb_build_object('saved', jsonb_array_length(p_pairs), 'pairs', v_total));
end
$$;

/** Organiser: removes one pair (by the rescuing team's code), or every pair when p_rescuer is null. */
create or replace function public.clear_rescue_pairs(p_event uuid, p_rescuer text default null)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_event public.events;
  v_actor record;
  n int;
begin
  perform app.require_organiser();
  select * into v_event from public.events where id = p_event for no key update;
  if v_event.id is null then
    raise exception 'no such event';
  end if;
  if v_event.crisis_applied_at is not null then
    return app.fail('TOO_LATE', 'The crisis has been dealt: who rescues whom is fixed.');
  end if;
  delete from public.rescue_plan p
   where p.event_id = p_event
     and (p_rescuer is null
          or p.rescuer_team_id = (select id from public.teams where event_id = p_event and code = upper(btrim(p_rescuer))));
  get diagnostics n = row_count;
  select * into v_actor from app.audit_actor();
  insert into public.audit_log (event_id, actor_user_id, actor_role, actor_team_id, action, entity, entity_id, after)
  values (p_event, v_actor.user_id, v_actor.role, v_actor.team_id, 'rescue_pairs_cleared', 'events', p_event::text,
          jsonb_build_object('rescuer', p_rescuer, 'removed', n));
  perform app.broadcast(p_event, 'settings', '{}'::jsonb, true);
  return app.ok(jsonb_build_object('removed', n,
    'pairs', (select count(*) from public.rescue_plan where event_id = p_event)));
end
$$;

-- ───────────────────────────── Private channels for a chat and for a team ─────────────────────────────

-- A chat's messages and a team's ticket replies are signals for a few screens only, so they go on their own channels
-- (chat:<company id>, team:<team id>) and not on the event channel that every screen hears.
create or replace function app.send_topic(p_topic text, p_kind text, p_payload jsonb default '{}'::jsonb)
returns void
language plpgsql
as $$
begin
  perform realtime.send(coalesce(p_payload, '{}'::jsonb) || jsonb_build_object('kind', p_kind, 'at', now()), p_kind, p_topic, true);
end
$$;

create or replace function app.can_hear(p_topic text)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce(
    (p_topic like 'event:%' and exists (
       select 1 from public.events e
        where 'event:' || e.id::text = p_topic and (app.sees_all_events() or e.id = app.my_event_id())))
    or (p_topic like 'staff:%' and app.is_staff() and exists (
       select 1 from public.events e where 'staff:' || e.id::text = p_topic))
    or (p_topic like 'chat:%' and exists (
       select 1 from public.companies c
        where 'chat:' || c.id::text = p_topic
          and (app.is_staff() or c.founder_team_id = app.my_team_id() or c.rescuer_team_id = app.my_team_id())))
    or (p_topic like 'team:%' and exists (
       select 1 from public.teams t
        where 'team:' || t.id::text = p_topic and (app.is_staff() or t.id = app.my_team_id()))),
    false)
$$;

-- ───────────────────────────── Rescue chats ─────────────────────────────

create table public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  -- The chat: one per company, between its founders and the team that rescues it.
  company_id uuid not null references public.companies (id) on delete cascade,
  sender_team_id uuid not null references public.teams (id) on delete cascade,
  -- true: the rescuing team wrote it; false: the founders.
  from_rescuer boolean not null,
  body text not null check (length(body) between 1 and 500),
  created_at timestamptz not null default now()
);
create index chat_messages_company_idx on public.chat_messages (company_id, created_at);
create index chat_messages_event_idx on public.chat_messages (event_id, created_at);

alter table public.chat_messages enable row level security;
grant select on public.chat_messages to authenticated;
create policy chat_messages_read on public.chat_messages for select to authenticated
  using ((select app.is_staff())
      or company_id = (select app.my_company_id())
      or company_id = (select app.my_rescue_company_id()));

/**
 * A team writes in one of its two chats: p_company is the company it rescues (it asks the founders) or its own
 * company (it helps the team that rescues it). Open from the crisis until the solutions lock.
 */
create or replace function public.send_chat(p_company uuid, p_body text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_team public.teams;
  v_company public.companies;
  v_body text := btrim(coalesce(p_body, ''));
  v_id uuid;
begin
  if app.my_team_id() is null then
    raise exception 'only a team can write in a rescue chat' using errcode = '42501';
  end if;
  if app.too_fast(app.my_team_id()) then
    return app.fail('RATE_LIMITED', app.too_fast_message());
  end if;
  select * into v_team from public.teams where id = app.my_team_id();
  select * into v_company from public.companies where id = p_company and event_id = v_team.event_id;
  if v_company.id is null or v_company.rescuer_team_id is null
     or (v_company.founder_team_id <> v_team.id and v_company.rescuer_team_id <> v_team.id) then
    return app.reject(v_team.event_id, 'send_chat', 'NOT_ALLOWED', 'That is not one of your two rescue chats.');
  end if;
  if not app.writing_open(v_team.event_id, 'SOLUTION') then
    return app.reject(v_team.event_id, 'send_chat', 'CHAT_CLOSED', 'The rescue chats are open from the crisis until the solutions lock.');
  end if;
  if length(v_body) = 0 or length(v_body) > 500 then
    return app.reject(v_team.event_id, 'send_chat', 'BAD_LENGTH', 'Messages are 1 to 500 characters.');
  end if;
  if not app.rate_limit(v_team.id, 'chat', 20, interval '1 minute') then
    return app.fail('RATE_LIMITED', 'Too many messages in a minute. Wait a moment.');
  end if;
  insert into public.chat_messages (event_id, company_id, sender_team_id, from_rescuer, body)
  values (v_team.event_id, v_company.id, v_team.id, v_company.rescuer_team_id = v_team.id, v_body)
  returning id into v_id;
  perform app.send_topic('chat:' || v_company.id::text, 'chat', jsonb_build_object('company_id', v_company.id));
  return app.ok(jsonb_build_object('message_id', v_id));
end
$$;

-- ───────────────────────────── Tickets ─────────────────────────────

create table public.tickets (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  number int not null check (number > 0),
  team_id uuid not null references public.teams (id) on delete cascade,
  -- The chat the ticket is about (null: something else).
  company_id uuid references public.companies (id) on delete set null,
  body text not null check (length(body) between 1 and 600),
  status text not null default 'OPEN' check (status in ('OPEN', 'RESOLVED')),
  reply text check (reply is null or length(reply) between 1 and 600),
  replied_at timestamptz,
  replied_by uuid,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  unique (event_id, number)
);
create index tickets_team_idx on public.tickets (team_id, created_at);
create index tickets_open_idx on public.tickets (event_id, status, created_at);

alter table public.tickets enable row level security;
grant select on public.tickets to authenticated;
create policy tickets_read on public.tickets for select to authenticated
  using ((select app.is_staff()) or team_id = (select app.my_team_id()));

/** A team raises a ticket, about one of its two chats (p_company) or about anything else (null). */
create or replace function public.raise_ticket(p_company uuid, p_body text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_team public.teams;
  v_company public.companies;
  v_body text := btrim(coalesce(p_body, ''));
  v_number int;
  v_id uuid;
begin
  if app.my_team_id() is null then
    raise exception 'only a team can raise a ticket' using errcode = '42501';
  end if;
  if app.too_fast(app.my_team_id()) then
    return app.fail('RATE_LIMITED', app.too_fast_message());
  end if;
  select * into v_team from public.teams where id = app.my_team_id();
  if p_company is not null then
    select * into v_company from public.companies where id = p_company and event_id = v_team.event_id;
    if v_company.id is null or (v_company.founder_team_id <> v_team.id and v_company.rescuer_team_id is distinct from v_team.id) then
      return app.reject(v_team.event_id, 'raise_ticket', 'NOT_ALLOWED', 'That is not one of your two rescue chats.');
    end if;
  end if;
  if length(v_body) = 0 or length(v_body) > 600 then
    return app.reject(v_team.event_id, 'raise_ticket', 'BAD_LENGTH', 'A ticket is 1 to 600 characters.');
  end if;
  if (select count(*) from public.tickets where team_id = v_team.id and status = 'OPEN') >= 5 then
    return app.fail('TOO_MANY', 'You already have 5 open tickets. An organiser will answer them; please wait.');
  end if;
  if not app.rate_limit(v_team.id, 'ticket', 5, interval '5 minutes') then
    return app.fail('RATE_LIMITED', 'Too many tickets in a few minutes. Wait a moment.');
  end if;
  -- Ticket numbers run 1, 2, 3… per event.
  perform pg_advisory_xact_lock(hashtextextended('ticket:' || v_team.event_id::text, 0));
  select coalesce(max(number), 0) + 1 into v_number from public.tickets where event_id = v_team.event_id;
  insert into public.tickets (event_id, number, team_id, company_id, body)
  values (v_team.event_id, v_number, v_team.id, v_company.id, v_body)
  returning id into v_id;
  perform app.broadcast(v_team.event_id, 'ticket', jsonb_build_object('number', v_number), true);
  perform app.send_topic('team:' || v_team.id::text, 'ticket', jsonb_build_object('number', v_number));
  return app.ok(jsonb_build_object('ticket_id', v_id, 'number', v_number));
end
$$;

/** Staff: reply to a ticket and, with p_resolve, close it. A reply is needed unless the ticket is only being closed. */
create or replace function public.answer_ticket(p_ticket uuid, p_reply text, p_resolve boolean default true)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_ticket public.tickets;
  v_reply text := nullif(btrim(coalesce(p_reply, '')), '');
begin
  if not (app.is_staff() or app.is_system()) then
    raise exception 'only an organiser or the fairness officer can answer a ticket' using errcode = '42501';
  end if;
  select * into v_ticket from public.tickets where id = p_ticket for update;
  if v_ticket.id is null then
    return app.fail('NOT_FOUND', 'No such ticket.');
  end if;
  if v_reply is null and not coalesce(p_resolve, false) then
    return app.fail('BAD_LENGTH', 'Write a reply, or resolve the ticket.');
  end if;
  if length(v_reply) > 600 then
    return app.fail('BAD_LENGTH', 'A reply is up to 600 characters.');
  end if;
  update public.tickets
     set reply = coalesce(v_reply, reply),
         replied_at = case when v_reply is null then replied_at else now() end,
         replied_by = case when v_reply is null then replied_by else auth.uid() end,
         status = case when coalesce(p_resolve, false) then 'RESOLVED' else 'OPEN' end,
         resolved_at = case when coalesce(p_resolve, false) then now() else null end
   where id = v_ticket.id;
  perform app.broadcast(v_ticket.event_id, 'ticket', jsonb_build_object('number', v_ticket.number), true);
  perform app.send_topic('team:' || v_ticket.team_id::text, 'ticket', jsonb_build_object('number', v_ticket.number));
  return app.ok(jsonb_build_object('number', v_ticket.number, 'status', case when coalesce(p_resolve, false) then 'RESOLVED' else 'OPEN' end));
end
$$;

-- ───────────────────────────── Grants ─────────────────────────────

do $$
declare f text;
begin
  foreach f in array array['public.set_rescue_pairs(uuid, jsonb, boolean)', 'public.clear_rescue_pairs(uuid, text)',
                           'public.send_chat(uuid, text)', 'public.raise_ticket(uuid, text)',
                           'public.answer_ticket(uuid, text, boolean)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
end $$;
revoke all on function app.lottery_plan(text, text[], jsonb), app.rescue_fixed_json(uuid), app.send_topic(text, text, jsonb)
  from public, anon, authenticated;
