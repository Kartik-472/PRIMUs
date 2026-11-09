"use server";

// Registration: tick the teams that play tonight, or activate / withdraw one team, before the draw (game functions,
// run as the signed-in organiser).

import { rpc, type ActionResult } from "@/lib/rpc";

const WORDS = { ACTIVE: "is registered", BACKUP: "is no longer registered", WITHDRAWN: "is withdrawn" } as const;

export async function setTeamStatus(eventId: string, code: string, status: keyof typeof WORDS): Promise<ActionResult> {
  const r = await rpc("set_team_status", { p_event: eventId, p_team_code: code, p_status: status, p_reason: null });
  if (!r.ok) return r;
  return { ...r, message: `${code} ${WORDS[status]}. ${String(r.data?.active ?? "")} teams are registered.` };
}

/** Registers exactly the ticked teams; every other team is unregistered. */
export async function saveRegistration(eventId: string, codes: string[]): Promise<ActionResult> {
  const r = await rpc("set_registration", { p_event: eventId, p_codes: codes });
  if (!r.ok) return r;
  const d = r.data ?? {};
  return {
    ...r,
    message: `Saved: ${String(d.active ?? 0)} teams registered (${String(d.registered ?? 0)} added, ${String(d.unregistered ?? 0)} taken off).`,
  };
}
