"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { PhaseCode } from "@msim/engine";
import { GROUP_LABELS, TEAM_SECTIONS, phoneTabs, sectionIsNow, sectionLive, type SectionGroup, type TeamSection } from "@/lib/team/sections";

const isActive = (pathname: string, s: TeamSection) => {
  const href = `/team${s.path}`;
  return s.path === "" ? pathname === "/team" : pathname.startsWith(href);
};

// The portal's sections on a laptop or tablet: one row, grouped by the stage of the night (Start, Round 1, Round 2,
// Round 3, All night), with function-key numbers like a trading terminal. The round under way is marked NOW; a
// section not in use yet is greyed (it still opens, and says when it starts). On a phone this row is replaced by the
// tab bar at the bottom (TeamTabBar).
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
  const groups = (Object.keys(GROUP_LABELS) as SectionGroup[]).map((g) => ({ g, sections: TEAM_SECTIONS.filter((s) => s.group === g) }));
  return (
    <nav ref={nav} className="hidden gap-px overflow-x-auto border-t border-slate-200 bg-slate-200 sm:flex" aria-label="Sections">
      {groups.map(({ g, sections }) => {
        const now = sections.some((s) => sectionIsNow(s, phase));
        return (
          <div key={g} role="group" aria-label={GROUP_LABELS[g]} className={`flex shrink-0 items-stretch gap-px ${now ? "bg-[var(--term-amber-dim)]" : ""}`}>
            <span
              className={`flex items-center gap-1 px-2 text-[10px] font-bold tracking-widest uppercase ${now ? "bg-black text-[var(--term-amber)]" : "bg-black text-slate-500"}`}
              aria-hidden
            >
              {now ? <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--term-amber)]" /> : null}
              {now ? "Now" : GROUP_LABELS[g]}
            </span>
            {sections.map((s) => {
              const i = TEAM_SECTIONS.indexOf(s);
              const active = isActive(pathname, s);
              const live = sectionLive(s, phase);
              return (
                <Link
                  key={s.path}
                  href={`/team${s.path}`}
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
                  {now && !active && live ? <span className="sr-only"> (now)</span> : null}
                </Link>
              );
            })}
          </div>
        );
      })}
    </nav>
  );
}

const ICON: Record<string, string> = { "": "⌂", "/build": "✎", "/rescue": "✚", "/qa": "?", "/chat": "✆", "/market": "▤", "/trade": "⇅", "/ledger": "≡", "/leaderboard": "★", "/bulletins": "✉", "/judging": "§" };

// The phone's tab bar, fixed to the bottom within thumb reach: Home, the round under way, the market (or the news
// before it opens) and the leaderboard (or how judging works), and More, which opens every section grouped by the
// stage of the night. Hidden from the small breakpoint up, where the row in the header does the job.
export function TeamTabBar({ phase }: { phase: PhaseCode }) {
  const pathname = usePathname();
  const more = useRef<HTMLDetailsElement>(null);
  // Choosing a section closes the More sheet.
  useEffect(() => {
    if (more.current) more.current.open = false;
  }, [pathname]);
  const tabs = phoneTabs(phase);
  const inMore = !tabs.some((s) => isActive(pathname, s));
  const groups = (Object.keys(GROUP_LABELS) as SectionGroup[]).map((g) => ({ g, sections: TEAM_SECTIONS.filter((s) => s.group === g) }));
  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-40 border-t border-[var(--term-amber-dim)] bg-black pb-[env(safe-area-inset-bottom)] sm:hidden"
      aria-label="Sections"
      data-testid="tab-bar"
    >
      <div className="grid grid-cols-5">
        {tabs.map((s) => {
          const active = isActive(pathname, s);
          const now = sectionIsNow(s, phase) && s.path !== "";
          return (
            <Link
              key={s.path}
              href={`/team${s.path}`}
              aria-current={active ? "page" : undefined}
              className={`relative flex min-h-14 flex-col items-center justify-center gap-0.5 text-[11px] font-semibold uppercase ${active ? "text-[var(--term-amber)]" : "text-slate-600"}`}
            >
              {active ? <span className="absolute inset-x-3 top-0 h-0.5 bg-[var(--term-amber)]" aria-hidden /> : null}
              <span className="text-lg leading-none" aria-hidden>
                {ICON[s.path]}
              </span>
              {s.short}
              {now ? <span className="absolute top-1.5 right-[calc(50%-1.25rem)] h-1.5 w-1.5 rounded-full bg-[var(--term-amber)]" aria-label="now" /> : null}
            </Link>
          );
        })}
        <details ref={more} className="group">
          <summary
            className={`flex min-h-14 cursor-pointer list-none flex-col items-center justify-center gap-0.5 text-[11px] font-semibold uppercase [&::-webkit-details-marker]:hidden ${inMore ? "text-[var(--term-amber)]" : "text-slate-600"}`}
          >
            <span className="text-lg leading-none" aria-hidden>
              ☰
            </span>
            More
          </summary>
          <div className="fixed inset-x-0 bottom-[calc(3.5rem+env(safe-area-inset-bottom))] max-h-[70vh] overflow-y-auto border-t border-[var(--term-amber-dim)] bg-[#0a0d10] px-4 py-3">
            {groups.map(({ g, sections }) => (
              <div key={g} className="py-1.5">
                <p className="text-[10px] font-bold tracking-widest text-slate-500 uppercase">{GROUP_LABELS[g]}</p>
                <ul className="mt-1 grid grid-cols-2 gap-1">
                  {sections.map((s) => {
                    const active = isActive(pathname, s);
                    const live = sectionLive(s, phase);
                    return (
                      <li key={s.path}>
                        <Link
                          href={`/team${s.path}`}
                          aria-current={active ? "page" : undefined}
                          className={`flex min-h-11 items-center gap-2 px-3 text-sm font-semibold ${
                            active ? "bg-[var(--term-amber)] text-black" : live ? "bg-black text-slate-800" : "bg-black text-slate-400"
                          }`}
                        >
                          <span aria-hidden>{ICON[s.path]}</span>
                          {s.label}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
        </details>
      </div>
    </nav>
  );
}
