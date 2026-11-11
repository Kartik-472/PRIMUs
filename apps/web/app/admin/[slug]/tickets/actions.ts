"use server";

// Tickets: an organiser replies to a team's ticket (and resolves it, or keeps it open). One game function, run as
// the signed-in staff member; the team sees the reply on its Rescue chats page at once.

import { rpc, type ActionResult } from "@/lib/rpc";
import { TICKET_MAX_CHARS, messageCheck } from "@/lib/chat/chat";

export async function answerTicket(ticketId: string, _prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  const reply = String(form.get("reply") ?? "").trim();
  const resolve = form.get("resolve") === "on";
  if (reply !== "" && !messageCheck(reply, TICKET_MAX_CHARS).ok) return { ok: false, code: "BAD_LENGTH", message: `A reply is up to ${TICKET_MAX_CHARS} characters.` };
  if (reply === "" && !resolve) return { ok: false, code: "BAD_LENGTH", message: "Write a reply, or tick “Mark resolved”." };
  const r = await rpc("answer_ticket", { p_ticket: ticketId, p_reply: reply, p_resolve: resolve });
  return r.ok ? { ...r, message: `Ticket #${String(r.data?.number ?? "")} ${resolve ? "resolved" : "answered"}.` } : r;
}
