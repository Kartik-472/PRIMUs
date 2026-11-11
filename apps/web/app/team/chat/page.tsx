import type { Metadata } from "next";
import Link from "next/link";
import { loadTeamContext } from "@/lib/team/context";
import { loadDeadline } from "@/lib/team/round-data";
import { supabaseServer } from "@/lib/supabase/server";
import { CHAT_HISTORY, MESSAGE_COLUMNS, TICKET_COLUMNS, TICKET_MAX_CHARS, chatState, mergeMessages, type ChatMessage, type TicketRow } from "@/lib/chat/chat";
import { clock, dateTime } from "@/lib/format";
import { Badge, Notice, Panel, inputClass } from "@/components/ui/ui";
import { ActionForm } from "@/components/ui/action";
import { Countdown } from "@/components/ui/countdown";
import { RefreshAt } from "@/lib/live/refresh-at";
import { ChatBox } from "@/components/chat/chat-box";
import { TopicRefresh } from "@/components/chat/topic-refresh";
import { raiseTicket, sendChat } from "./actions";

export const metadata: Metadata = { title: "Rescue chats" };

// Round 2's private chats: one with the founders of the company this team rescues (to get information), one with the
// team that rescues this team's company (to give it). Only the two teams of a chat and the organisers read it. Below,
// the team raises a ticket to the organisers when something goes wrong, about one of the chats or anything else.
export default async function ChatPage() {
  const { team, event, status, built, rescued } = await loadTeamContext();
  const lock = await loadDeadline(event.id, "SOLUTION_LOCK");
  const state = chatState({
    crisisApplied: !!event.crisis_applied_at,
    phase: status.phase,
    paused: status.paused,
    solutionLock: lock,
    nowMs: new Date(status.server_time).getTime(),
  });
  const [draws, tickets] = await Promise.all([loadDraws(event.id), loadTickets(team.id)]);

  if (state === "NOT_YET" || (!rescued && !built)) {
    return (
      <div className="space-y-6">
        <Panel title="Rescue chats">
          <Notice>
            The chats open at the crisis. You get two private chats: one to ask the founders of the company you rescue, and one to help the team that rescues your
            company. Only the two teams of a chat and the organisers can read it.
          </Notice>
        </Panel>
        <TicketsPanel teamId={team.id} tickets={tickets} about={[]} />
      </div>
    );
  }

  const [asking, helping] = await Promise.all([rescued ? loadMessages(rescued.id) : [], built ? loadMessages(built.id) : []]);
  const rescuerOfMine = draws.find((d) => d.rescues === team.code)?.team ?? "—";
  const send = state === "OPEN" ? sendChat : undefined;
  const closedNote = status.paused && state === "CLOSED" ? "The night is paused: the chat reopens when it resumes." : "The chats are closed; they stay readable.";
  const about = [
    ...(rescued ? [{ id: rescued.id, label: `My chat with ${rescued.ticker ?? "the company I rescue"}'s founders` }] : []),
    ...(built ? [{ id: built.id, label: `My chat with the team rescuing ${built.ticker ?? "my company"} (${rescuerOfMine})` }] : []),
  ];

  return (
    <div className="space-y-6">
      <RefreshAt at={state === "OPEN" ? lock : null} />
      {state === "OPEN" && lock ? (
        <p className="text-sm text-slate-600">
          The chats close with the solution form at {clock(lock)} · <Countdown to={lock} className="font-semibold text-slate-900" />
        </p>
      ) : null}
      <div className="grid gap-6 lg:grid-cols-2">
        {rescued ? (
          <Panel title={`Get information: ${rescued.ticker ?? "the company you rescue"}'s founders`}>
            <p className="mb-3 text-sm text-slate-600">
              You rescue <span className="font-mono font-semibold">{rescued.ticker}</span> {rescued.name}. Ask its founders what you need for{" "}
              <Link href="/team/rescue" className="underline">
                your crisis solution
              </Link>
              .
            </p>
            <ChatBox
              companyId={rescued.id}
              initial={asking}
              sides={{ rescuer: team.code, founder: draws.find((d) => d.team === team.code)?.rescues ?? "Founders" }}
              reader="RESCUER"
              send={send}
              closedNote={closedNote}
              label={`Chat with ${rescued.ticker ?? "the company"}'s founders`}
            />
          </Panel>
        ) : null}
        {built ? (
          <Panel title={`Give information: the team rescuing ${built.ticker ?? "your company"}`}>
            <p className="mb-3 text-sm text-slate-600">
              Team <span className="font-mono font-semibold">{rescuerOfMine}</span> rescues your company. Answer its questions here.
            </p>
            <ChatBox
              companyId={built.id}
              initial={helping}
              sides={{ rescuer: rescuerOfMine, founder: team.code }}
              reader="FOUNDER"
              send={send}
              closedNote={closedNote}
              label={`Chat with team ${rescuerOfMine}, rescuing ${built.ticker ?? "your company"}`}
            />
          </Panel>
        ) : null}
      </div>
      <TicketsPanel teamId={team.id} tickets={tickets} about={about} />
    </div>
  );
}

function TicketsPanel({ teamId, tickets, about }: { teamId: string; tickets: TicketRow[]; about: { id: string; label: string }[] }) {
  return (
    <Panel title="Raise a ticket">
      <TopicRefresh topic={`team:${teamId}`} />
      <p className="mb-3 text-sm text-slate-600">
        A problem with a chat or anything else tonight? Tell the organisers. When the ticket is about a chat, they read that chat to sort it out.
      </p>
      <ActionForm action={raiseTicket} submit="Send ticket" resetOnSuccess>
        <div className="space-y-3">
          <label className="block">
            <span className="text-xs font-medium text-slate-600">About</span>
            <select name="about" defaultValue={about[0]?.id ?? ""} className={inputClass}>
              {about.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.label}
                </option>
              ))}
              <option value="">Something else</option>
            </select>
          </label>
          <label className="block">
            <span className="text-xs font-medium text-slate-600">What is wrong (up to {TICKET_MAX_CHARS} characters)</span>
            <textarea name="body" rows={3} required maxLength={TICKET_MAX_CHARS} className={inputClass} />
          </label>
        </div>
      </ActionForm>
      {tickets.length > 0 ? (
        <ul className="mt-5 space-y-3" aria-label="Your tickets">
          {tickets.map((t) => (
            <li key={t.id} className="rounded-md p-3 ring-1 ring-inset ring-slate-200" data-testid="ticket">
              <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                <span className="font-semibold text-slate-700">Ticket #{t.number}</span>
                <Badge tone={t.status === "OPEN" ? "amber" : "green"}>{t.status === "OPEN" ? "Open" : "Resolved"}</Badge>
                <time dateTime={t.created_at} title={`${dateTime(t.created_at)} IST`} className="font-mono tabular-nums">
                  {clock(t.created_at, true)}
                </time>
              </div>
              <p className="mt-1 whitespace-pre-wrap text-sm text-slate-900">{t.body}</p>
              {t.reply ? (
                <p className="mt-2 whitespace-pre-wrap border-l-2 border-sky-300 pl-3 text-sm text-slate-800">
                  <span className="font-semibold">Organisers: </span>
                  {t.reply}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </Panel>
  );
}

async function loadMessages(companyId: string): Promise<ChatMessage[]> {
  const sb = await supabaseServer();
  const { data } = await sb.from("chat_messages").select(MESSAGE_COLUMNS).eq("company_id", companyId).order("created_at", { ascending: false }).limit(CHAT_HISTORY);
  return mergeMessages((data ?? []) as ChatMessage[]);
}

async function loadTickets(teamId: string): Promise<TicketRow[]> {
  const sb = await supabaseServer();
  const { data } = await sb.from("tickets").select(TICKET_COLUMNS).eq("team_id", teamId).order("created_at", { ascending: false }).limit(50);
  return (data ?? []) as TicketRow[];
}

/** Who rescues whom, by team code, from the published lottery record (teams read only their own team row). */
async function loadDraws(eventId: string): Promise<{ team: string; rescues: string }[]> {
  const sb = await supabaseServer();
  const { data } = await sb.rpc("lottery_record", { p_event: eventId });
  return (data as { record?: { draws: { team: string; rescues: string }[] } } | null)?.record?.draws ?? [];
}
