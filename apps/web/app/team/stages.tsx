"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import type { PhaseCode } from "@msim/engine";
import { STAGES, stageState } from "@/lib/team/sections";

// Where the night is, as a team lives it: check-in, the three rounds and the results, each done (✓), under way (▶,
// amber) or still ahead (grey). Every stage links to its section, so the strip doubles as the way between rounds.
// On a phone it scrolls sideways and shows the stage under way first in view.
export function StageStepper({ phase }: { phase: PhaseCode }) {
  const row = useRef<HTMLOListElement>(null);
  useEffect(() => {
    const el = row.current;
    const now = el?.querySelector<HTMLElement>('[aria-current="step"]');
    if (el && now) el.scrollLeft = Math.max(0, now.offsetLeft - 16);
  }, [phase]);
  return (
    <ol ref={row} className="relative flex gap-px overflow-x-auto border-t border-slate-200 bg-slate-200 text-xs [scrollbar-width:none]" aria-label="Stages of the night" data-testid="stages">
      {STAGES.map((s, i) => {
        const state = stageState(s, phase);
        return (
          <li key={s.key} className="min-w-[8.5rem] flex-1">
            <Link
              href={s.href}
              aria-current={state === "now" ? "step" : undefined}
              className={`flex h-full items-center gap-2 px-3 py-1.5 ${
                state === "now"
                  ? "bg-[var(--term-amber)] text-black"
                  : state === "done"
                    ? "bg-black text-slate-600 hover:text-[var(--term-amber)]"
                    : "bg-black text-slate-400 hover:text-slate-600"
              }`}
            >
              <span
                className={`flex h-5 w-5 shrink-0 items-center justify-center text-[10px] font-bold ${
                  state === "now" ? "bg-black text-[var(--term-amber)]" : state === "done" ? "bg-[var(--term-green)] text-black" : "border border-slate-300"
                }`}
                aria-hidden
              >
                {state === "done" ? "✓" : state === "now" ? "▶" : i}
              </span>
              <span className="min-w-0">
                <span className="block font-bold tracking-wide whitespace-nowrap uppercase">{s.label}</span>
                <span className={`block truncate text-[11px] ${state === "now" ? "text-black/70" : "text-slate-500"}`}>
                  {state === "done" ? "Done" : state === "now" ? `Now: ${s.hint}` : s.hint}
                </span>
              </span>
              <span className="sr-only">{state === "done" ? " (done)" : state === "now" ? " (under way)" : " (ahead)"}</span>
            </Link>
          </li>
        );
      })}
    </ol>
  );
}
