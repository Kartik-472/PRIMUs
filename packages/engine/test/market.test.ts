import { describe, expect, test } from "vitest";
import { MARKET, clearRound, marketMove, marketRound, marketZ } from "../src";

const flat = { lastMovePpm: 0, newsBp: 0, zMarket: 0, zSector: 0, zOwn: 0 };

describe("market model", () => {
  test("square-root impact on the money traded", () => {
    // $10,000 net → +1%; $1,000,000 net → +10%; selling mirrors buying.
    expect(marketMove({ oldPrice: 1_000, net: 1_000, scorePrice: 1_000, ...flat }).ppm).toBe(10_000);
    expect(marketMove({ oldPrice: 1_000, net: 4_000, scorePrice: 1_000, ...flat }).ppm).toBe(20_000);
    expect(marketMove({ oldPrice: 1_000, net: -4_000, scorePrice: 1_000, ...flat }).ppm).toBe(-20_000);
    expect(marketMove({ oldPrice: 1_000, net: 100_000, scorePrice: 1_000, ...flat }).ppm).toBe(100_000);
    // The same money moves a $5 and a $20 share alike.
    expect(marketMove({ oldPrice: 500, net: 2_000, scorePrice: 500, ...flat }).ppm).toBe(10_000);
    expect(marketMove({ oldPrice: 2_000, net: 500, scorePrice: 2_000, ...flat }).ppm).toBe(10_000);
  });

  test("no trades: the price drifts 12% of the way to the score-based price", () => {
    const m = marketMove({ oldPrice: 1_000, net: 0, scorePrice: 1_100, ...flat });
    expect(m.ppm).toBe(12_000);
    expect(m.newPrice).toBe(1_012);
    expect(marketMove({ oldPrice: 1_000, net: 0, scorePrice: 1_000, ...flat }).newPrice).toBe(1_000);
  });

  test("momentum, news and the ±10% limit", () => {
    expect(marketMove({ oldPrice: 1_000, net: 0, scorePrice: 1_000, ...flat, lastMovePpm: 50_000 }).ppm).toBe(5_000);
    expect(marketMove({ oldPrice: 1_000, net: 0, scorePrice: 1_000, ...flat, newsBp: -500 }).ppm).toBe(-50_000);
    const capped = marketMove({ oldPrice: 1_000, net: 1_000_000, scorePrice: 2_000, ...flat, newsBp: 2_000 });
    expect(capped.ppm).toBe(MARKET.CAP_PPM);
    expect(capped.newPrice).toBe(1_100);
    expect(marketMove({ oldPrice: 1_000, net: -1_000_000, scorePrice: 1, ...flat }).newPrice).toBe(900);
  });

  test("the noise: deterministic per seed, round and key, mean 0 and variance 1", () => {
    expect(marketZ("s", 1, "market")).toBe(marketZ("s", 1, "market"));
    expect(marketZ("s", 1, "market")).not.toBe(marketZ("s", 2, "market"));
    expect(marketZ("s", 1, "market")).not.toBe(marketZ("t", 1, "market"));
    const zs = Array.from({ length: 20_000 }, (_, i) => marketZ("stats", 1 + (i % 9), `company:${i}`));
    const mean = zs.reduce((a, b) => a + b, 0) / zs.length;
    const variance = zs.reduce((a, b) => a + (b - mean) ** 2, 0) / zs.length;
    expect(Math.abs(mean)).toBeLessThan(0.03);
    expect(Math.abs(variance - 1)).toBeLessThan(0.05);
    expect(Math.max(...zs.map(Math.abs))).toBeLessThanOrEqual(2 * Math.sqrt(3));
  });

  test("companies with the same crisis card share their sector move", () => {
    const mk = (id: string, sector: string) => ({ id, sector, oldPrice: 1_000, scorePrice: 1_000, lastMovePpm: 0 });
    const r = marketRound("seed", 4, [mk("a", "X"), mk("b", "X"), mk("c", "Y")], {});
    expect(r.a!.sector).toBe(r.b!.sector);
    expect(r.a!.sector).not.toBe(r.c!.sector);
    expect(r.a!.market).toBe(r.c!.market);
    expect(r.a!.own).not.toBe(r.b!.own);
  });

  test("clearRound fills every order at the model's price", () => {
    const res = clearRound(
      { A: 1_000 },
      [
        { id: "o1", teamId: "t1", companyId: "A", type: "BUY", qty: 3_000 },
        { id: "o2", teamId: "t2", companyId: "A", type: "BUY", qty: 1_000 },
      ],
      { t1: { cash: 10_000_000, positions: {} }, t2: { cash: 10_000_000, positions: {} } },
      (_id, old, net) => marketMove({ oldPrice: old, net, scorePrice: old, ...flat }).newPrice,
    );
    expect(res.companies.A!.newPrice).toBe(1_020);
    expect(res.fills).toEqual([{ orderId: "o1", price: 1_020 }, { orderId: "o2", price: 1_020 }]);
    expect(res.traders.t1!.cash).toBe(10_000_000 - 3_000 * 1_020);
  });
});
