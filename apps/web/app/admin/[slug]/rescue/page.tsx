import type { Metadata } from "next";
import Link from "next/link";
import { currentViewer } from "@/lib/auth/viewer";
import { loadAdminEvent } from "@/lib/admin/event";
import { MAX_PAIRS_BYTES, PAIR_COLUMNS, pairViews, type PairTeam } from "@/lib/admin/rescue-pairs";
import { supabaseServer } from "@/lib/supabase/server";
import { clock } from "@/lib/format";
import { Badge, Notice, Panel, Table, Td, inputClass } from "@/components/ui/ui";
import { ActionButton, ActionForm } from "@/components/ui/action";
import { addPair, clearPairs, removePair, uploadPairs } from "./actions";

export const metadata: Metadata = { title: "Rescue pairs" };

// Rescue pairs (Round 2): which team gets which team's company to rescue. Organisers fix any pairs they want before
// the crisis, one at a time or from a spreadsheet; at the crisis the lottery pairs every team left over (never with
// its own company), and the pairs are published in the lottery record. After the crisis the page shows who rescues
// whom and links each pair's private chat.
export default async function RescuePairsPage({ params }: PageProps<"/admin/[slug]/rescue">) {
  const { slug } = await params;
  const [viewer, event] = await Promise.all([currentViewer(), loadAdminEvent(slug)]);
  const organiser = viewer!.role === "ORGANISER";
  const sb = await supabaseServer();
  const [ev, teams, plan, companies] = await Promise.all([
    sb.from("events").select("crisis_applied_at, rescue_fixed").eq("id", event.id).single<{ crisis_applied_at: string | null; rescue_fixed: { rescuer: string; founder: string }[] }>(),
    sb.from("teams").select("id, code, name, status").eq("event_id", event.id).order("code").limit(2000),
    sb.from("rescue_plan").select("rescuer_team_id, founder_team_id").eq("event_id", event.id).limit(2000),
    sb.from("companies").select("id, ticker, founder_team_id, rescuer_team_id").eq("event_id", event.id).limit(2000),
  ]);
  for (const r of [ev, teams, plan, companies]) if (r.error) throw new Error(`Could not read the rescue pairs: ${r.error.message}`);
  const allTeams = (teams.data ?? []) as PairTeam[];
  const playing = allTeams.filter((t) => t.status === "ACTIVE");
  const crisisAt = ev.data!.crisis_applied_at;

  if (crisisAt) {
    const fixed = new Set((ev.data!.rescue_fixed ?? []).map((p) => p.rescuer));
    const rows = (companies.data ?? []).filter((c) => c.rescuer_team_id);
    const tickers = new Map(rows.map((c) => [c.founder_team_id, { id: c.id as string, ticker: (c.ticker as string | null) ?? "—" }]));
    const views = pairViews(allTeams, rows.map((c) => ({ rescuer_team_id: c.rescuer_team_id!, founder_team_id: c.founder_team_id })), (code) => fixed.has(code));
    return (
      <Panel title="Who rescues whom" actions={<Badge tone="slate">Fixed at the crisis, {clock(crisisAt)}</Badge>}>
        <p className="mb-3 text-sm text-slate-600">
          {fixed.size} pairs were set by organisers; the lottery drew the other {Math.max(0, views.length - fixed.size)}. Open a pair&apos;s chat to read it.
        </p>
        <Table head={["Rescuing team", "Rescues the company of", "Company", "Set by", ""]} empty="No company has a rescuer." label="Rescue pairs">
          {views.map((v) => {
            const company = tickers.get(v.founder.id);
            return (
              <tr key={v.rescuer.id}>
                <Td mono>{v.rescuer.code}</Td>
                <Td mono>{v.founder.code}</Td>
                <Td mono>{company?.ticker ?? "—"}</Td>
                <Td>{v.fixed ? <Badge tone="violet">Organiser</Badge> : <Badge>Lottery</Badge>}</Td>
                <Td>
                  {company ? (
                    <Link href={`/admin/${slug}/tickets?chat=${company.id}`} className="underline">
                      Chat
                    </Link>
                  ) : null}
                </Td>
              </tr>
            );
          })}
        </Table>
      </Panel>
    );
  }

  const planned = (plan.data ?? []) as { rescuer_team_id: string; founder_team_id: string }[];
  const views = pairViews(allTeams, planned, () => true);
  const left = playing.length - views.filter((v) => v.rescuer.status === "ACTIVE" && v.founder.status === "ACTIVE").length;
  const notPlaying = views.filter((v) => v.rescuer.status !== "ACTIVE" || v.founder.status !== "ACTIVE");

  return (
    <div className="space-y-6">
      {!organiser ? <Notice>The fairness officer can read the pairs here; only organisers set them.</Notice> : null}
      <Panel title="Rescue pairs" actions={<Badge tone="green">Can be changed until the crisis</Badge>}>
        <p className="text-sm text-slate-600">
          At the crisis every team gets another team&apos;s company to rescue. Fix the pairs you want here; the lottery pairs every team left over, never with its own
          company. {views.length} pairs set · {Math.max(0, left)} of the {playing.length} teams playing are left to the lottery.
        </p>
        {notPlaying.length > 0 ? (
          <div className="mt-3">
            <Notice tone="amber">
              {notPlaying.length} pair{notPlaying.length === 1 ? "" : "s"} name a team that is not playing ({notPlaying.map((v) => `${v.rescuer.code}→${v.founder.code}`).join(", ")}). They
              are ignored at the crisis.
            </Notice>
          </div>
        ) : null}
        <Table head={["Rescuing team", "Rescues the company of", ""]} empty="No pairs set: the lottery pairs every team." className="mt-4" label="Pairs set by organisers">
          {views.map((v) => (
            <tr key={v.rescuer.id}>
              <Td mono>{v.rescuer.code}</Td>
              <Td mono>{v.founder.code}</Td>
              <Td>{organiser ? <ActionButton action={removePair.bind(null, event.id, v.rescuer.code)}>Remove</ActionButton> : null}</Td>
            </tr>
          ))}
        </Table>
        {organiser && views.length > 0 ? (
          <div className="mt-3">
            <ActionButton action={clearPairs.bind(null, event.id)} confirm="Click again to remove every pair">
              Remove every pair
            </ActionButton>
          </div>
        ) : null}
      </Panel>

      {organiser ? (
        <div className="grid gap-6 lg:grid-cols-2">
          <Panel title="Add one pair">
            <ActionForm action={addPair.bind(null, event.id)} submit="Save pair" className="grid gap-3">
              <TeamSelect name="rescuer" label="Rescuing team" teams={playing} />
              <TeamSelect name="founder" label="Rescues the company of" teams={playing} />
            </ActionForm>
            <p className="mt-2 text-xs text-slate-500">A team already in a pair gets the new pair instead.</p>
          </Panel>
          <Panel title="Upload every pair at once">
            <p className="text-sm">
              <span className="font-medium text-slate-700">Columns: </span>
              <code className="font-mono">{PAIR_COLUMNS.join(", ")}</code>
              <span className="text-slate-500"> (team codes such as T014; a header row is fine; a team with column B empty is left to the lottery)</span>
            </p>
            <p className="mt-2 text-sm">
              <a href={`/admin/${slug}/rescue/template`} className="underline">
                Download the sheet with every team playing
              </a>
              , fill column B in Excel and upload it. The upload replaces every pair set so far.
            </p>
            <ActionForm action={uploadPairs.bind(null, event.id)} submit="Upload pairs" className="mt-3" maxFileBytes={MAX_PAIRS_BYTES} resetOnSuccess>
              <label className="block max-w-md">
                <span className="text-xs font-medium text-slate-600">Excel (.xlsx) or CSV file (up to {MAX_PAIRS_BYTES / 1024} KB)</span>
                <input
                  name="file"
                  type="file"
                  accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                  required
                  className={inputClass}
                />
              </label>
            </ActionForm>
          </Panel>
        </div>
      ) : null}
    </div>
  );
}

function TeamSelect({ name, label, teams }: { name: string; label: string; teams: PairTeam[] }) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-slate-600">{label}</span>
      <select name={name} required defaultValue="" className={inputClass}>
        <option value="" disabled>
          Choose a team
        </option>
        {teams.map((t) => (
          <option key={t.id} value={t.code}>
            {t.code} · {t.name}
          </option>
        ))}
      </select>
    </label>
  );
}
