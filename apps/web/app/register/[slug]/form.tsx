"use client";

// The sign-up form, for two kinds of team. A Thapar team gives its team name, the leader's name, phone, email and roll
// number, then the name and roll number of each other member. A team from another college gives its college, the
// leader's name, email and phone, then the name of each other member. A team has 2 to 5 people, the leader included.
// On success the registration number replaces the form, large, so it can be screenshotted.

import { useState, useTransition } from "react";
import type { ActionResult } from "@/lib/rpc";
import { signUpTeam, type Category } from "./actions";

const MIN = 2;
const MAX = 5;
const field =
  "block w-full rounded-md border border-zinc-700 bg-black px-3 py-2 text-sm text-slate-100 placeholder:text-zinc-600 focus:border-[#ffb000] focus:outline-none";

export function SignUpForm({ slug }: { slug: string }) {
  const [category, setCategory] = useState<Category>("THAPAR");
  const [teamName, setTeamName] = useState("");
  const [college, setCollege] = useState("");
  const [leaderName, setLeaderName] = useState("");
  const [leaderRoll, setLeaderRoll] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [size, setSize] = useState(MIN);
  const [others, setOthers] = useState(() => Array.from({ length: MAX - 1 }, () => ({ full_name: "", roll_number: "" })));
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, start] = useTransition();
  const thapar = category === "THAPAR";

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

  const setOther = (i: number, key: "full_name" | "roll_number", value: string) =>
    setOthers((prev) => prev.map((m, j) => (j === i ? { ...m, [key]: value } : m)));
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const members = [{ full_name: leaderName, roll_number: thapar ? leaderRoll : "" }, ...others.slice(0, size - 1).map((m) => ({ ...m, roll_number: thapar ? m.roll_number : "" }))];
    start(async () => {
      try {
        setResult(await signUpTeam(slug, { category, teamName: thapar ? teamName : "", college: thapar ? "" : college, email, phone, members }));
      } catch {
        setResult({ ok: false, message: "Could not reach the server. Check your connection and try again." });
      }
    });
  };

  const tab = (value: Category, label: string) => (
    <button
      type="button"
      role="radio"
      aria-checked={category === value}
      onClick={() => setCategory(value)}
      className={`flex-1 rounded-md border px-3 py-2 text-sm font-bold ${
        category === value ? "border-[#ffb000] bg-[#ffb000] text-black" : "border-zinc-700 text-slate-300 hover:border-[#ffb000]"
      }`}
    >
      {label}
    </button>
  );

  return (
    <form onSubmit={submit} className="space-y-4">
      <div role="radiogroup" aria-label="Your team is from" className="flex gap-2">
        {tab("THAPAR", "Thapar students")}
        {tab("OTHER", "Another college")}
      </div>
      {thapar ? (
        <label className="block text-sm">
          <span className="text-slate-400">Team name</span>
          <input required maxLength={80} value={teamName} onChange={(e) => setTeamName(e.target.value)} className={field} />
        </label>
      ) : (
        <label className="block text-sm">
          <span className="text-slate-400">College name</span>
          <input required maxLength={120} value={college} onChange={(e) => setCollege(e.target.value)} className={field} />
        </label>
      )}
      <fieldset className="space-y-3">
        <legend className="mb-2 text-sm font-bold text-[#ffb000]">Team leader</legend>
        <div className={`grid gap-4 ${thapar ? "sm:grid-cols-[1fr_10rem]" : ""}`}>
          <label className="block text-sm">
            <span className="text-slate-400">Team leader name</span>
            <input required maxLength={120} value={leaderName} onChange={(e) => setLeaderName(e.target.value)} className={field} autoComplete="name" />
          </label>
          {thapar ? (
            <label className="block text-sm">
              <span className="text-slate-400">Team leader roll number</span>
              <input required maxLength={30} value={leaderRoll} onChange={(e) => setLeaderRoll(e.target.value)} className={field} />
            </label>
          ) : null}
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block text-sm">
            <span className="text-slate-400">Team leader email</span>
            <input required type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={field} autoComplete="email" />
          </label>
          <label className="block text-sm">
            <span className="text-slate-400">Team leader phone</span>
            <input required type="tel" minLength={6} maxLength={20} value={phone} onChange={(e) => setPhone(e.target.value)} className={field} autoComplete="tel" />
          </label>
        </div>
      </fieldset>
      <label className="block text-sm">
        <span className="text-slate-400">Number of members (including the team leader)</span>
        <select value={size} onChange={(e) => setSize(Number(e.target.value))} className={field}>
          {Array.from({ length: MAX - MIN + 1 }, (_, i) => MIN + i).map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </label>
      <fieldset className="space-y-2">
        <legend className="mb-2 text-sm font-bold text-[#ffb000]">Other members</legend>
        {others.slice(0, size - 1).map((m, i) => (
          <div key={i} className={`grid gap-2 ${thapar ? "grid-cols-[1fr_8rem]" : ""}`}>
            <input
              aria-label={`Member ${i + 2} name`}
              placeholder={`Member ${i + 2} name`}
              required
              maxLength={120}
              value={m.full_name}
              onChange={(e) => setOther(i, "full_name", e.target.value)}
              className={field}
            />
            {thapar ? (
              <input
                aria-label={`Member ${i + 2} roll number`}
                placeholder="Roll no."
                required
                maxLength={30}
                value={m.roll_number}
                onChange={(e) => setOther(i, "roll_number", e.target.value)}
                className={field}
              />
            ) : null}
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
