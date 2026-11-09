"use client";

// The sign-up form: team name, a contact email and phone, and 1 to 4 members (name and roll number). On success the
// registration number replaces the form, large, so it can be screenshotted.

import { useState, useTransition } from "react";
import type { ActionResult } from "@/lib/rpc";
import { signUpTeam } from "./actions";

const MAX = 4;
const field =
  "block w-full rounded-md border border-zinc-700 bg-black px-3 py-2 text-sm text-slate-100 placeholder:text-zinc-600 focus:border-[#ffb000] focus:outline-none";

export function SignUpForm({ slug }: { slug: string }) {
  const [teamName, setTeamName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [members, setMembers] = useState(() => Array.from({ length: MAX }, () => ({ full_name: "", roll_number: "" })));
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, start] = useTransition();

  const number = result?.ok ? String(result.data?.number ?? "") : null;
  if (number) {
    return (
      <div className="text-center" data-testid="signup-done">
        <p className="text-sm text-slate-400">Your team is registered. Your registration number:</p>
        <p className="my-4 text-5xl font-black tracking-wider text-[#ffb000]" data-testid="signup-number">
          {number}
        </p>
        <p className="text-sm text-slate-300">
          Save it (take a screenshot). Bring it to the registration desk on the night: the desk checks your team in and hands you your login card.
        </p>
      </div>
    );
  }

  const setMember = (i: number, key: "full_name" | "roll_number", value: string) =>
    setMembers((prev) => prev.map((m, j) => (j === i ? { ...m, [key]: value } : m)));
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    start(async () => {
      try {
        setResult(await signUpTeam(slug, { teamName, email, phone, members: members.filter((m) => m.full_name.trim() !== "") }));
      } catch {
        setResult({ ok: false, message: "Could not reach the server. Check your connection and try again." });
      }
    });
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <label className="block text-sm">
        <span className="text-slate-400">Team name</span>
        <input required maxLength={80} value={teamName} onChange={(e) => setTeamName(e.target.value)} className={field} />
      </label>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block text-sm">
          <span className="text-slate-400">Contact email</span>
          <input required type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={field} autoComplete="email" />
        </label>
        <label className="block text-sm">
          <span className="text-slate-400">Contact phone</span>
          <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} className={field} autoComplete="tel" />
        </label>
      </div>
      <fieldset className="space-y-2">
        <legend className="text-sm text-slate-400">Members (1 to 4; the first is the team lead)</legend>
        {members.map((m, i) => (
          <div key={i} className="grid grid-cols-[1fr_8rem] gap-2">
            <input
              aria-label={`Member ${i + 1} name`}
              placeholder={`Member ${i + 1} name${i === 0 ? "" : " (optional)"}`}
              required={i === 0}
              maxLength={120}
              value={m.full_name}
              onChange={(e) => setMember(i, "full_name", e.target.value)}
              className={field}
            />
            <input
              aria-label={`Member ${i + 1} roll number`}
              placeholder="Roll no."
              maxLength={30}
              value={m.roll_number}
              onChange={(e) => setMember(i, "roll_number", e.target.value)}
              className={field}
            />
          </div>
        ))}
      </fieldset>
      {result && !result.ok ? (
        <p className="rounded-md border border-red-500/50 bg-red-950/50 px-3 py-2 text-sm text-red-200" role="alert">
          {result.message ?? "Something went wrong."}
        </p>
      ) : null}
      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-md bg-[#ffb000] px-4 py-3 text-sm font-bold tracking-widest text-black uppercase hover:bg-amber-300 disabled:opacity-50"
      >
        {pending ? "Registering…" : "Register team"}
      </button>
    </form>
  );
}
