// What the price board reads, as the display account (companies, rounds and round prices are public to the event):
// the companies, and the last cleared round with its clearing rows embedded (a round_prices row with a round is a
// CLEARING row). Until the 03:30 freeze, the live leaderboard (team codes and points so far; the database refuses
// once it is frozen).

import { supabaseServer } from "@/lib/supabase/server";
import type { BoardCompany, BoardMoveRow } from "@/lib/display/board";
import { fetchAll } from "@/lib/fetch-all";
import { marketIndex, type IndexPoint } from "@/lib/chart";

export interface BoardRound {
  number: number;
  cleared_at: string | null;
  round_prices: BoardMoveRow[];
}

export interface BoardData {
  companies: BoardCompany[];
  /** The most recently cleared round (null before any round has cleared). */
  round: BoardRound | null;
  /** Each company's market price after every step so far (its trend line), by company id. */
  trends: Record<string, number[]>;
  /** The equal-weight market index after every market-wide step. */
  index: IndexPoint[];
}

export async function loadBoard(eventId: string): Promise<BoardData> {
  const sb = await supabaseServer();
  const [companies, round, steps] = await Promise.all([
    sb.from("companies").select("id, ticker, name, start_price, market_price, closing_price").eq("event_id", eventId).not("ticker", "is", null),
    sb
      .from("rounds")
      .select("number, cleared_at, round_prices(company_id, market_before, market_after)")
      .eq("event_id", eventId)
      .eq("status", "CLEARED")
      .eq("round_prices.kind", "CLEARING")
      .order("number", { ascending: false })
      .limit(1)
      .maybeSingle<BoardRound>(),
    fetchAll<{ company_id: string; kind: string; market_after: number }>((from, to) =>
      sb.from("round_prices").select("company_id, kind, market_after").eq("event_id", eventId).order("id").range(from, to),
    ),
  ]);
  for (const r of [companies, round]) if (r.error) throw new Error(`Could not read the board: ${r.error.message}`);
  const trends: Record<string, number[]> = {};
  for (const s of steps) {
    const list = (trends[s.company_id] ??= []);
    // An appeal corrects the latest price rather than adding a step, as in the market index.
    if (s.kind === "APPEAL" && list.length) list[list.length - 1] = Number(s.market_after);
    else list.push(Number(s.market_after));
  }
  return { companies: (companies.data ?? []) as BoardCompany[], round: round.data ?? null, trends, index: marketIndex(steps) };
}

export interface LiveRow {
  team_id: string;
  code: string;
  r1: number;
  r2: number;
  r3: number;
  total: number;
  rank: number | null;
}

/** The live leaderboard, or null when it is frozen (03:30 until the awards) or final. */
export async function loadLiveLeaderboard(eventId: string): Promise<LiveRow[] | null> {
  const sb = await supabaseServer();
  const { data, error } = await sb.rpc("leaderboard", { p_event: eventId });
  if (error) {
    if (error.code === "42501") return null; // frozen
    throw new Error(`Could not read the leaderboard: ${error.message}`);
  }
  const b = data as { final?: boolean; frozen?: boolean; rows?: LiveRow[] };
  return b.final || b.frozen ? null : (b.rows ?? []);
}
