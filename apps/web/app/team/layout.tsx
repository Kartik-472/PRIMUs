import type { Metadata } from "next";
import Link from "next/link";
import { PHASE_LABELS } from "@msim/engine";
import { loadTeamContext } from "@/lib/team/context";
import { supabaseServer } from "@/lib/supabase/server";
import { clock, money } from "@/lib/format";
import { ClockProvider } from "@/lib/live/clock";
import { EventChannel } from "@/lib/live/channel";
import { Heartbeat } from "@/lib/live/heartbeat";
import { FeedbackBar, FeedbackProvider } from "@/lib/live/feedback";
import { SignOutButton } from "@/components/sign-out-button";
import { Badge } from "@/components/ui/ui";
import { Countdown, ServerClock } from "@/components/ui/countdown";
import { RealtimeDot } from "@/components/ui/realtime-dot";
import { TeamNav, TeamTabBar } from "./nav";
import { StageStepper } from "./stages";
import { ActionBar } from "./action-bar";
import { Alerts, SoundToggle } from "./alerts";
import { loadPlanFacts } from "@/lib/team/home-data";
import { homePlan } from "@/lib/team/home";
import { alertTasks, changeText, nextAction, teamTimingChanges } from "@/lib/team/alerts";
import { PhaseEnd } from "./phase-end";
import { MarketStrip } from "./market-strip";
import { BULLETIN_KIND_LABELS, type BulletinKind } from "@/lib/admin/content-bulletins";

export const metadata: Metadata = { title: { template: "%s · Team", default: "Team" } };

// Every team screen (laptop or phone): the team, where the night is (phase and countdown, trading, the open round),
// its cash, the companies it built and rescues, the "Do this now" bar, the alerts, the latest news and the sections.
// The event's realtime channel refreshes the page on every broadcast, and the heartbeat tells the control panel the
// screen is connected.
export default async function TeamLayout({ children }: LayoutProps<"/team">) {
  const ctx = await loadTeamContext();
  const { team, event, status, built, rescued } = ctx;
  // The bar and the alerts are guidance: if the plan cannot be read (say, the database is older than the app), every
  // page still works, without them.
  const plan = await loadPlanFacts(ctx).then(homePlan, (err: unknown) => {
    console.error("team layout: no plan for the bar and alerts:", err);
    return null;
  });
  // Only a registered (ACTIVE) team plays. Any other team sees a notice instead of its pages: before the draw, that it
  // is not registered yet (an organiser registers it at the desk); once the problem cards are dealt, that it is out of
  // the night. It does not see the market, the nav or anything about other teams.
  const notPlaying = team.status !== "ACTIVE";
  const outOfTheNight = notPlaying && !!event.drawn_at;
  const next = plan && !notPlaying ? nextAction(plan) : null;
  // The last timing change stays on every screen for 20 minutes, so a team that was away (or reconnects) still sees
  // which deadlines moved; the times themselves are always the server's.
  const recent =
    status.timing_change && status.timing_changed_at && Date.parse(status.server_time) - Date.parse(status.timing_changed_at) < 20 * 60_000
      ? teamTimingChanges(status.timing_change.changes)
      : [];
  const sb = await supabaseServer();
  const { data: latest } = await sb
    .from("bulletins")
    .select("id, kind, title, published_at")
    .eq("event_id", event.id)
    .not("published_at", "is", null)
    .order("published_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ id: string; kind: string; title: string; published_at: string }>();
  return (
    <ClockProvider serverTime={status.server_time} pausedAt={status.paused ? status.paused_at : null}>
      <EventChannel eventId={event.id} refreshSpreadMs={1500}>
        <FeedbackProvider>
        <Heartbeat eventId={event.id} area="team" />
        <div className="term min-h-screen">
          <header className="border-b border-slate-200 bg-black">
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b border-[var(--term-amber-dim)] px-4 py-1.5">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <span className="bg-[var(--term-amber)] px-1.5 text-xs font-black tracking-widest text-black">PRIMUS</span>
                <h1 className="text-lg font-bold text-[var(--term-amber)]">
                  {team.code}
                  <span className="term-cursor ml-0.5 text-[var(--term-amber)]" aria-hidden>
                    ▮
                  </span>
                </h1>
                <span className="hidden truncate text-sm text-slate-600 uppercase sm:inline">{team.name}</span>
                {event.is_rehearsal ? <Badge tone="violet">Rehearsal ×{event.clock_speed}</Badge> : null}
              </div>
              <div className="flex items-center gap-3 text-sm">
                <RealtimeDot />
                <SoundToggle />
                <ServerClock className="font-semibold text-[var(--term-amber)]" />
                <span className="text-xs text-slate-500">IST</span>
                <SignOutButton />
              </div>
            </div>
            <dl className="grid grid-cols-2 gap-px bg-slate-200 text-sm sm:grid-cols-4">
              <div className="bg-black px-4 py-1.5">
                <dt className="text-[11px] tracking-wider text-[var(--term-amber-dim)] uppercase">Phase</dt>
                <dd className="font-semibold text-slate-800" data-testid="team-phase">
                  {PHASE_LABELS[status.phase]}
                  <PhaseEnd endsAt={status.phase_ends_at} phase={status.phase} gate={status.gate} next={status.next_phase} ended={!!status.ended_at} />
                </dd>
              </div>
              <div className="bg-black px-4 py-1.5">
                <dt className="text-[11px] tracking-wider text-[var(--term-amber-dim)] uppercase">Trading</dt>
                <dd>
                  <Badge tone={status.trading === "OPEN" ? "green" : status.trading === "PAUSED" ? "amber" : "slate"}>{status.trading}</Badge>
                  {status.open_round ? (
                    <span className="ml-1 text-slate-600">
                      R{status.open_round.number} · <Countdown to={status.open_round.closes_at} passed="clearing" className="text-[var(--term-amber)]" />
                    </span>
                  ) : status.next_round ? (
                    <span className="ml-1 text-slate-600">
                      R{status.next_round.number} at {clock(status.next_round.opens_at)}
                    </span>
                  ) : null}
                </dd>
              </div>
              <div className="bg-black px-4 py-1.5">
                <dt className="text-[11px] tracking-wider text-[var(--term-amber-dim)] uppercase">Cash</dt>
                <dd className="font-mono font-semibold text-[var(--term-green)] tabular-nums" data-testid="team-cash">
                  {money(team.cash)}
                </dd>
              </div>
              <div className="bg-black px-4 py-1.5">
                <dt className="text-[11px] tracking-wider text-[var(--term-amber-dim)] uppercase">Built · rescued</dt>
                <dd className="font-mono text-[var(--term-cyan)]" data-testid="team-companies">
                  {built?.ticker ?? "—"} · {rescued?.ticker ?? "—"}
                </dd>
              </div>
            </dl>
            {notPlaying ? null : (
              <>
                <StageStepper phase={status.phase} />
                <MarketStrip eventId={event.id} />
                <TeamNav phase={status.phase} />
              </>
            )}
          </header>
          <ActionBar task={next && next.href ? { title: next.title, href: next.href, linkLabel: next.linkLabel, due: next.due } : null} />
          <Alerts tasks={plan && !notPlaying ? alertTasks(plan) : []} />
          {status.paused ? (
            <p className="bg-amber-100 px-4 py-2 text-center text-sm font-medium text-amber-900">
              The event is paused. Deadlines move later by the length of the pause.
            </p>
          ) : null}
          {recent.length > 0 ? (
            <div
              className={`px-4 py-2 text-center text-sm font-medium ${recent.some((c) => c.earlier) ? "bg-amber-100 text-amber-950" : "bg-sky-50 text-sky-950"}`}
              data-testid="timing-banner"
              role="status"
            >
              <span className="font-semibold">{recent.some((c) => c.earlier) ? "Deadline moved earlier" : "Timing changed"}</span>
              <span className="text-xs font-normal"> at {clock(status.timing_changed_at)}</span>:{" "}
              {recent.slice(0, 4).map(changeText).join(" · ")}
              {recent.length > 4 ? ` · +${recent.length - 4} more` : ""}
            </div>
          ) : null}
          {status.ended_at ? (
            <p className="bg-emerald-100 px-4 py-2 text-center text-sm font-medium text-emerald-900">The night is over. Thank you for playing PRIMUS.</p>
          ) : null}
          {notPlaying ? (
            <p className="bg-slate-800 px-4 py-2 text-center text-sm font-medium text-white" data-testid="team-not-playing">
              {outOfTheNight
                ? "Your team is not playing tonight: the problem cards were dealt to the registered teams only."
                : team.status === "WITHDRAWN"
                  ? "Your team has been withdrawn from tonight's game. If this is a mistake, go to the registration desk before the problem cards are dealt."
                  : "Your team is not registered yet. Go to the registration desk: once an organiser registers your team, this page opens."}
            </p>
          ) : null}
          {team.disqualified ? (
            <p className="bg-red-100 px-4 py-2 text-center text-sm font-medium text-red-900">
              Your team has been disqualified by the fairness officer{team.disqualified_reason ? `: ${team.disqualified_reason}` : "."}
            </p>
          ) : null}
          {latest ? (
            <Link
              href="/team/bulletins"
              className="mx-auto block max-w-7xl px-4 pt-3 text-sm [overflow-wrap:anywhere]"
              data-testid="latest-bulletin"
            >
              <span className="bg-[var(--term-amber)] px-2 py-0.5 text-xs font-bold text-black uppercase">{BULLETIN_KIND_LABELS[latest.kind as BulletinKind] ?? latest.kind}</span>{" "}
              <span className="font-mono text-xs text-slate-500">{clock(latest.published_at)}</span>{" "}
              <span className="font-semibold text-slate-900 underline-offset-2 hover:underline">{latest.title}</span>
            </Link>
          ) : null}
          <FeedbackBar className="mx-auto max-w-7xl px-4 pt-3" />
          {/* On a phone the tab bar covers the bottom of the screen: the page ends above it. */}
          <main className="mx-auto max-w-7xl px-4 pt-4 pb-24 sm:pb-4">
            {notPlaying ? (
              <p className="rounded-lg bg-white p-6 text-center text-slate-700 shadow-sm" data-testid="team-locked">
                {outOfTheNight
                  ? "Thank you for coming. You can follow the night on the big screen."
                  : "Your team's pages open as soon as your team is registered. This page updates by itself."}
              </p>
            ) : (
              children
            )}
          </main>
          {notPlaying ? null : <TeamTabBar phase={status.phase} />}
        </div>
      </FeedbackProvider>
      </EventChannel>
    </ClockProvider>
  );
}
