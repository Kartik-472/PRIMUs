"use client";

// Re-reads the page when a message arrives on one private channel (a team's ticket replies: team:<id>). The page's
// data is read again through RLS, so the message is only a signal.

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/browser";

export function TopicRefresh({ topic }: { topic: string }) {
  const router = useRouter();
  useEffect(() => {
    const sb = supabaseBrowser();
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const channel = sb.channel(topic, { config: { private: true } }).on("broadcast", { event: "*" }, () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => router.refresh(), 250);
    });
    (async () => {
      await sb.realtime.setAuth();
      if (!cancelled) channel.subscribe();
    })();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      void sb.removeChannel(channel);
    };
  }, [topic, router]);
  return null;
}
