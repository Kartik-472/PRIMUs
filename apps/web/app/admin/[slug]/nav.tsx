"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { PhaseCode } from "@msim/engine";
import { ADMIN_GROUPS, ADMIN_SECTIONS, adminFocus, type AdminGroup } from "@/lib/admin/sections";

// The control panel's tabs, grouped (Run the night, Scores, What teams read, Records). The section the phase under way
// needs carries a blue dot and "now", so an organiser always knows where to look next.
export function AdminNav({ slug, fairness, phase }: { slug: string; fairness: boolean; phase: PhaseCode }) {
  const pathname = usePathname();
  const base = `/admin/${slug}`;
  const nav = useRef<HTMLElement>(null);
  // On a phone the tabs scroll sideways: keep the current one in view. Only the tab row scrolls (scrollIntoView would
  // also scroll the page, losing the reader's place on a reload or a #link).
  useEffect(() => {
    const row = nav.current;
    const tab = row?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!row || !tab) return;
    const r = row.getBoundingClientRect();
    const t = tab.getBoundingClientRect();
    if (t.left < r.left || t.right > r.right) row.scrollLeft += t.left - r.left - (r.width - t.width) / 2;
  }, [pathname]);
  const focus = adminFocus(phase, fairness);
  const groups = (Object.keys(ADMIN_GROUPS) as AdminGroup[]).map((g) => ({ g, sections: ADMIN_SECTIONS.filter((s) => s.group === g) }));
  return (
    <nav ref={nav} className="mx-auto flex max-w-7xl items-end gap-4 overflow-x-auto px-4" aria-label="Sections">
      {groups.map(({ g, sections }) => (
        <div key={g} role="group" aria-label={ADMIN_GROUPS[g]} className="shrink-0">
          <p className="px-3 pt-1 text-[10px] font-semibold tracking-wider whitespace-nowrap text-slate-400 uppercase" aria-hidden>
            {ADMIN_GROUPS[g]}
          </p>
          <div className="flex gap-1">
            {sections.map((s) => {
              const href = `${base}${s.path}`;
              const active = s.path === "" ? pathname === base : pathname.startsWith(href);
              const now = s.path === focus;
              return (
                <Link
                  key={s.path}
                  href={href}
                  aria-current={active ? "page" : undefined}
                  className={`flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium ${
                    active ? "border-slate-900 text-slate-900" : "border-transparent text-slate-500 hover:text-slate-900"
                  } ${s.path === "/fairness" && fairness ? "font-semibold" : ""}`}
                >
                  {s.label}
                  {now ? (
                    <span className="flex items-center gap-1 rounded bg-sky-100 px-1.5 text-[10px] font-bold text-sky-800 uppercase">
                      <span className="h-1.5 w-1.5 rounded-full bg-sky-600" aria-hidden />
                      now
                    </span>
                  ) : null}
                </Link>
              );
            })}
          </div>
        </div>
      ))}
    </nav>
  );
}
