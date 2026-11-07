// The market monitor at the top of the Market page: the equal-weight market index as candles, one per step, drawn live (the
// page re-reads itself at every clearing, so the chart gains a point the moment a round clears), and the companies
// that moved most since their starting price, each with small candles of its steps.

import Link from "next/link";
import type { EventStatus } from "@/lib/event-status";
import { INDEX_BASE, indexCandles, indexText, type IndexPoint } from "@/lib/chart";
import type { MarketLine } from "@/lib/team/market";
import { bp, money } from "@/lib/format";
import { changeSinceStartBp } from "@/lib/display/board";
import { CandleChart, MiniCandles } from "@/components/ui/candle-chart";
import { Countdown } from "@/components/ui/countdown";
import { Panel } from "@/components/ui/ui";

const MOVERS = 3;

export function MarketMonitor({ index, lines, status }: { index: IndexPoint[]; lines: MarketLine[]; status: EventStatus }) {
  const last = index.at(-1);
  const change = last ? last.level - INDEX_BASE * 100 : 0;
  const moved = lines
    .map((l) => ({ ...l, sinceStart: changeSinceStartBp(l.start, l.closing ?? l.price) }))
    .filter((l): l is typeof l & { sinceStart: number } => l.sinceStart !== null);
  const up = moved.filter((l) => l.sinceStart > 0).sort((a, b) => b.sinceStart - a.sinceStart).slice(0, MOVERS);
  const down = moved.filter((l) => l.sinceStart < 0).sort((a, b) => a.sinceStart - b.sinceStart).slice(0, MOVERS);
  return (
    <Panel
      title="Market monitor"
      actions={
        <span className="flex items-center gap-2 text-xs text-slate-600" data-testid="monitor-live">
          <span className="relative flex h-2 w-2" aria-hidden>
            <span className="msim-live-ping absolute inline-flex h-full w-full rounded-full bg-emerald-500" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
          </span>
          LIVE
          {status.open_round ? (
            <span>
              · round {status.open_round.number} clears in <Countdown to={status.open_round.closes_at} passed="now" className="font-semibold text-slate-900" />
            </span>
          ) : null}
        </span>
      }
    >
      <div className="grid gap-4 lg:grid-cols-5">
        <div className="min-w-0 lg:col-span-3">
          <p className="flex flex-wrap items-baseline gap-x-3 text-sm">
            <span className="text-xs font-semibold tracking-wide text-slate-500 uppercase">PRIMUS index</span>
            <span className="font-mono text-xl font-bold text-slate-900 tabular-nums" data-testid="index-level">
              {last ? indexText(last.level) : "—"}
            </span>
            {last && index.length > 1 ? (
              <span className={`font-mono tabular-nums ${change > 0 ? "text-emerald-700" : change < 0 ? "text-red-700" : "text-slate-500"}`}>
                {change > 0 ? "▲" : change < 0 ? "▼" : "▬"} {bp(Math.round(change / 10))}
              </span>
            ) : null}
          </p>
          {index.length > 1 ? (
            <CandleChart
              candles={indexCandles(index)}
              label="PRIMUS index by step"
              format={(v) => indexText(v)}
              live
              testId="index-chart"
            />
          ) : (
            <p className="mt-3 text-sm text-slate-500">The index starts at 1,000 with the starting prices and moves with every step after.</p>
          )}
        </div>
        <div className="min-w-0 space-y-3 lg:col-span-2">
          <MoverList title="Up most since start" rows={up} />
          <MoverList title="Down most since start" rows={down} />
        </div>
      </div>
    </Panel>
  );
}

function MoverList({ title, rows }: { title: string; rows: (MarketLine & { sinceStart: number })[] }) {
  return (
    <div>
      <h3 className="text-xs font-semibold tracking-wide text-slate-500 uppercase">{title}</h3>
      {rows.length === 0 ? (
        <p className="mt-1 text-sm text-slate-500">None yet.</p>
      ) : (
        <ul className="mt-1 divide-y divide-slate-100">
          {rows.map((l) => (
            <li key={l.id} className="flex items-center gap-3 py-1.5 text-sm">
              <Link href={`/team/market/${l.ticker}`} className="w-14 shrink-0 font-mono font-bold text-slate-900 underline-offset-2 hover:underline">
                {l.ticker}
              </Link>
              <MiniCandles values={l.trend} label={`${l.ticker} price by step`} width={96} height={24} />
              <span className="ml-auto font-mono tabular-nums">{money(l.closing ?? l.price)}</span>
              <span className={`w-20 text-right font-mono tabular-nums ${l.sinceStart > 0 ? "text-emerald-700" : "text-red-700"}`}>{bp(l.sinceStart)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
