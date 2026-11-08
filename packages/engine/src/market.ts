// The Round 3 market model: how a company's market price moves when a trading round clears.
//
// The old rule moved the price by (net shares ÷ 1,000)% and nothing else. Real prices also move with the money
// behind a trade (not the share count), react less than linearly to big orders, drift back towards fair value,
// move together with the market and their sector, and wiggle when nobody trades. Per company and round:
//
//   impact     = sign(net) × IMPACT × √(|net| × old price ÷ DEPTH)     the square-root law of price impact, on the
//                                                                      money traded ($10,000 net → +1%, $1M → +10%)
//   value      = REVERSION × (score-based price − old) ÷ old           background value investors close part of the
//                                                                      gap to the judged value every round
//   momentum   = MOMENTUM × last round's clearing move                  trend followers
//   market     = MARKET_VOL × z(round, "market")                       one move shared by every company
//   sector     = SECTOR_VOL × z(round, crisis card)                    one move shared by the 15 companies of a crisis
//   own        = OWN_VOL × z(round, company)                           each company's own wiggle
//   news       = Σ shocks the organisers scheduled for this round       released with the clearing, so nobody can
//                                                                      trade on them first
//
//   move = clamp(sum, −10%, +10%), in parts per million (rounded half-up); new = old × (1 + move), rounded half-up.
//
// Everything stays fair: every order in a round still fills at one price, so order speed gives no advantage, and the
// ±10% limit means the 110% buy reserve always covers a fill.
//
// The random parts come from a market seed the organisers commit to (SHA-256 published) before Round 3 and reveal
// after the close, so nobody can predict them and anyone can recompute every price afterwards:
//   word stream of key k = SHA-256(seed + ":market:" + round + ":" + k), read as 8 big-endian uint32 words
//   z = (u1 + u2 + u3 + u4 − 2) × √3,  u = word ÷ 2^32                (Irwin–Hall: mean 0, variance 1, within ±3.46)
//
// Only +, −, ×, ÷ and √ on doubles are used; IEEE 754 rounds each of them exactly the same way in JavaScript and in
// Postgres (float8), so the SQL port (app.market_move_ppm) agrees to the part per million. The parity tests check it.

import { sha256 } from "@noble/hashes/sha2.js";
import { utf8ToBytes } from "@noble/hashes/utils.js";
import { mulRate } from "./money";

export const MARKET = {
  IMPACT: 0.01, // 1% for DEPTH cents of net money
  DEPTH_CENTS: 1_000_000, // $10,000
  REVERSION: 0.12, // 12% of the gap to the score-based price per round
  MOMENTUM: 0.1,
  MARKET_VOL: 0.003, // 0.3% per round
  SECTOR_VOL: 0.005, // 0.5% per round
  OWN_VOL: 0.007, // 0.7% per round
  CAP_PPM: 100_000, // ±10% per round
  PPM: 1_000_000,
  NEWS_CAP_BP: 2_000, // a single news shock is at most ±20% (the round's ±10% limit still applies)
} as const;

export type MarketParams = { -readonly [K in keyof typeof MARKET]: number };

/** Four uniform 32-bit words for one key of one round. */
export function marketWords(seed: string, round: number, key: string): [number, number, number, number] {
  const b = sha256(utf8ToBytes(`${seed}:market:${round}:${key}`));
  const w = (i: number) => ((b[i]! << 24) | (b[i + 1]! << 16) | (b[i + 2]! << 8) | b[i + 3]!) >>> 0;
  return [w(0), w(4), w(8), w(12)];
}

/** A standard-ish normal draw (Irwin–Hall of 4), in [−2√3, 2√3]. */
export function marketZ(seed: string, round: number, key: string): number {
  const [a, b, c, d] = marketWords(seed, round, key);
  const T = 4294967296;
  return (a / T + b / T + c / T + d / T - 2) * Math.sqrt(3);
}

export interface MarketInput {
  /** Market price before this clearing, cents. */
  oldPrice: number;
  /** Net shares bought this round (bought − sold). */
  net: number;
  /** Score-based price, cents (start × 0.85 before the reveal, × the reveal factor after). */
  scorePrice: number;
  /** Last round's clearing move in ppm (0 in round 1). */
  lastMovePpm: number;
  /** Sum of the news shocks released with this clearing, basis points. */
  newsBp: number;
  zMarket: number;
  zSector: number;
  zOwn: number;
}

export interface MarketMove {
  impact: number;
  value: number;
  momentum: number;
  market: number;
  sector: number;
  own: number;
  news: number;
  /** The capped move, parts per million. */
  ppm: number;
  newPrice: number;
}

const roundHalfUp = (x: number) => Math.floor(x + 0.5);

/** The move of one company in one round. The SQL port is app.market_move_ppm; keep the order of operations. */
export function marketMove(i: MarketInput, p: MarketParams = MARKET): MarketMove {
  const old = i.oldPrice;
  const sign = i.net > 0 ? 1 : i.net < 0 ? -1 : 0;
  const impact = sign * p.IMPACT * Math.sqrt((Math.abs(i.net) * old) / p.DEPTH_CENTS);
  const value = (p.REVERSION * (i.scorePrice - old)) / old;
  const momentum = (p.MOMENTUM * i.lastMovePpm) / p.PPM;
  const market = p.MARKET_VOL * i.zMarket;
  const sector = p.SECTOR_VOL * i.zSector;
  const own = p.OWN_VOL * i.zOwn;
  const news = i.newsBp / 10_000;
  const sum = impact + value + momentum + market + sector + own + news;
  const ppm = Math.max(-p.CAP_PPM, Math.min(p.CAP_PPM, roundHalfUp(sum * p.PPM)));
  return { impact, value, momentum, market, sector, own, news, ppm, newPrice: mulRate(old, p.PPM + ppm, p.PPM) };
}

export interface MarketCompany {
  id: string;
  /** Crisis card (sector) id; companies sharing one move together. */
  sector: string;
  oldPrice: number;
  scorePrice: number;
  lastMovePpm: number;
  newsBp?: number;
}

/** Every company's move for one round, from the market seed. */
export function marketRound(
  seed: string,
  round: number,
  companies: readonly MarketCompany[],
  net: Readonly<Record<string, number>>,
  p: MarketParams = MARKET,
): Record<string, MarketMove> {
  const zMarket = marketZ(seed, round, "market");
  const sectors = new Map<string, number>();
  const out: Record<string, MarketMove> = {};
  for (const c of companies) {
    if (!sectors.has(c.sector)) sectors.set(c.sector, marketZ(seed, round, `sector:${c.sector}`));
    out[c.id] = marketMove(
      {
        oldPrice: c.oldPrice,
        net: net[c.id] ?? 0,
        scorePrice: c.scorePrice,
        lastMovePpm: c.lastMovePpm,
        newsBp: c.newsBp ?? 0,
        zMarket,
        zSector: sectors.get(c.sector)!,
        zOwn: marketZ(seed, round, `company:${c.id}`),
      },
      p,
    );
  }
  return out;
}
