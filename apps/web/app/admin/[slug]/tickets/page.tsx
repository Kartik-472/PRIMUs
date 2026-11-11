import type { Metadata } from "next";
import Link from "next/link";
import Form from "next/form";
import { loadAdminEvent } from "@/lib/admin/event";
import { supabaseServer } from "@/lib/supabase/server";
import { CHAT_HISTORY, MESSAGE_COLUMNS, TICKET_COLUMNS, TICKET_MAX_CHARS, mergeMessages, type ChatMessage, type TicketRow } from "@/lib/chat/chat";
import { clock, dateTime } from "@/lib/format";
import { Badge, Notice, Panel, buttonClass, inputClass } from "@/components/ui/ui";
import { ActionForm } from "@/components/ui/action";
import { ChatBox } from "@/components/chat/chat-box";
import { answerTicket } from "./actions";

export const metadata: Metadata = { title: "Tickets" };

interface CompanyRef {
  id: string;
  ticker: string | null;
  founder_team_id: string;
  rescuer_team_id: string | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const one = (v: string | string[] | undefined) => (typeof v === "string" && UUID.test(v) ? v : null);

// Tickets (Round 2): what teams raise about their rescue chats or anything else, open ones first. Each ticket opens
// the chat it is about (or both of the team's chats) beside it, so the organiser reads the conversation before
// replying. Any pair's chat can be opened from the list at the top. New tickets refresh the page (staff channel).
export default async function TicketsPage({ params, searchParams }: PageProps<"/admin/[slug]/tickets">) {
  const { slug } = await params;
  const sp = await searchParams;
  const event = await loadAdminEvent(slug);
  const sb = await supabaseServer();
  const [tickets, teams, companies] = await Promise.all([
    sb.from("tickets").select(TICKET_COLUMNS).eq("event_id", event.id).order("created_at", { ascending: false }).limit(500),
    sb.from("teams").select("id, code").eq("event_id", event.id).limit(2000),
    sb.from("companies").select("id, ticker, founder_team_id, rescuer_team_id").eq("event_id", event.id).limit(2000),
  ]);
  for (const r of [tickets, teams, companies]) if (r.error) throw new Error(`Could not read the tickets: ${r.error.message}`);
  const code = new Map((teams.data ?? []).map((t) => [t.id as string, t.code as string]));
  const all = (companies.data ?? []) as CompanyRef[];
  const byId = new Map(all.map((c) => [c.id, c]));
  const paired = all.filter((c) => c.rescuer_team_id).sort((a, b) => ((a.ticker ?? "") < (b.ticker ?? "") ? -1 : 1));
  const rows = (tickets.data ?? []) as TicketRow[];
  const showAll = sp.show === "all";
  const open = rows.filter((t) => t.status === "OPEN");
  const listed = showAll ? [...open, ...rows.filter((t) => t.status !== "OPEN")] : open;

  // What to read on the right: one chat (?chat=), or the chats of the team that raised a ticket (?ticket=).
  const ticket = rows.find((t) => t.id === one(sp.ticket)) ?? null;
  const chatIds = ticket
    ? ticket.company_id
      ? [ticket.company_id]
      : all.filter((c) => c.founder_team_id === ticket.team_id || c.rescuer_team_id === ticket.team_id).map((c) => c.id)
    : one(sp.chat)
      ? [one(sp.chat)!]
      : [];
  const chats = await Promise.all(
    chatIds
      .map((id) => byId.get(id))
      .filter((c): c is CompanyRef => !!c)
      .map(async (c) => {
        const { data } = await sb.from("chat_messages").select(MESSAGE_COLUMNS).eq("company_id", c.id).order("created_at", { ascending: false }).limit(CHAT_HISTORY);
        return { company: c, messages: mergeMessages((data ?? []) as ChatMessage[]) };
      }),
  );
  const href = (q: Record<string, string>) => `/admin/${slug}/tickets?${new URLSearchParams({ ...(showAll ? { show: "all" } : {}), ...q })}`;
  const chatLabel = (c: CompanyRef) => `${c.ticker ?? "—"}: ${code.get(c.rescuer_team_id ?? "") ?? "—"} rescues ${code.get(c.founder_team_id) ?? "—"}`;

  return (
    <div className="space-y-6">
      <Panel title="Read a rescue chat">
        {paired.length === 0 ? (
          <p className="text-sm text-slate-500">The chats start at the crisis, when every company gets its rescuing team.</p>
        ) : (
          <Form action={`/admin/${slug}/tickets`} className="flex flex-wrap items-end gap-2">
            {showAll ? <input type="hidden" name="show" value="all" /> : null}
            <label className="block">
              <span className="text-xs font-medium text-slate-600">Chat</span>
              <select name="chat" defaultValue={one(sp.chat) ?? ""} className={`${inputClass} w-72`}>
                {paired.map((c) => (
                  <option key={c.id} value={c.id}>
                    {chatLabel(c)}
                  </option>
                ))}
              </select>
            </label>
            <button type="submit" className={buttonClass.primary}>
              Open
            </button>
          </Form>
        )}
      </Panel>

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel
          title={`Tickets (${open.length} open)`}
          actions={
            <Link href={showAll ? `/admin/${slug}/tickets` : `/admin/${slug}/tickets?show=all`} className="text-sm underline">
              {showAll ? "Open only" : `Show all ${rows.length}`}
            </Link>
          }
        >
          {listed.length === 0 ? (
            <p className="text-sm text-slate-500">{showAll ? "No tickets yet." : "No open tickets."}</p>
          ) : (
            <ul className="space-y-3" aria-label="Tickets">
              {listed.map((t) => {
                const about = t.company_id ? byId.get(t.company_id) : null;
                const selected = ticket?.id === t.id;
                return (
                  <li key={t.id} className={`rounded-md p-3 ring-1 ring-inset ${selected ? "bg-sky-50/50 ring-sky-300" : "ring-slate-200"}`} data-testid="ticket">
                    <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                      <span className="font-semibold text-slate-800">#{t.number}</span>
                      <span className="font-mono font-semibold text-slate-800">{code.get(t.team_id) ?? "—"}</span>
                      <Badge tone={t.status === "OPEN" ? "amber" : "green"}>{t.status === "OPEN" ? "Open" : "Resolved"}</Badge>
                      <span>{about ? `about the chat ${chatLabel(about)}` : "about something else"}</span>
                      <time dateTime={t.created_at} title={`${dateTime(t.created_at)} IST`} className="font-mono tabular-nums">
                        {clock(t.created_at, true)}
                      </time>
                    </div>
                    <p className="mt-1 whitespace-pre-wrap text-sm text-slate-900">{t.body}</p>
                    {t.reply ? (
                      <p className="mt-2 whitespace-pre-wrap border-l-2 border-sky-300 pl-3 text-sm text-slate-700">
                        <span className="font-semibold">Reply{t.replied_at ? ` (${clock(t.replied_at, true)})` : ""}: </span>
                        {t.reply}
                      </p>
                    ) : null}
                    <p className="mt-2 text-sm">
                      <Link href={href({ ticket: t.id })} className="font-medium underline">
                        {about ? "Read the chat" : "Read the team's chats"}
                      </Link>
                    </p>
                    <details className="mt-2" open={selected && t.status === "OPEN"}>
                      <summary className="cursor-pointer text-sm font-medium text-slate-700">{t.status === "OPEN" ? "Reply" : "Reply again or reopen"}</summary>
                      <ActionForm action={answerTicket.bind(null, t.id)} submit="Send" className="mt-2" resetOnSuccess>
                        <label className="block">
                          <span className="text-xs font-medium text-slate-600">Reply to {code.get(t.team_id) ?? "the team"} (up to {TICKET_MAX_CHARS} characters)</span>
                          <textarea name="reply" rows={2} maxLength={TICKET_MAX_CHARS} className={inputClass} />
                        </label>
                        <label className="mt-2 flex items-center gap-2 text-sm text-slate-700">
                          <input type="checkbox" name="resolve" defaultChecked={t.status === "OPEN"} />
                          Mark resolved
                        </label>
                      </ActionForm>
                    </details>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>

        <div className="space-y-6">
          {chats.length === 0 ? (
            <Notice>{ticket ? "This team has no rescue chat yet." : "Choose a ticket or a chat to read it here."}</Notice>
          ) : (
            chats.map(({ company, messages }) => {
              const sides = { rescuer: code.get(company.rescuer_team_id ?? "") ?? "Rescuer", founder: code.get(company.founder_team_id) ?? "Founder" };
              return (
                <Panel key={company.id} title={`Chat: ${chatLabel(company)}`}>
                  <ChatBox companyId={company.id} initial={messages} sides={sides} reader="STAFF" label={`Chat ${chatLabel(company)}`} />
                </Panel>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
