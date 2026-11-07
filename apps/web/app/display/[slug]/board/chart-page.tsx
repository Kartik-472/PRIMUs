// The chart page of the price board: the PRIMUS index as detailed candles (ten to each cleared round) with a moving
// average, large enough to read from the back of the
// hall, and the companies that moved most since their starting price with small candles of their steps. It takes its turn in the
// board's rotation; the page re-reads itself at every clearing, so the chart gains a point as soon as a round clears.

import { INDEX_BASE, indexText, tradingWindow, type Candle, type IndexPoint } from "@/lib/chart";
import { bp, money } from "@/lib/format";
import type { BoardTile } from "@/lib/display/board";
import { CandleChart, MiniCandles } from "@/components/ui/candle-chart";

const MOVERS = 4;
const BOX = { width: 1180, height: 660, padLeft: 150, padRight: 150, padTop: 56, padBottom: 12 };

export function ChartPage({ index, detail, tiles, trends }: { index: IndexPoint[]; detail: Candle[]; tiles: BoardTile[]; trends: Record<string, number[]> }) {
  const last = index.at(-1);
  const change = last ? Math.round((last.level - INDEX_BASE * 100) / 10) : 0;
  const moved = tiles.filter((t): t is BoardTile & { changeBp: number } => t.changeBp !== null && t.changeBp !== 0);
  const up = moved.filter((t) => t.changeBp > 0).sort((a, b) => b.changeBp - a.changeBp || a.ticker.localeCompare(b.ticker)).slice(0, MOVERS);
  const down = moved.filter((t) => t.changeBp < 0).sort((a, b) => a.changeBp - b.changeBp || a.ticker.localeCompare(b.ticker)).slice(0, MOVERS);
  return (
    <section className="flex h-full gap-10" aria-label="Market chart" data-testid="display-chart">
      <div className="flex min-w-0 flex-1 flex-col">
        <h2 className="flex shrink-0 items-baseline gap-6 text-[40px] leading-tight font-black text-[var(--term-amber)] uppercase">
          PRIMUS index
          <span className="font-mono text-[52px] text-white tabular-nums" data-testid="display-index-level">
            {last ? indexText(last.level) : "—"}
          </span>
          {index.length > 1 ? (
            <span className={`font-mono text-[40px] tabular-nums ${change > 0 ? "text-[var(--term-green)]" : change < 0 ? "text-[var(--term-red)]" : "text-slate-400"}`}>
              {change > 0 ? "▲" : change < 0 ? "▼" : "▬"} {bp(change)}
            </span>
          ) : null}
          <span className="ml-auto flex items-center gap-3 text-[26px] font-bold text-[var(--term-green)]">
            <span className="relative flex h-4 w-4" aria-hidden>
              <span className="msim-live-ping absolute inline-flex h-full w-full rounded-full bg-[var(--term-green)]" />
              <span className="relative inline-flex h-4 w-4 rounded-full bg-[var(--term-green)]" />
            </span>
            LIVE
          </span>
        </h2>
        <div className="min-h-0 flex-1">
          {detail.length > 1 ? (
            <CandleChart
              candles={tradingWindow(detail)}
              average={10}
              label="PRIMUS index by step"
              format={(v) => indexText(v)}
              box={BOX}
              fontSize={26}
              live
              caption={false}
              testId="display-index-chart"
            />
          ) : (
            <p className="mt-10 text-[40px] text-slate-300">The index starts at 1,000 with the starting prices and moves with every step after.</p>
          )}
        </div>
      </div>
      <div className="flex w-[600px] shrink-0 flex-col gap-6">
        <Movers title="Up most since start" rows={up} trends={trends} />
        <Movers title="Down most since start" rows={down} trends={trends} />
      </div>
    </section>
  );
}

function Movers({ title, rows, trends }: { title: string; rows: (BoardTile & { changeBp: number })[]; trends: Record<string, number[]> }) {
  return (
    <div>
      <h3 className="border-b-2 border-[var(--term-amber-dim)] pb-1 text-[28px] font-bold tracking-wide text-[var(--term-amber)] uppercase">{title}</h3>
      {rows.length === 0 ? (
        <p className="mt-2 text-[28px] text-slate-400">None yet.</p>
      ) : (
        <ul>
          {rows.map((t) => (
            <li key={t.id} className="flex items-center gap-4 border-b border-white/10 py-2" data-testid={`display-mover-${t.ticker}`}>
              <span className="w-[120px] shrink-0 text-[38px] font-black text-[var(--term-amber)]">{t.ticker}</span>
              <MiniCandles values={trends[t.id] ?? []} label={`${t.ticker} price by step`} width={150} height={40} />
              <span className="ml-auto text-[30px] font-bold tabular-nums">{money(t.price)}</span>
              <span className={`w-[150px] text-right text-[30px] font-bold tabular-nums ${t.changeBp > 0 ? "text-[var(--term-green)]" : "text-[var(--term-red)]"}`}>
                {bp(t.changeBp)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
