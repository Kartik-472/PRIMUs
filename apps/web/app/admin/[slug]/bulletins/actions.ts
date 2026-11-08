"use server";

// Bulletins: the composer (publish_bulletin: general, rumour, fairness), the twist (publish_twist; the phase clock
// also publishes it at 22:15) and Q&A moderation (hide_question). Each action is one game function, run as the
// signed-in organiser.

import type { PhaseCode } from "@msim/engine";
import { rpc, type ActionResult } from "@/lib/rpc";
import { bulletinFromForm } from "@/lib/admin/content-bulletins";

export async function publishBulletin(eventId: string, phase: PhaseCode, _prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  const b = bulletinFromForm({ kind: form.get("kind"), title: form.get("title"), body: form.get("body") }, phase);
  if (!b.ok) return { ok: false, code: "BAD_BULLETIN", message: b.message };
  const r = await rpc("publish_bulletin", { p_event: eventId, p_kind: b.value.kind, p_title: b.value.title, p_body: b.value.body });
  return r.ok ? { ...r, message: `Published “${b.value.title}” to every screen.` } : r;
}

export async function publishTwist(eventId: string): Promise<ActionResult> {
  const r = await rpc("publish_twist", { p_event: eventId });
  if (r.ok && r.data?.already) return { ...r, message: "The twist had already been published." };
  return r.ok ? { ...r, message: "The twist is on every screen." } : r;
}

export async function hideQuestion(questionId: string, hidden: boolean): Promise<ActionResult> {
  const r = await rpc("hide_question", { p_question: questionId, p_hidden: hidden });
  return r.ok ? { ...r, message: hidden ? "Question hidden from the board." : "Question shown again." } : r;
}

// Market news (schedule_news): a bulletin with a price shock, kept hidden and released by the clearing of its round,
// which applies the shock inside that round's move. cancel_news drops one before it is released.
export async function scheduleNews(eventId: string, _prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  const text = (k: string) => {
    const v = form.get(k);
    return typeof v === "string" ? v.trim() : "";
  };
  const round = Number(text("round"));
  const pct = Number(text("shock"));
  const scope = text("scope");
  const target = text(scope === "CRISIS" ? "crisis" : "company");
  const title = text("title");
  if (!Number.isInteger(round) || round < 1 || round > 9) return { ok: false, code: "BAD_NEWS", message: "Choose the trading round that releases it (1 to 9)." };
  if (!Number.isFinite(pct) || pct === 0 || Math.abs(pct) > 20) return { ok: false, code: "BAD_NEWS", message: "The price shock is −20% to +20%, not zero." };
  if (!["MARKET", "CRISIS", "COMPANY"].includes(scope)) return { ok: false, code: "BAD_NEWS", message: "Choose who the news moves." };
  if (scope !== "MARKET" && !target) return { ok: false, code: "BAD_NEWS", message: scope === "CRISIS" ? "Choose the crisis card." : "Choose the company." };
  if (!title) return { ok: false, code: "BAD_NEWS", message: "News needs a title." };
  const r = await rpc("schedule_news", {
    p_event: eventId,
    p_round: round,
    p_title: title,
    p_body: text("body"),
    p_scope: scope,
    p_target: scope === "MARKET" ? null : target,
    p_shock_bp: Math.round(pct * 100),
  });
  return r.ok ? { ...r, message: `“${title}” goes out when round ${round} clears.` } : r;
}

export async function cancelNews(bulletinId: string): Promise<ActionResult> {
  const r = await rpc("cancel_news", { p_bulletin: bulletinId });
  return r.ok ? { ...r, message: "News item cancelled." } : r;
}
