"use client";

// "Do this now": the one open task of this team that closes first, on every team page, with its countdown and a
// button to the place that does it. Nothing to do: no bar.

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Countdown } from "@/components/ui/countdown";

export interface BarTask {
  title: string;
  href: string;
  linkLabel: string | null;
  due: string | null;
}

export function ActionBar({ task }: { task: BarTask | null }) {
  const path = usePathname();
  if (!task) return null;
  const here = path === task.href;
  return (
    <div className="sticky top-0 z-30 border-b border-black bg-[var(--term-amber)] text-black" role="region" aria-label="Do this now" data-testid="action-bar">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 text-sm">
        <span className="bg-black px-2 py-0.5 text-xs font-bold tracking-wide text-[var(--term-amber)] uppercase">Do this now</span>
        {/* The title keeps at least 10rem: on a phone the countdown and the button wrap to a second line instead
            of squeezing it. */}
        <span className="min-w-[10rem] flex-1 font-semibold [overflow-wrap:anywhere]" data-testid="action-bar-title">
          {task.title}
        </span>
        <span className="ml-auto flex items-center gap-3">
          {task.due ? (
            <span className="whitespace-nowrap text-black/70">
              closes in <Countdown to={task.due} passed="now" className="font-bold text-black" />
            </span>
          ) : null}
          {here ? (
            <span className="whitespace-nowrap border border-black px-3 py-1 text-xs font-semibold uppercase">You&apos;re on it</span>
          ) : (
            <Link href={task.href} className="whitespace-nowrap bg-black px-3 py-1 text-xs font-bold text-[var(--term-amber)] uppercase hover:bg-black/80">
              {task.linkLabel ?? "Open"} →
            </Link>
          )}
        </span>
      </div>
    </div>
  );
}
