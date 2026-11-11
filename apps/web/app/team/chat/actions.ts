"use server";

// The rescue chats and tickets: each action is one game function, run as the signed-in team; the database checks the
// chat is the team's, the window, the length and the rate limit, and its refusal is shown as it comes.

import { rpc, type ActionResult } from "@/lib/rpc";
import { TICKET_MAX_CHARS, messageCheck } from "@/lib/chat/chat";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function sendChat(companyId: string, body: string): Promise<ActionResult> {
  if (!UUID.test(companyId)) return { ok: false, code: "NOT_ALLOWED", message: "That is not one of your two rescue chats." };
  if (!messageCheck(body).ok) return { ok: false, code: "BAD_LENGTH", message: "Messages are 1 to 500 characters." };
  return rpc("send_chat", { p_company: companyId, p_body: body.trim() });
}

export async function raiseTicket(_prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  const about = String(form.get("about") ?? "");
  const body = String(form.get("body") ?? "").trim();
  if (about !== "" && !UUID.test(about)) return { ok: false, code: "NOT_ALLOWED", message: "Choose what the ticket is about." };
  if (!messageCheck(body, TICKET_MAX_CHARS).ok) return { ok: false, code: "BAD_LENGTH", message: "A ticket is 1 to 600 characters." };
  const r = await rpc("raise_ticket", { p_company: about === "" ? null : about, p_body: body });
  return r.ok ? { ...r, message: `Ticket #${String(r.data?.number ?? "")} sent. An organiser will reply here.` } : r;
}
