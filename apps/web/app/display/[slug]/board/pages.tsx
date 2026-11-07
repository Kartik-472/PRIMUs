"use client";

// The board's tiles, 25 to a page (5 × 5), a new page every 20 seconds by the server clock: every projector shows the
// same page, and a reload carries on where the screen was. The first render (on the server and while hydrating) uses
// the time the server rendered at, so both agree. Tiles that moved in a round that has just cleared light up briefly.

import { useSyncExternalStore, type ReactNode } from "react";
import { useServerNow } from "@/lib/live/clock";
import { bp, money } from "@/lib/format";
import { MiniCandles } from "@/components/ui/candle-chart";
import {
  MOVE_ARROWS,
  MOVE_TONE,
  pageCount,
  pageIndex,
  pageOf,
  priceRowFit,
  toneOf,
  type BoardTile,
  type Move,
  type PriceRowFit,
} from "@/lib/display/board";

const TEXT = { up: "text-[var(--term-green)]", down: "text-[var(--term-red)]", flat: "text-slate-500" } as const;
const CHANGE = { up: "text-[var(--term-green)]", down: "text-[var(--term-red)]", flat: "text-slate-300" } as const;
const GLOW = { UP: "bg-emerald-500/25 ring-4 ring-emerald-400", DOWN: "bg-red-500/25 ring-4 ring-red-500", FLAT: "" } as const;
const MOVE_WORDS: Record<Move, string> = { UP: "up", DOWN: "down", FLAT: "unchanged" };

const noSubscription = () => () => {};

export function BoardPages({
  tiles,
  round,
  closed,
  serverTime,
  highlightUntil,
  compact = false,
  trends = {},
  extras = [],
}: {
  tiles: BoardTile[];
  /** The last cleared round's number (null before any round has cleared). */
  round: number | null;
  /** The market has closed: the tiles show closing prices. */
  closed: boolean;
  serverTime: string;
  /** Server time (ms) until which the tiles that moved in the last round are highlighted. */
  highlightUntil: number | null;
  /** Less height for the tiles (a bulletin banner or the pause strip is shown): one step smaller type. */
  compact?: boolean;
  /** Each company's price after every step (its trend line in the tile), by company id. */
  trends?: Record<string, number[]>;
  /** Pages shown after the last page of tiles (the chart page, the leaderboard until 03:30), each with its legend. */
  extras?: { key: string; node: ReactNode; legend: string }[];
}) {
  const live = useServerNow(500);
  const hydrated = useSyncExternalStore(noSubscription, () => true, () => false);
  const now = hydrated ? live : Date.parse(serverTime);
  const tilePages = pageCount(tiles.length);
  const pages = tilePages + extras.length;
  const page = pageIndex(now, pages);
  const extra = page >= tilePages ? (extras[page - tilePages] ?? null) : null;
  const onExtra = extra !== null;
  const glow = highlightUntil !== null && now < highlightUntil;
  const pending = tiles.every((t) => t.price === null);

  return (
    <>
      {onExtra ? (
        <div className="min-h-0 flex-1 px-6 py-2" data-testid="board-page-extra" data-extra={extra.key} data-page={page + 1}>
          {extra.node}
        </div>
      ) : (
        <div className="grid min-h-0 flex-1 grid-cols-5 grid-rows-5 gap-x-3 gap-y-1 px-6 py-2" data-testid="board-page-tiles" data-page={page + 1}>
          {pageOf(tiles, page).map((t) => (
            <Tile key={t.id} tile={t} trend={trends[t.id] ?? []} round={round} glow={glow} size={compact ? SIZES.compact : SIZES.normal} />
          ))}
        </div>
      )}
      <footer className="flex h-[44px] shrink-0 items-center justify-between gap-8 border-t-2 border-[var(--term-amber-dim)] px-8 text-[26px] text-slate-400">
        <p className="min-w-0 truncate" data-testid="board-legend">
          {extra ? (
            extra.legend
          ) : pending ? (
            "Starting prices are set when the PRD scores are revealed at 23:30."
          ) : (
            <>
              {closed ? <span className="font-bold text-amber-300">Closing prices · </span> : null}
              % change since the starting price
              {round !== null ? (
                <>
                  {" · "}
                  <span className={TEXT.up}>▲</span> <span className={TEXT.down}>▼</span> <span className={TEXT.flat}>▬</span> round {round}&rsquo;s move
                </>
              ) : null}
            </>
          )}
        </p>
        {pages > 1 ? (
          <p className="shrink-0 font-mono font-bold text-[var(--term-amber)] tabular-nums" data-testid="board-page" aria-label={`Page ${page + 1} of ${pages}`}>
            {page + 1} / {pages}
          </p>
        ) : null}
      </footer>
    </>
  );
}

/** Type sizes of a tile: normal fills the board under the header; compact fits under a two-line bulletin and the pause strip. */
const SIZES = {
  normal: {
    pad: "py-2",
    ticker: "text-[52px]",
    arrow: "text-[44px]",
    name: "text-[28px] leading-[1.2]",
    spark: { width: 120, height: 30 },
    pending: "text-[30px]",
    // Sized for the monospace face of the terminal look (wider than the old sans): a 7-character price and change fit a tile.
    fit: { normal: { price: "text-[40px]", change: "text-[30px]" }, small: { price: "text-[40px]", change: "text-[26px]" }, smaller: { price: "text-[36px]", change: "text-[24px]" } },
  },
  compact: {
    pad: "py-1",
    ticker: "text-[40px]",
    arrow: "text-[36px]",
    name: "text-[24px] leading-[1.15]",
    spark: { width: 100, height: 24 },
    pending: "text-[26px]",
    fit: { normal: { price: "text-[34px]", change: "text-[26px]" }, small: { price: "text-[34px]", change: "text-[22px]" }, smaller: { price: "text-[30px]", change: "text-[20px]" } },
  },
} satisfies Record<string, { pad: string; ticker: string; arrow: string; name: string; spark: { width: number; height: number }; pending: string; fit: Record<PriceRowFit, { price: string; change: string }> }>;
type Size = (typeof SIZES)[keyof typeof SIZES];

function Tile({ tile: t, trend, round, glow, size }: { tile: BoardTile; trend: number[]; round: number | null; glow: boolean; size: Size }) {
  const tone = toneOf(t.changeBp);
  const lit = glow && t.move !== null ? GLOW[t.move] : "";
  return (
    <div
      className={`flex min-h-0 min-w-0 flex-col justify-between overflow-hidden rounded-xl border border-white/15 bg-[#0a0d10] px-4 ${size.pad} transition-[background-color,box-shadow] duration-1000 ${lit}`}
      data-testid={`tile-${t.ticker}`}
      data-lit={lit ? "true" : undefined}
    >
      <div className="flex items-start justify-between gap-3">
        <span className={`leading-none font-black tracking-tight text-[var(--term-amber)] ${size.ticker}`} data-testid="tile-ticker">
          {t.ticker}
        </span>
        {t.move ? (
          <span
            className={`shrink-0 leading-none ${size.arrow} ${TEXT[MOVE_TONE[t.move]]}`}
            data-testid="tile-move"
            data-move={t.move}
            aria-label={`${MOVE_WORDS[t.move]} in round ${round}`}
          >
            {MOVE_ARROWS[t.move]}
          </span>
        ) : null}
      </div>
      <div className="flex min-w-0 items-baseline gap-3">
        <p className={`min-w-0 flex-1 truncate text-slate-400 uppercase ${size.name}`} data-testid="tile-name">
          {t.name}
        </p>
        {/* A candle for every step so far: the tile's own live chart, redrawn at every clearing. */}
        {trend.length > 1 ? <MiniCandles values={trend} label={`${t.ticker} price by step`} width={size.spark.width} height={size.spark.height} /> : null}
        {t.closing ? (
          <span className="shrink-0 text-[24px] font-bold tracking-wide text-amber-300 uppercase" data-testid="tile-closing">
            Close
          </span>
        ) : null}
      </div>
      {t.price === null ? (
        <p className={`leading-[1.2] font-semibold text-slate-400 ${size.pending}`} data-testid="tile-pending">
          Starting price at 23:30
        </p>
      ) : (
        <PriceRow price={money(t.price)} change={bp(t.changeBp)} tone={tone} fit={size.fit} />
      )}
    </div>
  );
}

function PriceRow({
  price,
  change,
  tone,
  fit: fits,
}: {
  price: string;
  change: string;
  tone: "up" | "down" | "flat";
  fit: Record<PriceRowFit, { price: string; change: string }>;
}) {
  const fit = fits[priceRowFit(price, change)];
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className={`shrink-0 leading-none font-bold tabular-nums ${fit.price}`} data-testid="tile-price">
        {price}
      </span>
      <span className={`min-w-0 leading-none font-bold tabular-nums ${fit.change} ${CHANGE[tone]}`} data-testid="tile-change">
        {change}
      </span>
    </div>
  );
}
