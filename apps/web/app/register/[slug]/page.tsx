import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { rpc } from "@/lib/rpc";
import { SignUpForm } from "./form";

export const metadata: Metadata = { title: "Register your team · PRIMUS" };

// The public sign-up page, shared before the night (/register/<event>): a team signs up and gets a number to bring to
// the registration desk. Signing up does not reserve a place and does not create a login; it tells the organisers
// how many teams to expect.
export default async function RegisterPage({ params }: PageProps<"/register/[slug]">) {
  const { slug } = await params;
  const r = await rpc("signup_event", { p_slug: slug });
  const event = r.ok ? (r.data?.value as { name: string; open: boolean } | null) : null;
  if (!event) notFound();

  return (
    <main className="min-h-dvh bg-black px-4 py-10 font-mono text-slate-200">
      <div className="mx-auto w-full max-w-xl">
        <p className="inline-block bg-[#ffb000] px-2 text-xs font-black tracking-widest text-black">PRIMUS</p>
        <h1 className="mt-3 text-2xl font-bold text-[#ffb000]">Register your team</h1>
        <p className="mt-2 text-sm text-slate-400">
          {event.name}. Sign your team up here to tell us you plan to come. You will get a <b className="text-slate-200">registration number</b>:
          bring it to the registration desk on the night, where your team is checked in and gets its login card.
        </p>
        <div className="mt-6 rounded-lg border border-[#ffb000]/40 bg-zinc-950 p-5">
          {event.open ? (
            <SignUpForm slug={slug} />
          ) : (
            <p className="text-sm text-slate-300">Online registration is closed. Teams can still register at the desk on the night if there is room.</p>
          )}
        </div>
      </div>
    </main>
  );
}
