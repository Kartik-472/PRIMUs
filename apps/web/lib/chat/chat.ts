// The rescue chats and tickets (Round 2). Each company has one private chat between its founders and the team that
// rescues it, so every team has two: one to ask the founders of the company it rescues, one to help the team that
// rescues its own company. Open from the crisis until the solution lock (as send_chat decides); organisers read every
// chat. A ticket goes to the organisers, about one of the team's chats or about anything else. Pure.

import type { PhaseCode } from "@msim/engine";
import { deadlinePassed } from "@/lib/team/time";

export const CHAT_MAX_CHARS = 500;
export const TICKET_MAX_CHARS = 600;
export const CHAT_HISTORY = 500;

export interface ChatMessage {
  id: string;
  company_id: string;
  sender_team_id: string;
  /** Written by the rescuing team (otherwise by the founders). */
  from_rescuer: boolean;
  body: string;
  created_at: string;
}

export const MESSAGE_COLUMNS = "id, company_id, sender_team_id, from_rescuer, body, created_at";

export interface TicketRow {
  id: string;
  number: number;
  team_id: string;
  company_id: string | null;
  body: string;
  status: "OPEN" | "RESOLVED";
  reply: string | null;
  replied_at: string | null;
  created_at: string;
  resolved_at: string | null;
}

export const TICKET_COLUMNS = "id, number, team_id, company_id, body, status, reply, replied_at, created_at, resolved_at";

/** Characters as the database counts them (code points), after trimming. */
export const chars = (s: string) => [...s.trim()].length;

export function messageCheck(body: string, max = CHAT_MAX_CHARS): { ok: boolean; chars: number } {
  const n = chars(body);
  return { ok: n > 0 && n <= max, chars: n };
}

export type ChatState = "NOT_YET" | "OPEN" | "CLOSED";

/** Writing in the chats: from the crisis, in Crisis & Q&A or Rescue, until the solution lock and not while paused. */
export function chatState(f: { crisisApplied: boolean; phase: PhaseCode; paused: boolean; solutionLock: string | null; nowMs: number }): ChatState {
  if (!f.crisisApplied) return "NOT_YET";
  if ((f.phase !== "CRISIS_QA" && f.phase !== "RESCUE") || f.paused || deadlinePassed(f.solutionLock, f.nowMs)) return "CLOSED";
  return "OPEN";
}

/** Messages oldest first, without repeats (a message can arrive both with the page and by the live update). */
export function mergeMessages(...lists: readonly (readonly ChatMessage[])[]): ChatMessage[] {
  const by = new Map<string, ChatMessage>();
  for (const list of lists) for (const m of list) by.set(m.id, m);
  return [...by.values()].sort((a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : a.id < b.id ? -1 : 1));
}

/** Who wrote a message, as the reader of the chat sees it (the rescuing team, the founders, or staff). */
export function author(m: Pick<ChatMessage, "from_rescuer">, sides: { rescuer: string; founder: string }, reader: "RESCUER" | "FOUNDER" | "STAFF"): string {
  if (reader === "RESCUER" && m.from_rescuer) return "You";
  if (reader === "FOUNDER" && !m.from_rescuer) return "You";
  return m.from_rescuer ? `${sides.rescuer} (rescuer)` : `${sides.founder} (founder)`;
}
