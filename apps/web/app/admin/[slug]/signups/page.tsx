import type { Metadata } from "next";
import { headers } from "next/headers";
import { currentViewer } from "@/lib/auth/viewer";
import { loadAdminEvent } from "@/lib/admin/event";
import { supabaseServer } from "@/lib/supabase/server";
import { Badge, Notice, Panel, Stat, Table, Td } from "@/components/ui/ui";
import { ActionButton } from "@/components/ui/action";
import { setSignupsOpen } from "../teams/actions";

export const metadata: Metadata = { title: "Sign-ups" };

interface SignupRow {
  number: number;
  team_name: string;
  contact_email: string | null;
  contact_phone: string | null;
  members: { full_name: string; roll_number: string | null }[];
  source: "ONLINE" | "DESK";
  team_id: string | null;
  created_at: string;
}

const code = (n: number) => `PR-${String(n).padStart(4, "0")}`;

// Online sign-ups: who said they would come. Nobody is committed by signing up, so this is a projection for planning
// (rooms, food, problem cards); only teams confirmed at the registration desk play.
export default async function SignupsPage({ params }: PageProps<"/admin/[slug]/signups">) {
  const { slug } = await params;
  const [viewer, event] = await Promise.all([currentViewer(), loadAdminEvent(slug)]);
  const organiser = viewer!.role === "ORGANISER";
  const sb = await supabaseServer();
  const [list, ev] = await Promise.all([
    sb
      .from("signups")
      .select("number, team_name, contact_email, contact_phone, members, source, team_id, created_at")
      .eq("event_id", event.id)
      .order("number")
      .limit(5000),
    sb.from("events").select("signups_open, is_rehearsal").eq("id", event.id).single(),
  ]);
  if (list.error || ev.error) {
    return <Notice tone="amber">The database does not have sign-ups yet: load the latest update (<code>npx supabase db push</code>), then reload this page.</Notice>;
  }
  const rows = (list.data ?? []) as SignupRow[];
  const online = rows.filter((r) => r.source === "ONLINE");
  const students = online.reduce((n, r) => n + r.members.length, 0);
  const confirmedOnline = online.filter((r) => r.team_id).length;
  const walkIns = rows.filter((r) => r.source === "DESK" && r.team_id).length;
  const open = ev.data.signups_open && !event.drawn_at;
  const h = await headers();
  const link = `${h.get("x-forwarded-proto") ?? "https"}://${h.get("host") ?? "your-site"}/register/${slug}`;

  return (
    <div className="space-y-6">
      <Panel
        title="Online sign-ups"
        actions={
          organiser && !event.drawn_at ? (
            <ActionButton action={setSignupsOpen.bind(null, event.id, !ev.data.signups_open)} confirm={ev.data.signups_open ? "Click again to close sign-ups" : undefined}>
              {ev.data.signups_open ? "Close sign-ups" : "Open sign-ups"}
            </ActionButton>
          ) : null
        }
      >
        <div className="grid gap-3 sm:grid-cols-4">
          <Stat label="Teams signed up" value={online.length} hint="online, not committed" />
          <Stat label="Students signed up" value={students} hint={online.length ? `${(students / online.length).toFixed(1)} per team` : undefined} />
          <Stat label="Turned up so far" value={confirmedOnline} hint={online.length ? `${Math.round((100 * confirmedOnline) / online.length)}% of sign-ups` : undefined} />
          <Stat label="Walk-ins confirmed" value={walkIns} hint="registered at the desk without signing up" />
        </div>
        <div className="mt-4 space-y-2 text-sm">
          <p>
            {open ? <Badge tone="green">Open</Badge> : <Badge tone="slate">Closed</Badge>} Share this link:{" "}
            <a href={`/register/${slug}`} className="font-mono break-all underline" target="_blank" rel="noreferrer">
              {link}
            </a>
          </p>
          {ev.data.is_rehearsal ? <Notice tone="amber">This is a rehearsal event: the public page only takes sign-ups for the live event.</Notice> : null}
        </div>
      </Panel>
      <Panel title={`All sign-ups (${rows.length})`}>
        <Table head={["No.", "Team", "Members", "Contact", "Signed up", "Status"]} empty="No sign-ups yet.">
          {rows.map((r) => (
            <tr key={r.number}>
              <Td mono>{code(r.number)}</Td>
              <Td>{r.team_name}</Td>
              <Td>
                {r.members.map((m) => (m.roll_number ? `${m.full_name} (${m.roll_number})` : m.full_name)).join(", ")}
              </Td>
              <Td>
                <span className="block">{r.contact_email ?? "—"}</span>
                <span className="block text-xs text-slate-500">{r.contact_phone ?? ""}</span>
              </Td>
              <Td mono>{new Date(r.created_at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "short", timeStyle: "short" })}</Td>
              <Td>{r.team_id ? <Badge tone="green">Confirmed</Badge> : r.source === "DESK" ? <Badge tone="slate">Desk</Badge> : <Badge tone="blue">Signed up</Badge>}</Td>
            </tr>
          ))}
        </Table>
      </Panel>
    </div>
  );
}
