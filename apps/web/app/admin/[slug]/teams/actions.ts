"use server";

// The registration desk: find a sign-up, confirm a team (from a sign-up or a walk-in) onto a login card, edit it, or
// take it off again. Each is one game function run as the signed-in organiser.

import { rpc, type ActionResult } from "@/lib/rpc";

export interface DeskMember {
  full_name: string;
  roll_number: string | null;
}

export async function findSignup(eventId: string, number: string): Promise<ActionResult> {
  return rpc("find_signup", { p_event: eventId, p_number: number });
}

export async function confirmTeam(eventId: string, signupId: string | null, teamName: string, members: DeskMember[]): Promise<ActionResult> {
  const r = await rpc("desk_confirm", { p_event: eventId, p_signup: signupId, p_team_name: teamName, p_members: members });
  if (!r.ok) return r;
  const code = String(r.data?.code ?? "");
  return {
    ...r,
    message: r.data?.new
      ? `Confirmed as ${String(r.data?.signup ?? "")}: give them login card ${code}. ${String(r.data?.active ?? "")} teams confirmed.`
      : `Saved ${code}.`,
  };
}

export async function removeTeam(eventId: string, signupId: string): Promise<ActionResult> {
  const r = await rpc("desk_remove", { p_event: eventId, p_signup: signupId });
  if (!r.ok) return r;
  return { ...r, message: `Removed: card ${String(r.data?.code ?? "")} is free again. ${String(r.data?.active ?? "")} teams confirmed.` };
}

export async function setSignupsOpen(eventId: string, open: boolean): Promise<ActionResult> {
  const r = await rpc("set_signups_open", { p_event: eventId, p_open: open });
  if (!r.ok) return r;
  return { ...r, message: open ? "Online registration is open." : "Online registration is closed." };
}
