"use server";

// The public sign-up: no login, one game function (public.sign_up) that checks everything in the database.

import { rpc, type ActionResult } from "@/lib/rpc";

export interface SignUpInput {
  teamName: string;
  email: string;
  phone: string;
  members: { full_name: string; roll_number: string }[];
}

export async function signUpTeam(slug: string, input: SignUpInput): Promise<ActionResult> {
  return rpc("sign_up", {
    p_slug: slug,
    p_team_name: input.teamName,
    p_contact_email: input.email,
    p_contact_phone: input.phone,
    p_members: input.members.slice(0, 4),
  });
}
