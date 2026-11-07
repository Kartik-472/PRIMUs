"use client";

// For data that changes without a realtime message (private orders and IPO bids, judge runs written by the worker,
// screen heartbeats): while `active`, the page re-reads itself every `everyMs`, as long as the tab is visible.

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export function AutoRefresh({ everyMs, active = true }: { everyMs: number; active?: boolean }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    // Start each screen at a random point in the period, so screens opened together (a room logging in at once, or
    // every page re-rendered by one broadcast) don't keep re-reading in lockstep.
    let id: ReturnType<typeof setInterval> | undefined;
    const start = setTimeout(() => {
      id = setInterval(() => {
        if (document.visibilityState === "visible") router.refresh();
      }, everyMs);
    }, Math.random() * everyMs);
    return () => {
      clearTimeout(start);
      if (id) clearInterval(id);
    };
  }, [router, everyMs, active]);
  return null;
}
