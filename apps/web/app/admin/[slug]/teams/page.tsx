import type { Metadata } from "next";
import { currentViewer } from "@/lib/auth/viewer";
import { loadAdminEvent } from "@/lib/admin/event";
import { supabaseServer } from "@/lib/supabase/server";
import { Notice, Panel, Stat } from "@/components/ui/ui";
import { RegistrationChecklist, type RegistrationRow } from "./checklist";

export const metadata: Metadata = { title: "Registration" };

type Status = "ACTIVE" | "BACKUP" | "WITHDRAWN";

// Registration: who plays tonight. Every team login starts unregistered; until the lottery draw an organiser ticks the
// teams that turned up and saves. Only registered teams can use their team pages, get a company at the draw and show
// up anywhere in the night (market, rescue, leaderboard, results); the rest see a "not registered" notice. Logged.
export default async function RegistrationPage({ params }: PageProps<"/admin/[slug]/teams">) {
  const { slug } = await params;
  const [viewer, event] = await Promise.all([currentViewer(), loadAdminEvent(slug)]);
  const organiser = viewer!.role === "ORGANISER";
  const sb = await supabaseServer();
  const [teams, members] = await Promise.all([
    sb.from("teams").select("id, code, name, status").eq("event_id", event.id).order("code").limit(1000),
    sb.from("members").select("team_id").eq("event_id", event.id).limit(5000),
  ]);
  if (teams.error) {
    return (
      <Notice tone="amber">
        The database does not have registration yet: load the latest update (<code>npx supabase db push</code> on the organiser laptop), then
        reload this page.
      </Notice>
    );
  }
  const raw = (teams.data ?? []) as { id: string; code: string; name: string; status: Status }[];
  const count = new Map<string, number>();
  for (const m of members.data ?? []) count.set(m.team_id, (count.get(m.team_id) ?? 0) + 1);
  const rows: RegistrationRow[] = raw.map((t) => ({
    code: t.code,
    name: t.name,
    members: count.get(t.id) ?? 0,
    registered: t.status === "ACTIVE",
    withdrawn: t.status === "WITHDRAWN",
  }));
  const registered = rows.filter((r) => r.registered).length;
  const open = !event.drawn_at;

  return (
    <div className="space-y-6">
      <Panel title="Registration">
        <div className="grid gap-3 sm:grid-cols-3">
          <Stat label="Registered" value={registered} hint="play tonight and are visible" />
          <Stat label="Not registered" value={rows.length - registered} hint="cannot play and are hidden" />
          <Stat label="Problem cards needed" value={Math.ceil(registered / 3)} hint="one per three registered teams" />
        </div>
        <div className="mt-4">
          {open ? (
            <Notice tone="blue">
              Tick every team that has checked in, then press <b>Save registration</b>. Only ticked teams can use their team pages, and only they get
              a company, a problem card and a place in the rescue circle at the draw; the others are hidden from the whole night (market, leaderboard,
              results). You can change the list as often as you like until the problem cards are dealt; after that it is fixed.
            </Notice>
          ) : (
            <Notice>The problem cards have been dealt: the {registered} registered teams are fixed for tonight.</Notice>
          )}
        </div>
      </Panel>
      <Panel title={`Teams (${rows.length})`}>
        <RegistrationChecklist eventId={event.id} rows={rows} editable={organiser && open} />
      </Panel>
    </div>
  );
}
