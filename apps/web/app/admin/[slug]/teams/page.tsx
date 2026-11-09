import type { Metadata } from "next";
import Link from "next/link";
import { currentViewer } from "@/lib/auth/viewer";
import { loadAdminEvent } from "@/lib/admin/event";
import { supabaseServer } from "@/lib/supabase/server";
import { Notice, Panel, Stat } from "@/components/ui/ui";
import { Desk, type ConfirmedTeam } from "./desk";
import type { DeskMember } from "./actions";

export const metadata: Metadata = { title: "Registration desk" };

const code = (n: number) => `PR-${String(n).padStart(4, "0")}`;

// The registration desk (offline registration on the night). Only teams confirmed here play: each gets a login card
// and is shown in the team portal, on the projector and in the results; every other card stays unused and hidden.
export default async function RegistrationDeskPage({ params }: PageProps<"/admin/[slug]/teams">) {
  const { slug } = await params;
  const [viewer, event] = await Promise.all([currentViewer(), loadAdminEvent(slug)]);
  const organiser = viewer!.role === "ORGANISER";
  const sb = await supabaseServer();
  const [signups, teams] = await Promise.all([
    sb.from("signups").select("id, number, team_name, members, team_id").eq("event_id", event.id).not("team_id", "is", null).limit(1000),
    sb.from("teams").select("id, code, status").eq("event_id", event.id).limit(1000),
  ]);
  if (signups.error) {
    return (
      <Notice tone="amber">
        The database does not have the registration desk yet: load the latest update (<code>npx supabase db push</code>), then reload this page.
      </Notice>
    );
  }
  const cards = new Map((teams.data ?? []).map((t) => [t.id as string, t as { id: string; code: string; status: string }]));
  const confirmed: ConfirmedTeam[] = (signups.data ?? [])
    .map((s) => ({
      signupId: s.id as string,
      number: code(s.number as number),
      code: cards.get(s.team_id as string)?.code ?? "?",
      name: s.team_name as string,
      members: (s.members ?? []) as DeskMember[],
    }))
    .sort((a, b) => a.code.localeCompare(b.code));
  const linked = new Set((signups.data ?? []).map((s) => s.team_id as string));
  const free = (teams.data ?? []).filter((t) => t.status !== "ACTIVE" && !linked.has(t.id as string)).length;
  const open = !event.drawn_at;

  return (
    <div className="space-y-6">
      <Panel title="Registration desk">
        <div className="grid gap-3 sm:grid-cols-3">
          <Stat label="Confirmed teams" value={confirmed.length} hint="play tonight and are shown everywhere" />
          <Stat label="Login cards left" value={free} hint="the next confirmed team gets the lowest free card" />
          <Stat label="Problem cards needed" value={Math.ceil(confirmed.length / 3)} hint="one per three confirmed teams" />
        </div>
        <div className="mt-4">
          {open ? (
            <Notice tone="blue">
              Ask each team for its registration number (from the <Link href={`/admin/${slug}/signups`} className="underline">online sign-ups</Link>), check
              the team name and members, correct them, and confirm. The page then tells you which login card to hand over. A team without a number:
              use <b>New team at the desk</b>. Only confirmed teams play and are shown in the terminal; you can edit or remove them until the problem
              cards are dealt.
            </Notice>
          ) : (
            <Notice>The problem cards have been dealt: the {confirmed.length} confirmed teams are fixed for tonight.</Notice>
          )}
        </div>
      </Panel>
      <Desk eventId={event.id} confirmed={confirmed} editable={organiser && open} />
    </div>
  );
}
