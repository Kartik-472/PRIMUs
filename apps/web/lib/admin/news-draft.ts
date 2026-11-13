// AI-drafted market news for the Bulletins composer. Claude writes a draft from the market as it stands (prices,
// moves since the opening price, sectors); the organiser reads it, edits it, and publishes it like any bulletin.
// Prices never come from the model: they stay with the game's rules. The pure part (prompt, schema, check) is here.

import { BODY_MAX, TITLE_MAX } from "./content-bulletins";

export const NEWS_DEFAULT_MODEL = "claude-opus-5-5";

// A declined draft is re-run once on the API's default fallback model (beta server-side-fallback-2026-07-01). Unlike
// the judge, which keeps one model for every team on purpose (docs/JUDGE.md), a news draft has no fairness stake.
export const FALLBACK_BETA = "server-side-fallback-2026-07-01";
const FALLBACK_MODELS = ["claude-opus-5", "claude-sonnet-5-5", "claude-fable-5-1", "claude-fable-5-2"];

/** Models that take the server-side refusal fallback (others would answer 400 to it). Matched as prefixes. */
export function takesServerFallback(model: string): boolean {
  return FALLBACK_MODELS.some((p) => model === p || model.startsWith(`${p}-`));
}

export interface NewsCompany {
  ticker: string | null;
  name: string | null;
  sector: string | null;
  /** Prices in cents. */
  open: number | null;
  now: number | null;
}

export interface NewsDraft {
  kind: "GENERAL" | "CRISIS";
  title: string;
  body: string;
}

export const NEWS_SYSTEM = `You write the news wire for PRIMUS, a live stock-market simulation played by student teams at a college business event.
Write one short bulletin that every team will see on their phones and on the big screen.
- Base every fact on the market data given. Never invent prices, percentages, companies or results that are not in the data.
- Never tell teams to buy or sell, and never predict a price: describe what happened and what traders are watching.
- Tone: a sharp financial newswire, lively but neutral. No emoji. Indian English and rupee amounts (₹).
- Title: up to 12 words. Body: 2 to 4 sentences, under 600 characters.
- Kind: CRISIS only when the organiser's angle is a crisis or shock; otherwise GENERAL.`;

export const NEWS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["kind", "title", "body"],
  properties: {
    kind: { type: "string", enum: ["GENERAL", "CRISIS"] },
    title: { type: "string" },
    body: { type: "string" },
  },
} as const;

const rupees = (c: number) => `₹${(c / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

/** The user message: the organiser's angle, the market table (biggest moves first) and the recent headlines. */
export function newsPrompt(o: { angle: string; phase: string; companies: NewsCompany[]; recentTitles: string[] }): string {
  const rows = o.companies
    .filter((c) => c.ticker && c.now)
    .map((c) => ({ ...c, move: c.open ? ((c.now! - c.open) / c.open) * 100 : 0 }))
    .sort((a, b) => Math.abs(b.move) - Math.abs(a.move))
    .slice(0, 30)
    .map((c) => `${c.ticker} | ${c.name ?? ""} | ${c.sector ?? "-"} | ${rupees(c.now!)} | ${c.open ? `${c.move >= 0 ? "+" : ""}${c.move.toFixed(1)}% since opening` : "new"}`);
  return [
    `<angle>${o.angle.trim() || "A market update on the biggest movers right now."}</angle>`,
    `<phase>${o.phase}</phase>`,
    `<market>\nticker | company | sector | price | move\n${rows.join("\n") || "(no prices yet)"}\n</market>`,
    `<recent_headlines>\n${o.recentTitles.slice(0, 8).join("\n") || "(none)"}\n</recent_headlines>`,
    "Write the bulletin. Do not repeat a recent headline.",
  ].join("\n\n");
}

/** Checks the model's JSON against the composer's limits. */
export function parseNewsDraft(text: string): NewsDraft | null {
  try {
    const v = JSON.parse(text) as Partial<NewsDraft>;
    if ((v.kind !== "GENERAL" && v.kind !== "CRISIS") || typeof v.title !== "string" || typeof v.body !== "string") return null;
    const title = v.title.trim();
    const body = v.body.trim();
    if (!title || [...title].length > TITLE_MAX || [...body].length > BODY_MAX) return null;
    return { kind: v.kind, title, body };
  } catch {
    return null;
  }
}
