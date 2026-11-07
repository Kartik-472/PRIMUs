"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { PhaseCode } from "@msim/engine";
import { TEAM_SECTIONS, sectionLive } from "@/lib/team/sections";

// The portal's sections. A section not in use yet is greyed (it still opens, and says when it starts). On a phone the
// row scrolls sideways and keeps the current tab in view (only the row scrolls, never the page).
export function TeamNav({ phase }: { phase: PhaseCode }) {
  const pathname = usePathname();
  const nav = useRef<HTMLElement>(null);
  useEffect(() => {
    const row = nav.current;
    const tab = row?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!row || !tab) return;
    const r = row.getBoundingClientRect();
    const t = tab.getBoundingClientRect();
    if (t.left < r.left || t.right > r.right) row.scrollLeft += t.left - r.left - (r.width - t.width) / 2;
  }, [pathname]);
  return (
    <nav ref={nav} className="flex gap-px overflow-x-auto border-t border-slate-200 bg-slate-200" aria-label="Sections">
      {TEAM_SECTIONS.map((s, i) => {
        const href = `/team${s.path}`;
        const active = s.path === "" ? pathname === "/team" : pathname.startsWith(href);
        const live = sectionLive(s, phase);
        return (
          <Link
            key={s.path}
            href={href}
            aria-current={active ? "page" : undefined}
            className={`flex items-center gap-1.5 whitespace-nowrap px-2.5 py-1.5 text-xs font-semibold tracking-wide uppercase ${
              active ? "bg-[var(--term-amber)] text-black" : live ? "bg-black text-slate-700 hover:bg-slate-100 hover:text-[var(--term-amber)]" : "bg-black text-slate-400 hover:text-slate-600"
            }`}
          >
            {/* A key number, like the function keys of a trading terminal. */}
            <span className={`px-1 text-[10px] ${active ? "bg-black text-[var(--term-amber)]" : "bg-slate-200 text-slate-600"}`} aria-hidden>
              F{i + 1}
            </span>
            {s.label}
          </Link>
        );
      })}
    </nav>
  );
}
