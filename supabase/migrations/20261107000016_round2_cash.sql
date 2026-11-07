-- Round 3 money depends on the Round 2 evaluation.
--
-- Every team is seeded with $50,000 (RULES.START_CASH) so it can trade in the two blind rounds (02:15–02:45). At the
-- 02:45 reveal, when Round 2 scores become public, each team receives $1,000 (RULES.R2_GRANT_PER_POINT) per point of
-- its own crisis-solution score: 50 → $100,000 in all, 100 → $150,000, 0 (no solution) → $50,000. The grant is a
-- START_CASH ledger entry paid by the exchange, so the books still balance. A team's return, and so its Round 3
-- points, is measured on everything it received (app.funded_cents), not on a fixed $100,000.

-- Everything a team has been given to trade with: the sum of its START_CASH entries.
create or replace function app.funded_cents(p_team uuid)
returns bigint
language sql stable
as $$
  select coalesce(sum(cash_delta_cents), 0)::bigint from public.ledger_entries where team_id = p_team and kind = 'START_CASH'
$$;

-- Pays the Round 2 grant to every team of the event, once (a team that already has its grant is skipped).
create or replace function app.grant_round2_cash(p_event uuid)
returns integer
language plpgsql
as $$
declare
  r record;
  v_txn uuid;
  n int := 0;
begin
  for r in select t.id, coalesce(s.final_score, 0) as score
             from public.teams t
             left join public.scores s on s.team_id = t.id and s.type = 'SOLUTION'
            where t.event_id = p_event
              and not exists (select 1 from public.ledger_entries l
                               where l.team_id = t.id and l.kind = 'START_CASH' and l.memo = 'Round 2 grant')
            order by t.code
            for no key update of t loop
    if r.score > 0 then
      v_txn := gen_random_uuid();
      insert into public.ledger_entries (event_id, txn_id, kind, team_id, cash_delta_cents, memo)
      values (p_event, v_txn, 'START_CASH', r.id, 100000::bigint * r.score, 'Round 2 grant'),
             (p_event, v_txn, 'START_CASH', null, -100000::bigint * r.score, 'Round 2 grant');
      update public.teams set cash_cents = cash_cents + 100000::bigint * r.score where id = r.id;
      update public.events set exchange_cash_cents = exchange_cash_cents - 100000::bigint * r.score where id = p_event;
      n := n + 1;
    end if;
  end loop;
  return n;
end
$$;

create or replace function app.reveal_solutions(p_event uuid)
returns void
language plpgsql
as $$
begin
  perform 1 from public.events where id = p_event and scores_revealed_at is null for no key update;
  if not found then
    return;
  end if;
  if not app.all_sealed(p_event, 'SOLUTION') then
    raise exception 'every crisis-solution score must be sealed before the reveal';
  end if;
  if exists (select 1 from public.rounds where event_id = p_event and number <= 2 and status <> 'CLEARED') then
    raise exception 'rounds 1 and 2 clear before the score reveal';
  end if;
  perform set_config('app.price_writer', 'REVEAL', true);
  insert into public.round_prices (event_id, company_id, kind, market_before, market_after, score_before, score_after, factor_bp)
  select p_event, c.id, 'REVEAL', c.market_price, app.apply_reveal(c.market_price, s.final_score),
         c.score_price, app.apply_reveal(c.score_price, s.final_score), app.reveal_factor_bp(s.final_score)
    from public.companies c join public.scores s on s.company_id = c.id and s.type = 'SOLUTION'
   where c.event_id = p_event;
  update public.companies c set market_price = rp.market_after, score_price = rp.score_after
    from public.round_prices rp
   where c.event_id = p_event and rp.event_id = p_event and rp.company_id = c.id and rp.kind = 'REVEAL';
  perform set_config('app.price_writer', '', true);
  perform set_config('app.score_writer', 'REVEAL', true);
  update public.scores set status = 'REVEALED', revealed_at = now() where event_id = p_event and type = 'SOLUTION';
  perform set_config('app.score_writer', '', true);
  update public.events set scores_revealed_at = now() where id = p_event;
  -- Round 3 money depends on Round 2: every team now receives $1,000 per point of its own crisis-solution score.
  perform app.grant_round2_cash(p_event);
  perform app.broadcast(p_event, 'scores_revealed', jsonb_build_object(
    'movers', (select jsonb_agg(x) from (
                 select jsonb_build_object('company_id', rp.company_id, 'ticker', c.ticker, 'factor_bp', rp.factor_bp,
                                           'before', rp.market_before, 'after', rp.market_after) as x
                   from public.round_prices rp join public.companies c on c.id = rp.company_id
                  where rp.event_id = p_event and rp.kind = 'REVEAL'
                  order by abs(rp.factor_bp - 10000) desc, c.ticker limit 10) t)));
end
$$;

create or replace function app.live_leaderboard(p_event uuid)
returns table (team_id uuid, code text, r1 int, r2 int, r3 int, total int, portfolio bigint, rank int)
language sql stable
as $$
  with e as (select * from public.events where id = p_event),
  t as (
    select t.id, t.code, t.disqualified,
           coalesce((select s.final_score from public.scores s join public.companies c on c.id = s.company_id
                      where c.founder_team_id = t.id and s.type = 'PRD' and s.status = 'REVEALED'), 0)::int as r1,
           coalesce((select s.final_score from public.scores s
                      where s.team_id = t.id and s.type = 'SOLUTION' and s.status = 'REVEALED'), 0)::int as r2,
           t.cash_cents + coalesce((select sum(h.qty::bigint * c.market_price) from public.holdings h
                                     join public.companies c on c.id = h.company_id
                                    where h.team_id = t.id and h.qty > 0), 0) as portfolio
      from public.teams t where t.event_id = p_event
  ),
  s as (
    select t.*, case when (select current_phase from e) >= 'MARKET_BLIND'
                     then app.round3_points(t.portfolio, app.funded_cents(t.id)) else 0 end as r3
      from t
  )
  select s.id, s.code, s.r1, s.r2, s.r3, s.r1 + s.r2 + s.r3, s.portfolio,
         case when s.disqualified then null
              else (rank() over (partition by s.disqualified
                                 order by s.r1 + s.r2 + s.r3 desc, s.r2 desc, s.r1 desc, s.portfolio desc))::int end
    from s
$$;

create or replace function app.compute_results(p_event uuid)
returns void
language sql
as $$
  insert into public.results (event_id, team_id, r1_points, r2_points, r3_points, portfolio_cents, return_bp, total, eligible, details, computed_at)
  select p_event, x.id, x.r1, x.r2, app.round3_points(x.portfolio, app.funded_cents(x.id)), x.portfolio, app.return_bp(x.portfolio, app.funded_cents(x.id)),
         x.r1 + x.r2 + app.round3_points(x.portfolio, app.funded_cents(x.id)), not x.disqualified,
         jsonb_build_object('cash', x.cash_cents, 'funded', app.funded_cents(x.id)), now()
    from (select t.id, t.disqualified, t.cash_cents,
                 coalesce((select s.final_score from public.scores s join public.companies c on c.id = s.company_id
                            where c.founder_team_id = t.id and s.type = 'PRD'), 0)::int as r1,
                 coalesce((select s.final_score from public.scores s where s.team_id = t.id and s.type = 'SOLUTION'), 0)::int as r2,
                 t.cash_cents + coalesce((select sum(h.qty::bigint * c.closing_price) from public.holdings h
                                           join public.companies c on c.id = h.company_id
                                          where h.team_id = t.id and h.qty > 0), 0) as portfolio
            from public.teams t where t.event_id = p_event) x
  on conflict (team_id) do update
    set r1_points = excluded.r1_points, r2_points = excluded.r2_points, r3_points = excluded.r3_points,
        portfolio_cents = excluded.portfolio_cents, return_bp = excluded.return_bp, total = excluded.total,
        eligible = excluded.eligible, details = excluded.details, computed_at = now()
$$;

-- Internal, like every other app.* function that is not an RLS helper.
revoke all on function app.funded_cents(uuid) from public, anon, authenticated, service_role;
revoke all on function app.grant_round2_cash(uuid) from public, anon, authenticated, service_role;
