"use client";

// One rescue chat: the messages, oldest first, and (for a team while the chats are open) a box to write. A new message
// is signalled on the chat's own private channel (chat:<company id>), and the box then reads the chat again through
// RLS, so only the two teams of this chat (and staff) are disturbed. While the channel is down it re-reads every 15 s.

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import type { ActionResult } from "@/lib/rpc";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { CHAT_HISTORY, CHAT_MAX_CHARS, MESSAGE_COLUMNS, author, mergeMessages, messageCheck, type ChatMessage } from "@/lib/chat/chat";
import { clock, count, dateTime } from "@/lib/format";
import { ResultMessage } from "@/components/ui/result-message";
import { safely } from "@/components/ui/action-helpers";
import { buttonClass, inputClass } from "@/components/ui/ui";

export interface ChatSides {
  /** The rescuing team's code. */
  rescuer: string;
  /** The founding team's code. */
  founder: string;
}

export function ChatBox({
  companyId,
  initial,
  sides,
  reader,
  send,
  closedNote,
  label,
}: {
  companyId: string;
  initial: ChatMessage[];
  sides: ChatSides;
  reader: "RESCUER" | "FOUNDER" | "STAFF";
  /** Sends a message; absent when this reader cannot write (staff, or the chats are closed). */
  send?: (companyId: string, body: string) => Promise<ActionResult>;
  closedNote?: string;
  label: string;
}) {
  // What the page brought, plus what this box read since (after sending, or on a live signal).
  const [fetched, setFetched] = useState<ChatMessage[]>([]);
  const messages = useMemo(() => mergeMessages(initial, fetched), [initial, fetched]);
  const [live, setLive] = useState(false);
  const list = useRef<HTMLOListElement>(null);

  const reload = useCallback(async () => {
    const { data } = await supabaseBrowser()
      .from("chat_messages")
      .select(MESSAGE_COLUMNS)
      .eq("company_id", companyId)
      .order("created_at", { ascending: false })
      .limit(CHAT_HISTORY);
    if (data) setFetched((m) => mergeMessages(m, data as ChatMessage[]));
  }, [companyId]);

  useEffect(() => {
    const sb = supabaseBrowser();
    let cancelled = false;
    const channel = sb.channel(`chat:${companyId}`, { config: { private: true } }).on("broadcast", { event: "*" }, () => void reload());
    (async () => {
      await sb.realtime.setAuth();
      if (cancelled) return;
      channel.subscribe((s: string) => {
        setLive(s === "SUBSCRIBED");
        if (s === "SUBSCRIBED") void reload(); // anything sent before the channel was joined
      });
    })();
    return () => {
      cancelled = true;
      void sb.removeChannel(channel);
    };
  }, [companyId, reload]);

  useEffect(() => {
    if (live) return;
    const id = setInterval(() => {
      if (document.visibilityState === "visible") void reload();
    }, 15_000);
    return () => clearInterval(id);
  }, [live, reload]);

  // Keep the newest message in view.
  useEffect(() => {
    const el = list.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  return (
    <div className="flex flex-col gap-3">
      <ol ref={list} aria-label={label} aria-live="polite" className="max-h-96 min-h-32 space-y-2 overflow-y-auto rounded-md bg-slate-50 p-3 ring-1 ring-inset ring-slate-200">
        {messages.length === 0 ? (
          <li className="text-sm text-slate-500">No messages yet.</li>
        ) : (
          messages.map((m) => {
            const who = author(m, sides, reader);
            const mine = who === "You";
            return (
              <li key={m.id} className={`max-w-[85%] rounded-md px-3 py-2 text-sm ring-1 ring-inset ${mine ? "ml-auto bg-sky-50 ring-sky-200" : "bg-white ring-slate-200"}`} data-testid="chat-message">
                <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                  <span className="font-semibold text-slate-700">{who}</span>
                  <time dateTime={m.created_at} title={`${dateTime(m.created_at)} IST`} className="font-mono tabular-nums">
                    {clock(m.created_at, true)}
                  </time>
                </div>
                <p className="mt-0.5 whitespace-pre-wrap text-slate-900">{m.body}</p>
              </li>
            );
          })
        )}
      </ol>
      {send ? <SendBox companyId={companyId} send={send} onSent={reload} label={label} /> : closedNote ? <p className="text-sm text-slate-600">{closedNote}</p> : null}
    </div>
  );
}

function SendBox({ companyId, send, onSent, label }: { companyId: string; send: (companyId: string, body: string) => Promise<ActionResult>; onSent: () => Promise<void>; label: string }) {
  const [body, setBody] = useState("");
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, start] = useTransition();
  const check = messageCheck(body);
  const submit = () => {
    if (!check.ok || pending) return;
    start(async () => {
      const r = await safely(() => send(companyId, body));
      // An accepted message clears the box (a refusal keeps what was typed) and shows in the chat at once.
      setResult(r.ok ? null : r);
      if (r.ok) {
        setBody("");
        await onSent();
      }
    });
  };
  return (
    <form
      aria-label={`Write in: ${label}`}
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <label className="block">
        <span className="text-xs font-medium text-slate-600">Message (Enter sends, Shift+Enter for a new line)</span>
        <textarea
          name="body"
          rows={2}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              submit();
            }
          }}
          maxLength={CHAT_MAX_CHARS * 2}
          className={inputClass}
        />
      </label>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <span className={`text-xs tabular-nums ${check.chars > CHAT_MAX_CHARS ? "font-semibold text-red-700" : "text-slate-500"}`} aria-live="polite">
          {count(check.chars)} / {count(CHAT_MAX_CHARS)} characters
        </span>
        <button type="submit" disabled={pending || !check.ok} className={buttonClass.primary}>
          {pending ? "Sending…" : "Send"}
        </button>
      </div>
      <ResultMessage result={result} />
    </form>
  );
}
