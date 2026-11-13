"use server";

// The public sign-up form: one team registers and is given its serial number (its team ID until the night).
// The database function runs as the service role, so the form needs no login and anon still executes nothing.

import { supabaseService } from "@/lib/supabase/service";
import { toResult } from "@/lib/rpc";
import { formToRegistration } from "@/lib/register";

export interface RegisterState {
  number?: number;
  teamName?: string;
  error?: string;
}

export async function registerTeam(slug: string, _prev: RegisterState, form: FormData): Promise<RegisterState> {
  // A hidden field people never fill in; bots that fill every field are dropped quietly.
  if (String(form.get("website") ?? "") !== "") return { error: "Registration failed. Please try again." };
  try {
    const { data, error } = await supabaseService().rpc("register_team", { p_slug: slug, p_form: formToRegistration(form) });
    const r = toResult(data, error);
    if (r.ok) return { number: Number(r.data?.number), teamName: String(r.data?.team_name ?? "") };
    return { error: r.message ?? "Registration failed. Please try again." };
  } catch {
    return { error: "Registration is not available right now. Please try again in a minute." };
  }
}
