"use server";

// Rescue pairs: the organiser fixes who rescues whose company in Round 2, one pair from the form or a whole sheet
// (.xlsx or .csv) at once. One game function stores them as the signed-in organiser; it checks every row again and
// refuses after the crisis. Teams left out are paired by the lottery at the crisis.

import { rpc, type ActionResult } from "@/lib/rpc";
import { readPairsUpload, withSheetRows, type RescuePair } from "@/lib/admin/rescue-pairs";

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** A refusal that lists the bad rows (in the sheet's own numbering when it came from a sheet). */
function withProblems(r: ActionResult, rows?: readonly number[]): ActionResult {
  const problems = Array.isArray(r.data?.problems) ? (r.data.problems as string[]) : [];
  if (r.ok || problems.length === 0) return r;
  const listed = rows ? withSheetRows(problems, rows) : problems.map((p) => p.replace(/^Row \d+: /, ""));
  return { ...r, message: `${r.message ?? "Nothing was saved."} ${listed.join(" · ")}` };
}

export async function addPair(eventId: string, _prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  const pair: RescuePair = { rescuer: String(form.get("rescuer") ?? "").trim().toUpperCase(), founder: String(form.get("founder") ?? "").trim().toUpperCase() };
  if (!pair.rescuer || !pair.founder) return { ok: false, code: "BAD_PAIRS", message: "Choose both teams." };
  const r = await rpc("set_rescue_pairs", { p_event: eventId, p_pairs: [pair], p_replace: false });
  return r.ok ? { ...r, message: `${pair.rescuer} will rescue ${pair.founder}'s company.` } : withProblems(r);
}

export async function uploadPairs(eventId: string, _prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  const sheet = await readPairsUpload(form.get("file"));
  if (!sheet.ok) return { ok: false, code: "BAD_FILE", message: sheet.message };
  const { pairs, rows, left } = sheet.value;
  const r = await rpc("set_rescue_pairs", { p_event: eventId, p_pairs: pairs, p_replace: true });
  if (!r.ok) return withProblems(r, rows);
  return {
    ...r,
    message: `Saved ${plural(pairs.length, "pair")} from the sheet; the previous pairs were replaced.${left ? ` ${plural(left, "team")} without a company ${left === 1 ? "is" : "are"} left to the lottery.` : ""}`,
  };
}

export async function removePair(eventId: string, rescuerCode: string): Promise<ActionResult> {
  const r = await rpc("clear_rescue_pairs", { p_event: eventId, p_rescuer: rescuerCode });
  return r.ok ? { ...r, message: `${rescuerCode}'s pair removed; the lottery will pair it.` } : r;
}

export async function clearPairs(eventId: string): Promise<ActionResult> {
  const r = await rpc("clear_rescue_pairs", { p_event: eventId, p_rescuer: null });
  return r.ok ? { ...r, message: `Removed ${plural(Number(r.data?.removed ?? 0), "pair")}; the lottery will pair every team.` } : r;
}
