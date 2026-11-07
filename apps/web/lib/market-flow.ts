// What the detailed charts read: every price step of the event (round_prices by id) and the cleared rounds' order
// flow (public.round_flow). A cleared round's flow never changes, so it is kept in memory per server instance and read
// again only when another round has cleared: at a clearing every screen re-reads its page at once, and this way the
// database answers the flow once per instance, not once per screen.

import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAll } from "@/lib/fetch-all";
import { flowSlices, type FlowSlice, type FlowStep } from "@/lib/chart";

export interface MarketSteps {
  /** Every company's price steps in the order of the night. */
  steps: (FlowStep & { buy_qty: number; sell_qty: number })[];
  /** The cleared rounds' order flow, by company and slice. */
  flow: FlowSlice[];
}

const FLOW_CACHE = new Map<string, Promise<FlowSlice[]>>();
const CACHE_LIMIT = 20;

export async function loadMarketSteps(sb: SupabaseClient, eventId: string): Promise<MarketSteps> {
  const [steps, flow] = await Promise.all([
    fetchAll<FlowStep & { buy_qty: number; sell_qty: number }>((from, to) =>
      sb.from("round_prices").select("company_id, kind, market_before, market_after, buy_qty, sell_qty").eq("event_id", eventId).order("id").range(from, to),
    ),
    loadFlow(sb, eventId),
  ]);
  return { steps, flow };
}

/** The cleared rounds' order flow (every company), read once per instance per cleared round. */
export async function loadFlow(sb: SupabaseClient, eventId: string): Promise<FlowSlice[]> {
  const cleared = await sb
    .from("rounds")
    .select("number")
    .eq("event_id", eventId)
    .eq("status", "CLEARED")
    .order("number", { ascending: false })
    .limit(1)
    .maybeSingle<{ number: number }>();
  if (cleared.error) throw new Error(`Could not read the rounds: ${cleared.error.message}`);
  const last = cleared.data?.number ?? 0;
  if (last === 0) return [];
  const key = `${eventId}:${last}`;
  let flow = FLOW_CACHE.get(key);
  if (!flow) {
    flow = readFlow(sb, eventId);
    FLOW_CACHE.set(key, flow);
    // A failed read is not kept: the next page asks again.
    flow.catch(() => FLOW_CACHE.delete(key));
    while (FLOW_CACHE.size > CACHE_LIMIT) FLOW_CACHE.delete(FLOW_CACHE.keys().next().value!);
  }
  return flow;
}

async function readFlow(sb: SupabaseClient, eventId: string): Promise<FlowSlice[]> {
  const { data, error } = await sb.rpc("round_flow", { p_event: eventId });
  if (error) throw new Error(`Could not read the order flow: ${error.message}`);
  const b = data as { rows?: [number, string, number, number, number, number, number][] };
  return flowSlices(b.rows ?? []);
}
