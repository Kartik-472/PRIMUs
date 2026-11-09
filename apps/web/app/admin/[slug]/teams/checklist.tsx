"use client";

// The registration list: one tick box per team, a search, "tick all shown" / "untick all shown", and one Save that
// registers exactly the ticked teams. Unsaved ticks are counted so nobody leaves the page thinking they were saved.

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ActionResult } from "@/lib/rpc";
import { buttonClass, inputClass } from "@/components/ui/ui";
import { ResultMessage } from "@/components/ui/result-message";
import { safely } from "@/components/ui/action-helpers";
import { saveRegistration } from "./actions";

export interface RegistrationRow {
  code: string;
  name: string;
  members: number;
  registered: boolean;
  withdrawn: boolean;
}

export function RegistrationChecklist({ eventId, rows, editable }: { eventId: string; rows: RegistrationRow[]; editable: boolean }) {
  const router = useRouter();
  const saved = useMemo(() => new Set(rows.filter((r) => r.registered).map((r) => r.code)), [rows]);
  const [ticked, setTicked] = useState<Set<string>>(() => new Set(saved));
  const [query, setQuery] = useState("");
  const [only, setOnly] = useState<"all" | "registered" | "not">("all");
  const [pending, start] = useTransition();
  const [result, setResult] = useState<ActionResult | null>(null);

  const q = query.trim().toLowerCase();
  const shown = rows.filter(
    (r) =>
      (q === "" || r.code.toLowerCase().includes(q) || r.name.toLowerCase().includes(q)) &&
      (only === "all" || (only === "registered") === ticked.has(r.code)),
  );
  const changes = rows.filter((r) => ticked.has(r.code) !== saved.has(r.code)).length;

  const set = (codes: string[], on: boolean) =>
    setTicked((prev) => {
      const next = new Set(prev);
      for (const c of codes) if (on) next.add(c);
      else next.delete(c);
      return next;
    });
  const save = () =>
    start(async () => {
      const r = await safely(() => saveRegistration(eventId, [...ticked]));
      setResult(r);
      router.refresh();
    });

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search code or team name"
          aria-label="Search teams"
          className={`${inputClass} max-w-xs`}
        />
        <select value={only} onChange={(e) => setOnly(e.target.value as typeof only)} aria-label="Show" className={`${inputClass} w-auto`}>
          <option value="all">All teams</option>
          <option value="registered">Ticked</option>
          <option value="not">Not ticked</option>
        </select>
        {editable ? (
          <>
            <button type="button" className={buttonClass.secondary} onClick={() => set(shown.map((r) => r.code), true)} disabled={pending}>
              Tick all shown
            </button>
            <button type="button" className={buttonClass.secondary} onClick={() => set(shown.map((r) => r.code), false)} disabled={pending}>
              Untick all shown
            </button>
          </>
        ) : null}
      </div>

      <p className="text-sm text-slate-600" data-testid="registration-count">
        <b>{ticked.size}</b> of {rows.length} teams ticked · showing {shown.length}
        {changes > 0 ? <span className="ml-2 font-semibold text-amber-700">{changes} unsaved change{changes === 1 ? "" : "s"}</span> : null}
      </p>

      <ul className="grid max-h-[60vh] gap-1 overflow-y-auto rounded-md border border-slate-200 p-2 sm:grid-cols-2 lg:grid-cols-3">
        {shown.map((r) => (
          <li key={r.code}>
            <label className={`flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-slate-50 ${ticked.has(r.code) ? "bg-emerald-50" : ""}`}>
              <input
                type="checkbox"
                checked={ticked.has(r.code)}
                disabled={!editable || pending}
                onChange={(e) => set([r.code], e.target.checked)}
                className="h-4 w-4"
                data-testid={`register-${r.code}`}
              />
              <span className="font-mono font-semibold">{r.code}</span>
              <span className="min-w-0 truncate text-slate-700">{r.name}</span>
              <span className="ml-auto shrink-0 text-xs text-slate-500">
                {r.withdrawn && !ticked.has(r.code) ? "withdrawn · " : ""}
                {r.members} member{r.members === 1 ? "" : "s"}
              </span>
            </label>
          </li>
        ))}
        {shown.length === 0 ? <li className="p-2 text-sm text-slate-500">No team matches.</li> : null}
      </ul>

      {editable ? (
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" className={buttonClass.primary} onClick={save} disabled={pending || changes === 0}>
            {pending ? "Saving…" : `Save registration (${ticked.size} teams)`}
          </button>
          <ResultMessage result={result} />
        </div>
      ) : null}
    </div>
  );
}
