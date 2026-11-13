import type { Metadata } from "next";
import { supabaseService } from "@/lib/supabase/service";
import { RegisterForm } from "./register-form";

export const metadata: Metadata = { title: "Register your team · PRIMUS" };
export const dynamic = "force-dynamic";

interface Info {
  slug?: string;
  name?: string;
  open: boolean;
}

async function registrationInfo(slug: string | null): Promise<Info> {
  try {
    const { data, error } = await supabaseService().rpc("registration_info", { p_slug: slug });
    return error || !data ? { open: false } : (data as Info);
  } catch {
    return { open: false };
  }
}

// Public: teams register before the night and get a serial number. The organisers open and close the form on the
// control panel's Desk page; the link is /register (the event with registration open) or /register?event=<slug>.
export default async function RegisterPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { event } = await searchParams;
  const info = await registrationInfo(typeof event === "string" && event ? event : null);

  return (
    <main className="terminal-container terminal-theme-scope flex min-h-dvh justify-center px-4 py-10">
      <div className="mx-panel glow-box relative h-fit w-full max-w-xl rounded-xl p-6">
        <h1 className="text-2xl font-bold text-phosphor glow">Register your team</h1>
        <p className="mt-1 text-paper">{info.name ?? "PRIMUS"}</p>
        {info.open && info.slug ? (
          <RegisterForm slug={info.slug} />
        ) : (
          <p className="mt-6 rounded-md border border-line px-3 py-2 text-sm" data-testid="register-closed">
            Registration is closed right now. Check back later, or contact the organisers.
          </p>
        )}
      </div>
    </main>
  );
}
