// The verifiable lottery.
//
// The day before, organisers publish SHA-256(secret seed). At 21:15 they enter the seed and a dice roll on stage.
//   root = hex(SHA-256(seed + dice))                     (plain string concatenation, UTF-8)
// Each draw uses its own stream of the same generator, so one draw can never shift another:
//   block i of stream "problems" = SHA-256(root + ":problems:" + i), read as 8 big-endian unsigned 32-bit words
// Integers below n are drawn by rejection sampling (no modulo bias). Shuffles are Fisher–Yates from the end.
//
// Three draws, all from the same root:
//   21:15  "problems"  one problem card per team (each card to at most 3 teams, spread evenly)
//   23:45  "crisis"    one crisis card per company (with 150 companies and 10 types, each type exactly 15 times)
//   23:45  "circle"    the rescue circle: each team rescues the next team's company
// Everything here is also implemented in SQL (app.lottery_*) and both are tested against the same fixtures.

import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";

export function sha256Hex(text: string): string {
  return bytesToHex(sha256(utf8ToBytes(text)));
}

export function verifyCommitment(seed: string, commitment: string): boolean {
  return sha256Hex(seed) === commitment.trim().toLowerCase();
}

export function rootSeed(seed: string, dice: string): string {
  return sha256Hex(seed + dice);
}

export type Stream = "problems" | "crisis" | "circle";

export class Rng {
  private block = 0;
  private words: number[] = [];

  constructor(
    private readonly root: string,
    private readonly stream: Stream,
  ) {}

  nextUint32(): number {
    if (this.words.length === 0) {
      const bytes = sha256(utf8ToBytes(`${this.root}:${this.stream}:${this.block++}`));
      for (let i = 0; i < 32; i += 4) {
        this.words.push(((bytes[i]! << 24) | (bytes[i + 1]! << 16) | (bytes[i + 2]! << 8) | bytes[i + 3]!) >>> 0);
      }
    }
    return this.words.shift()!;
  }

  /** Uniform integer in [0, n). */
  int(n: number): number {
    if (!Number.isInteger(n) || n < 1 || n > 2 ** 32) throw new Error(`bad range ${n}`);
    const limit = 2 ** 32 - (2 ** 32 % n);
    for (;;) {
      const u = this.nextUint32();
      if (u < limit) return u % n;
    }
  }

  shuffle<T>(items: readonly T[]): T[] {
    const a = [...items];
    for (let i = a.length - 1; i > 0; i--) {
      const j = this.int(i + 1);
      [a[i], a[j]] = [a[j]!, a[i]!];
    }
    return a;
  }
}

/** At most this many teams share one problem card. */
export const MAX_TEAMS_PER_PROBLEM = 3;

const sorted = (xs: readonly string[]) => [...xs].sort();

function assertDistinct(xs: readonly string[], what: string) {
  if (new Set(xs).size !== xs.length) throw new Error(`duplicate ${what}`);
}

/**
 * 21:15: one problem card per team. The teams (sorted by code) are shuffled, the deck (in card-number order) is
 * shuffled, and the k-th team in the shuffled order gets the (k mod deck size)-th card: every card goes to
 * ⌊teams ÷ cards⌋ or ⌈teams ÷ cards⌉ teams, never more than 3 (150 teams, 50 cards: exactly 3 each).
 * @returns team code → card id
 */
export function dealProblemCards(root: string, teamCodes: readonly string[], cardIds: readonly string[]): Map<string, string> {
  assertDistinct(teamCodes, "team codes");
  assertDistinct(cardIds, "card ids");
  if (cardIds.length === 0) throw new Error("the problem deck is empty");
  if (Math.ceil(teamCodes.length / cardIds.length) > MAX_TEAMS_PER_PROBLEM) {
    throw new Error(`the problem deck needs at least ${Math.ceil(teamCodes.length / MAX_TEAMS_PER_PROBLEM)} cards`);
  }
  const rng = new Rng(root, "problems");
  const teams = rng.shuffle(sorted(teamCodes));
  const deck = rng.shuffle(cardIds);
  return new Map(teams.map((team, k) => [team, deck[k % deck.length]!]));
}

/**
 * 23:45: one crisis card per company. The companies (by founder team code) are shuffled and dealt round the deck in
 * card-number order, so every crisis type goes to the same number of companies (within one): 150 companies and 10
 * types, exactly 15 each.
 * @param deck crisis cards, any order (sorted here by number)
 * @returns founder team code → crisis card id
 */
export function assignCrises(
  root: string,
  founderCodes: readonly string[],
  deck: readonly { id: string; number: number }[],
): Map<string, string> {
  assertDistinct(founderCodes, "team codes");
  if (deck.length === 0) throw new Error("the crisis deck is empty");
  const cards = [...deck].sort((a, b) => a.number - b.number);
  const rng = new Rng(root, "crisis");
  const order = rng.shuffle(sorted(founderCodes));
  return new Map(order.map((team, k) => [team, cards[k % cards.length]!.id]));
}

/**
 * 23:45: the rescue circle. The teams (sorted by code) are shuffled into a circle and each team rescues the company of
 * the next team round the circle: nobody rescues its own company and every company has exactly one rescuer.
 * @returns rescuer team code → the founder team code of the company it rescues
 */
export function rescueCircle(root: string, teamCodes: readonly string[]): Map<string, string> {
  assertDistinct(teamCodes, "team codes");
  if (teamCodes.length < 2) throw new Error("the rescue circle needs at least 2 teams");
  const rng = new Rng(root, "circle");
  const circle = rng.shuffle(sorted(teamCodes));
  return new Map(circle.map((team, k) => [team, circle[(k + 1) % circle.length]!]));
}

export interface RescuePair {
  /** The team that rescues… */
  rescuer: string;
  /** …the company founded by this team. */
  founder: string;
}

/**
 * 23:45, with pairs fixed by the organisers: those pairs as given, and every other team paired by the lottery. The
 * teams are shuffled into the rescue circle. The teams still without a company to rescue, and the companies still
 * without a rescuer, are each taken in circle order, and each such team rescues the company one step on; if that would
 * give a team its own company, two steps on, and so on. With no fixed pairs this is exactly rescueCircle().
 * Mirrors app.lottery_plan in SQL.
 * @returns rescuer team code → the founder team code of the company it rescues
 */
export function rescuePlan(root: string, teamCodes: readonly string[], fixed: readonly RescuePair[] = []): Map<string, string> {
  assertDistinct(teamCodes, "team codes");
  if (teamCodes.length < 2) throw new Error("the rescue circle needs at least 2 teams");
  const playing = new Set(teamCodes);
  for (const p of fixed) {
    if (!playing.has(p.rescuer) || !playing.has(p.founder)) throw new Error("a fixed pair names a team that is not playing");
    if (p.rescuer === p.founder) throw new Error("a team cannot rescue its own company");
  }
  const rescuers = new Set(fixed.map((p) => p.rescuer));
  const founders = new Set(fixed.map((p) => p.founder));
  if (rescuers.size !== fixed.length || founders.size !== fixed.length) throw new Error("a team is in two fixed pairs");

  const rng = new Rng(root, "circle");
  const circle = rng.shuffle(sorted(teamCodes));
  const plan = new Map(fixed.map((p) => [p.rescuer, p.founder]));
  const r = circle.filter((t) => !rescuers.has(t));
  const f = circle.filter((t) => !founders.has(t));
  const m = r.length;
  if (m === 0) return plan;
  for (let s = 1; s <= m; s++) {
    const k = s % m; // 1, 2, …, m − 1, 0
    if (r.every((team, i) => team !== f[(i + k) % m])) {
      r.forEach((team, i) => plan.set(team, f[(i + k) % m]!));
      return plan;
    }
  }
  throw new Error("the fixed pairs leave one team with only its own company to rescue");
}

export interface LotteryDraw {
  root: string;
  problems: Map<string, string>;
  crises: Map<string, string>;
  circle: Map<string, string>;
}

/** Every draw of the night from one seed and dice roll. */
export function drawLottery(
  seed: string,
  dice: string,
  teamCodes: readonly string[],
  problemCardIds: readonly string[],
  crisisDeck: readonly { id: string; number: number }[],
  rescuePairs: readonly RescuePair[] = [],
): LotteryDraw {
  const root = rootSeed(seed, dice);
  return {
    root,
    problems: dealProblemCards(root, teamCodes, problemCardIds),
    crises: assignCrises(root, teamCodes, crisisDeck),
    circle: rescuePlan(root, teamCodes, rescuePairs),
  };
}
