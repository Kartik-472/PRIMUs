// GET /admin/<slug>/rescue/template — a CSV of every team playing with the pairs set so far, to fill in Excel and
// upload on the Rescue pairs page. Staff only (the admin layout does not run for a route handler; RLS also limits the
// pairs to staff).

import { getViewer } from "@/lib/auth/viewer";
import { pairsTemplate } from "@/lib/admin/rescue-pairs";
import { supabaseServer } from "@/lib/supabase/server";

function reply(status: number, error: string) {
  return Response.json({ error }, { status, headers: { "Cache-Control": "no-store" } });
}

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const sb = await supabaseServer();
  const viewer = await getViewer(sb);
  if (!viewer) return reply(401, "Sign in to download the sheet.");
  if (viewer.role !== "ORGANISER" && viewer.role !== "FAIRNESS") return reply(403, "Only staff can download the rescue pairs.");
  const { data: event } = await sb.from("events").select("id, slug").eq("slug", slug).maybeSingle<{ id: string; slug: string }>();
  if (!event) return reply(404, "No such event.");
  const [teams, plan] = await Promise.all([
    sb.from("teams").select("id, code, status").eq("event_id", event.id).limit(2000),
    sb.from("rescue_plan").select("rescuer_team_id, founder_team_id").eq("event_id", event.id).limit(2000),
  ]);
  if (teams.error || plan.error) return reply(500, "Could not read the teams.");
  const code = new Map((teams.data ?? []).map((t) => [t.id as string, t.code as string]));
  const set = new Map((plan.data ?? []).map((p) => [code.get(p.rescuer_team_id) ?? "", code.get(p.founder_team_id) ?? ""]));
  const playing = (teams.data ?? []).filter((t) => t.status === "ACTIVE").map((t) => t.code as string);
  return new Response(`﻿${pairsTemplate(playing, set)}`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${event.slug}-rescue-pairs.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
