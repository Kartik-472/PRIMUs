"use server";

// The public sign-up: no login, one game function (public.sign_up) that checks everything in the database.

import { rpc, type ActionResult } from "@/lib/rpc";

export type Category = "THAPAR" | "OTHER";

export interface SignUpInput {
  category: Category;
  /** Thapar teams; another college's team is named after the college. */
  teamName: string;
  /** Other colleges only. */
  college: string;
  /** The team leader's. */
  email: string;
  phone: string;
  /** The whole team, the leader first. */
  members: { full_name: string; roll_number: string }[];
}

export async function signUpTeam(slug: string, input: SignUpInput): Promise<ActionResult> {
  return rpc("sign_up", {
    p_slug: slug,
    p_category: input.category,
    p_team_name: input.teamName,
    p_college: input.college,
    p_contact_email: input.email,
    p_contact_phone: input.phone,
    p_members: input.members.slice(0, 5),
  });
}
