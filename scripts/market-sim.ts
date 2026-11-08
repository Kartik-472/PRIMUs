// Simulates a full Round 3 with 150 bot teams, to tune the market model and compare it with the old rule.
//   pnpm market-sim                       one night with the model, summary table
//   pnpm market-sim --runs 40             40 nights (different seeds), averages
//   pnpm market-sim --json out.json       also write every price path and team result
//
// Bots: value investors (buy below the score-based price, sell above), trend followers, herders (pile into the best
// PRDs) and random traders. Teams start with $50,000 + $1,000 per Round 2 point from the reveal, as the portal does.

import { writeFileSync } from "node:fs";
import {
  MARKET,
  applyReveal,
  buyReserve,
  closingPrice,
  crisisShock,
  marketRound,
  mul,
  round3Points,
  startPrice,
  clearingPrice,
  type MarketParams,
} from "@msim/engine";

const args = process.argv.slice(2);
const opt = (k: string, d: string) => {
  const i = args.indexOf(`--${k}`);
  return i >= 0 ? args[i + 1]! : d;
};
const RUNS = Number(opt("runs", "1"));
const P: MarketParams = { ...MARKET, ...JSON.parse(opt("params", "{}")) };
const JSON_OUT = opt("json", "");

function mulberry(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Strategy = "VALUE" | "TREND" | "HERD" | "RANDOM";
interface Company { id: string; sector: string; prd: number; crisis: number; start: number; market: number; score: number; last: number; path: number[]; closingMarket?: number; closing?: number }
interface Team { id: string; strategy: Strategy; own: string; rescued: string; r2: number; cash: number; pos: Record<string, number>; startCash: number }

function night(runSeed: number, model: "NEW" | "OLD", p: MarketParams = P, marketSeed = `sim-${runSeed}`) {
  let rnd = mulberry(runSeed);
  const gauss = () => (rnd() + rnd() + rnd() + rnd() - 2) * Math.sqrt(3);
  const N = 150;
  const clamp = (x: number) => Math.max(0, Math.min(100, Math.round(x)));
  const companies: Company[] = [];
  for (let i = 0; i < N; i++) {
    const prd = clamp(62 + 14 * gauss());
    const crisis = clamp(60 + 16 * gauss());
    const start = startPrice(prd);
    const post = crisisShock(start);
    companies.push({ id: `C${i}`, sector: `S${i % 10}`, prd, crisis, start, market: post, score: post, last: 0, path: [post] });
  }
  const strategies: Strategy[] = ["VALUE", "VALUE", "VALUE", "VALUE", "TREND", "TREND", "TREND", "HERD", "HERD", "RANDOM"];
  const teams: Team[] = companies.map((c, i) => ({
    id: `T${i}`,
    strategy: strategies[Math.floor(rnd() * strategies.length)]!,
    own: c.id,
    rescued: companies[(i + 1) % N]!.id,
    r2: companies[(i + 1) % N]!.crisis,
    cash: 5_000_000,
    pos: {},
    startCash: 5_000_000,
  }));

  const seed = marketSeed;
  const byId = new Map(companies.map((c) => [c.id, c]));
  const stats = { capHits: 0, moves: [] as number[], untradedMoves: [] as number[] };

  for (let round = 1; round <= 9; round++) {
    if (round === 3) {
      // 02:45 reveal: prices × factor, and the cash grant.
      for (const c of companies) {
        c.market = applyReveal(c.market, c.crisis);
        c.score = applyReveal(c.score, c.crisis);
      }
      for (const t of teams) {
        t.cash += t.r2 * 100_000;
        t.startCash += t.r2 * 100_000;
      }
    }
    // Orders.
    const net: Record<string, number> = {};
    const orders: { t: Team; c: Company; qty: number }[] = [];
    for (const t of teams) {
      rnd = mulberry(runSeed * 100_000 + Number(t.id.slice(1)) * 10 + round); // bot choices don't depend on earlier noise
      const allowed = companies.filter((c) => c.id !== t.own && c.id !== t.rescued);
      // What the team believes a company is worth. Before the reveal, the crisis score is unknown: teams read the
      // published solutions and guess it with noise.
      // Every team reads the companies differently (a fixed personal bias of a few percent per company).
      const bias = (c: Company) => 1 + 0.04 * ((mulberry(runSeed * 7 + Number(t.id.slice(1)) * 1_000 + Number(c.id.slice(1)))() - 0.5) * 2);
      const fair = (c: Company) => {
        if (round >= 3) return c.score * bias(c);
        const guess = c.crisis + 12 * gauss();
        return applyReveal(c.score, clamp(guess)) * bias(c);
      };
      const wants: [Company, number][] = []; // + buy, − sell, in shares
      if (t.strategy === "VALUE") {
        const ranked = allowed.map((c) => [c, fair(c) / c.market - 1] as const).sort((a, b) => b[1] - a[1]);
        const k = 3 + (Number(t.id.slice(1)) % 4);
        for (const [c, edge] of ranked.slice(0, k)) if (edge > 0.02) wants.push([c, Math.round((t.cash * (0.6 / k)) / c.market)]);
        for (const [cid, q] of Object.entries(t.pos)) {
          const c = byId.get(cid)!;
          if (q > 0 && fair(c) / c.market - 1 < -0.01) wants.push([c, -q]);
        }
      } else if (t.strategy === "TREND") {
        const ranked = [...allowed].sort((a, b) => b.last - a.last);
        for (const c of ranked.slice(0, 3)) if (c.last > 0) wants.push([c, Math.round((t.cash * 0.3) / c.market)]);
        for (const [cid, q] of Object.entries(t.pos)) if (q > 0 && byId.get(cid)!.last < 0) wants.push([byId.get(cid)!, -q]);
      } else if (t.strategy === "HERD") {
        const ranked = [...allowed].sort((a, b) => b.prd - a.prd || (round >= 3 ? b.crisis - a.crisis : 0));
        for (const c of ranked.slice(0, 4)) wants.push([c, Math.round((t.cash * 0.25) / c.market)]);
        if (round >= 8) for (const [cid, q] of Object.entries(t.pos)) if (q > 0 && rnd() < 0.3) wants.push([byId.get(cid)!, -q]);
      } else {
        for (let k = 0; k < 3; k++) {
          const c = allowed[Math.floor(rnd() * allowed.length)]!;
          const held = t.pos[c.id] ?? 0;
          if (held > 0 && rnd() < 0.5) wants.push([c, -Math.ceil(held * rnd())]);
          else wants.push([c, Math.round((t.cash * 0.2 * rnd()) / c.market)]);
        }
      }
      // Apply the rules: 5,000 shares, 110% reserve, own shares only.
      let free = t.cash;
      for (const [c, q0] of wants) {
        let q = q0;
        if (q > 0) {
          q = Math.min(q, 5_000 - (t.pos[c.id] ?? 0) - orders.filter((o) => o.t === t && o.c === c && o.qty > 0).reduce((s, o) => s + o.qty, 0));
          while (q > 0 && buyReserve(q, c.market) > free) q = Math.floor(q * 0.9);
          if (q <= 0) continue;
          free -= buyReserve(q, c.market);
        } else {
          q = -Math.min(-q, t.pos[c.id] ?? 0);
          if (q === 0) continue;
        }
        orders.push({ t, c, qty: q });
        net[c.id] = (net[c.id] ?? 0) + q;
      }
    }
    // Clearing.
    let moved: Record<string, number>;
    if (model === "NEW") {
      const m = marketRound(seed, round, companies.map((c) => ({ id: c.id, sector: c.sector, oldPrice: c.market, scorePrice: c.score, lastMovePpm: c.last })), net, p);
      moved = Object.fromEntries(Object.entries(m).map(([id, x]) => [id, x.newPrice]));
    } else {
      moved = Object.fromEntries(companies.map((c) => [c.id, clearingPrice(c.market, net[c.id] ?? 0)]));
    }
    for (const c of companies) {
      const np = moved[c.id]!;
      const ppm = Math.round(((np - c.market) / c.market) * 1e6);
      if (Math.abs(ppm) >= 99_000) stats.capHits++;
      stats.moves.push(ppm / 1e4);
      if (!net[c.id]) stats.untradedMoves.push(ppm / 1e4);
      c.last = ppm;
      c.market = np;
      c.path.push(np);
      if (round === 8) c.closingMarket = np;
      if (round === 9) c.closingMarket = Math.round((c.closingMarket! + np) / 2);
    }
    orders.sort((a, b) => a.qty - b.qty);
    for (const o of orders) {
      const price = o.c.market;
      if (o.qty > 0) { o.t.cash -= mul(o.qty, price); }
      else { o.t.cash += mul(-o.qty, price); }
      o.t.pos[o.c.id] = (o.t.pos[o.c.id] ?? 0) + o.qty;
      if (o.t.cash < -1000) throw new Error(`team ${o.t.id} went negative ${model} r${round} ${o.t.strategy} cash=${o.t.cash} ${JSON.stringify(orders.filter(x=>x.t===o.t).map(x=>[x.c.id,x.qty]))} pos=${JSON.stringify(o.t.pos)}`);
    }
  }
  for (const c of companies) c.closing = closingPrice(c.closingMarket!, c.score);
  const results = teams.map((t) => {
    const value = t.cash + Object.entries(t.pos).reduce((s, [cid, q]) => s + mul(q, byId.get(cid)!.closing!), 0);
    const ret = (value - t.startCash) / t.startCash;
    return { id: t.id, strategy: t.strategy, ret, points: round3Points(value, t.startCash) };
  });
  return { companies, results, stats };
}

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / Math.max(1, xs.length);
const sd = (xs: number[]) => Math.sqrt(mean(xs.map((x) => (x - mean(xs)) ** 2)));
function corr(a: number[], b: number[]) {
  const ma = mean(a), mb = mean(b);
  let n = 0, da = 0, db = 0;
  for (let i = 0; i < a.length; i++) { n += (a[i]! - ma) * (b[i]! - mb); da += (a[i]! - ma) ** 2; db += (b[i]! - mb) ** 2; }
  return n / Math.sqrt(da * db || 1);
}

function summarise(model: "NEW" | "OLD") {
  const agg = { absMove: [] as number[], capShare: [] as number[], flat: [] as number[], corrScore: [] as number[], retSd: [] as number[], byStrat: {} as Record<string, number[]>, pts: [] as number[] };
  let sample: ReturnType<typeof night> | undefined;
  for (let r = 0; r < RUNS; r++) {
    const n = night(1000 + r, model);
    sample ??= n;
    agg.absMove.push(mean(n.stats.moves.map(Math.abs)));
    agg.capShare.push(n.stats.capHits / n.stats.moves.length);
    agg.flat.push(n.stats.moves.filter((m) => m === 0).length / n.stats.moves.length);
    agg.corrScore.push(corr(n.companies.map((c) => c.closingMarket! / c.score), n.companies.map(() => 1)) || corr(n.companies.map((c) => c.closingMarket!), n.companies.map((c) => c.score)));
    agg.corrScore[agg.corrScore.length - 1] = corr(n.companies.map((c) => c.closingMarket!), n.companies.map((c) => c.score));
    agg.retSd.push(sd(n.results.map((x) => x.ret)));
    for (const x of n.results) (agg.byStrat[x.strategy] ??= []).push(x.ret);
    agg.pts.push(...n.results.map((x) => x.points));
  }
  return { model, agg, sample: sample! };
}

const rows = (["OLD", "NEW"] as const).map(summarise);
// Luck: the same night with a different market seed. How well do team returns keep their order?
const rank = (xs: number[]) => { const o = xs.map((x, i) => [x, i] as const).sort((a, b) => a[0] - b[0]); const r = new Array(xs.length); o.forEach(([, i], k) => (r[i] = k)); return r as number[]; };
const luck: number[] = [];
const noise: number[] = [];
for (let r = 0; r < RUNS; r++) {
  const a = night(1000 + r, "NEW").results.map((x) => x.ret);
  const b = night(1000 + r, "NEW", P, `other-${r}`).results.map((x) => x.ret);
  luck.push(corr(rank(a), rank(b)));
  noise.push(mean(a.map((x, i) => (x - b[i]!) ** 2)) / 2 / sd(a) ** 2);
}
console.log(`Round 3 simulation, 150 teams, ${RUNS} night(s)\n`);
console.log(["", ...rows.map((r) => r.model === "OLD" ? "old rule" : "new model")].join("\t\t"));
const line = (label: string, f: (r: (typeof rows)[number]) => string) => console.log([label.padEnd(34), ...rows.map(f)].join("\t\t"));
line("average move per round", (r) => pct(mean(r.agg.absMove) / 100));
line("moves stuck at the ±10% limit", (r) => pct(mean(r.agg.capShare)));
line("rounds with no move at all", (r) => pct(mean(r.agg.flat)));
line("corr(closing market, judged value)", (r) => mean(r.agg.corrScore).toFixed(2));
line("spread of team returns (sd)", (r) => pct(mean(r.agg.retSd)));
for (const s of ["VALUE", "TREND", "HERD", "RANDOM"]) line(`average return, ${s.toLowerCase()}`, (r) => pct(mean(r.agg.byStrat[s] ?? [])));
line("teams at 100 / at 0 points", (r) => `${pct(r.agg.pts.filter((x) => x === 100).length / r.agg.pts.length)} / ${pct(r.agg.pts.filter((x) => x === 0).length / r.agg.pts.length)}`);

console.log(`\nsame teams, different market seed: rank correlation of returns ${mean(luck).toFixed(2)} (1 = noise changes nothing); share of return differences due to the noise: ${pct(mean(noise))}`);
if (JSON_OUT) {
  writeFileSync(JSON_OUT, JSON.stringify(rows.map((r) => ({ model: r.model, companies: r.sample.companies.map((c) => ({ id: c.id, sector: c.sector, prd: c.prd, crisis: c.crisis, score: c.score, path: c.path, closing: c.closing })), results: r.sample.results }))));
  console.log(`\nwrote ${JSON_OUT}`);
}
