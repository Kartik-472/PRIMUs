-- The detailed price chart: how each cleared round's demand built up while it was open. Every round is cut into ten
-- equal slices of its trading time; for each company and slice, the filled orders' running net demand (shares bought
-- − sold, in the order the orders were placed) at its highest, lowest and at the slice's end, and the shares traded.
-- The screens turn the running net into the price it would have cleared at (the clearing rule on the price before
-- the round), so a round draws as ten candles with real highs and lows, ending exactly at its clearing price.
--
-- Only cleared rounds: an open round's orders stay private until it clears. No team appears: these are the totals
-- already public as round_prices.buy_qty and sell_qty, spread over the round's time. An edited order counts at the
-- time it was first placed, with its final quantity; a cancelled order does not count.

create or replace function public.round_flow(p_event uuid)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not app.in_my_event(p_event) then
    raise exception 'no such event' using errcode = '42501';
  end if;
  return app.ok(jsonb_build_object('rows', coalesce((
    select jsonb_agg(jsonb_build_array(s.round_number, s.company_id, s.slice, s.high_net, s.low_net, s.close_net, s.volume)
                     order by s.round_number, s.company_id, s.slice)
      from (
        select f.round_number, f.company_id, f.slice,
               max(f.cum) as high_net, min(f.cum) as low_net,
               (array_agg(f.cum order by f.created_at desc, f.id desc))[1] as close_net,
               sum(f.qty) as volume
          from (
            select r.number as round_number, o.company_id, o.id, o.created_at, o.qty,
                   least(9, greatest(0, floor(10 * extract(epoch from (o.created_at - r.opens_at))
                                                  / extract(epoch from (r.closes_at - r.opens_at)))))::int as slice,
                   sum(case when o.type = 'BUY' then o.qty else -o.qty end)
                     over (partition by o.round_id, o.company_id order by o.created_at, o.id) as cum
              from public.orders o
              join public.rounds r on r.id = o.round_id
             where o.event_id = p_event and o.status = 'FILLED' and r.status = 'CLEARED'
          ) f
         group by f.round_number, f.company_id, f.slice
      ) s), '[]'::jsonb)));
end
$$;

revoke all on function public.round_flow(uuid) from public, anon;
grant execute on function public.round_flow(uuid) to authenticated, service_role;
