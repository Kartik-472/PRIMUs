"use client";

// The registration desk on the night. Type a team's registration number (or start a walk-in team), check and correct
// its name and members, and confirm: the team gets the next free login card, and only confirmed teams play and are
// shown anywhere. Confirmed teams can be edited or taken off again until the problem cards are dealt.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ActionResult } from "@/lib/rpc";
import { buttonClass, inputClass } from "@/components/ui/ui";
import { ResultMessage } from "@/components/ui/result-message";
import { safely } from "@/components/ui/action-helpers";
import { confirmTeam, findSignup, removeTeam, type DeskMember } from "./actions";

export interface ConfirmedTeam {
  signupId: string;
  number: string;
  code: string;
  /** "Thapar" or the other college's name. */
  from: string;
  name: string;
  members: DeskMember[];
}

interface Draft {
  signupId: string | null;
  number: string | null;
  code: string | null;
  /** "Thapar" or the other college's name; null for a walk-in. */
  from: string | null;
  name: string;
  members: { full_name: string; roll_number: string }[];
}

const MAX = 5;
const blank = (): Draft => ({ signupId: null, number: null, code: null, from: null, name: "", members: [{ full_name: "", roll_number: "" }] });
const fromMembers = (m: DeskMember[]) => m.map((x) => ({ full_name: x.full_name, roll_number: x.roll_number ?? "" }));

export function Desk({ eventId, confirmed, editable }: { eventId: string; confirmed: ConfirmedTeam[]; editable: boolean }) {
  const router = useRouter();
  const [lookup, setLookup] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [result, setResult] = useState<ActionResult | null>(null);
  const [handed, setHanded] = useState<string | null>(null);
  const [armed, setArmed] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [pending, start] = useTransition();

  const run = (fn: () => Promise<ActionResult>, then?: (r: ActionResult) => void) =>
    start(async () => {
      const r = await safely(fn);
      setResult(r);
      if (r.ok) then?.(r);
      router.refresh();
    });

  const find = (e: React.FormEvent) => {
    e.preventDefault();
    setHanded(null);
    run(
      () => findSignup(eventId, lookup),
      (r) => {
        const d = r.data ?? {};
        setResult(null);
        setDraft({
          signupId: String(d.id),
          number: String(d.number),
          code: (d.card as string | null) ?? null,
          from: d.category === "OTHER" ? String(d.college ?? "Another college") : "Thapar",
          name: String(d.team_name ?? ""),
          members: fromMembers((d.members as DeskMember[]) ?? []),
        });
      },
    );
  };
  const confirm = () => {
    if (!draft) return;
    const members = draft.members.filter((m) => m.full_name.trim() !== "").map((m) => ({ full_name: m.full_name, roll_number: m.roll_number.trim() || null }));
    run(
      () => confirmTeam(eventId, draft.signupId, draft.name, members),
      (r) => {
        if (r.data?.new) setHanded(String(r.data?.card ?? ""));
        setDraft(null);
        setLookup("");
      },
    );
  };
  const setMember = (i: number, key: "full_name" | "roll_number", value: string) =>
    setDraft((d) => (d ? { ...d, members: d.members.map((m, j) => (j === i ? { ...m, [key]: value } : m)) } : d));

  const q = query.trim().toLowerCase();
  const shown = confirmed.filter(
    (t) =>
      q === "" ||
      [t.code, t.number, t.name, ...t.members.map((m) => `${m.full_name} ${m.roll_number ?? ""}`)].some((s) => s.toLowerCase().includes(q)),
  );

  return (
    <div className="space-y-6">
      {editable ? (
        <section className="space-y-3 rounded-lg bg-white p-4 shadow-sm ring-1 ring-slate-200">
          <div className="flex flex-wrap items-end gap-2">
            <form onSubmit={find} className="flex flex-wrap items-end gap-2">
              <label className="text-sm">
                <span className="block text-slate-600">Registration number</span>
                <input
                  value={lookup}
                  onChange={(e) => setLookup(e.target.value)}
                  placeholder="PR-0042 or 42"
                  className={`${inputClass} w-44 font-mono`}
                  data-testid="desk-lookup"
                />
              </label>
              <button type="submit" className={buttonClass.primary} disabled={pending || lookup.trim() === ""}>
                Find
              </button>
            </form>
            <span className="px-1 pb-2 text-sm text-slate-400">or</span>
            <button
              type="button"
              className={buttonClass.secondary}
              disabled={pending}
              onClick={() => {
                setHanded(null);
                setResult(null);
                setDraft(blank());
              }}
            >
              New team at the desk
            </button>
          </div>

          {handed ? (
            <p className="rounded-md bg-emerald-50 px-4 py-3 text-lg text-emerald-900" data-testid="desk-handed">
              Give them login card <b className="font-mono text-2xl">{handed}</b>
            </p>
          ) : null}
          <ResultMessage result={result} />

          {draft ? (
            <div className="space-y-3 border-t border-slate-200 pt-3" data-testid="desk-editor">
              <p className="text-sm text-slate-600">
                {draft.number ? (
                  <>
                    Registration <b className="font-mono">{draft.number}</b>
                    {draft.from ? ` · ${draft.from}` : ""}
                    {draft.code ? (
                      <>
                        {" "}
                        · already confirmed on card <b className="font-mono">{draft.code}</b>
                      </>
                    ) : (
                      " · not confirmed yet"
                    )}
                  </>
                ) : (
                  "New team registered at the desk"
                )}
              </p>
              <label className="block text-sm">
                <span className="text-slate-600">Team name</span>
                <input value={draft.name} maxLength={80} onChange={(e) => setDraft({ ...draft, name: e.target.value })} className={inputClass} />
              </label>
              <div className="space-y-2">
                <p className="text-sm text-slate-600">Members, team leader first ({draft.members.length} of {MAX})</p>
                {draft.members.map((m, i) => (
                  <div key={i} className="flex gap-2">
                    <input
                      aria-label={`Member ${i + 1} name`}
                      placeholder="Name"
                      value={m.full_name}
                      maxLength={120}
                      onChange={(e) => setMember(i, "full_name", e.target.value)}
                      className={inputClass}
                    />
                    <input
                      aria-label={`Member ${i + 1} roll number`}
                      placeholder="Roll no."
                      value={m.roll_number}
                      maxLength={30}
                      onChange={(e) => setMember(i, "roll_number", e.target.value)}
                      className={`${inputClass} w-36`}
                    />
                    <button
                      type="button"
                      className={buttonClass.secondary}
                      aria-label={`Remove member ${i + 1}`}
                      onClick={() => setDraft({ ...draft, members: draft.members.filter((_, j) => j !== i) })}
                    >
                      Remove
                    </button>
                  </div>
                ))}
                {draft.members.length < MAX ? (
                  <button
                    type="button"
                    className={buttonClass.secondary}
                    onClick={() => setDraft({ ...draft, members: [...draft.members, { full_name: "", roll_number: "" }] })}
                  >
                    + Add member
                  </button>
                ) : null}
              </div>
              <div className="flex flex-wrap gap-2">
                <button type="button" className={buttonClass.primary} onClick={confirm} disabled={pending}>
                  {pending ? "Saving…" : draft.code ? "Save changes" : "Confirm team and give a card"}
                </button>
                <button type="button" className={buttonClass.secondary} onClick={() => setDraft(null)} disabled={pending}>
                  Cancel
                </button>
              </div>
            </div>
          ) : null}
        </section>
      ) : null}

      <section className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-semibold text-slate-900">Confirmed teams ({confirmed.length})</h3>
          <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search" aria-label="Search confirmed teams" className={`${inputClass} max-w-xs`} />
        </div>
        <div className="overflow-x-auto rounded-lg bg-white shadow-sm ring-1 ring-slate-200">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs text-slate-500 uppercase">
              <tr>
                <th className="px-3 py-2">Card</th>
                <th className="px-3 py-2">Reg. no.</th>
                <th className="px-3 py-2">Team</th>
                <th className="px-3 py-2">Members</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {shown.map((t) => (
                <tr key={t.signupId}>
                  <td className="px-3 py-2 font-mono font-semibold">{t.code}</td>
                  <td className="px-3 py-2 font-mono">{t.number}</td>
                  <td className="px-3 py-2">
                    {t.name}
                    <span className="block text-xs text-slate-500">{t.from}</span>
                  </td>
                  <td className="px-3 py-2 text-slate-600">{t.members.map((m) => m.full_name).join(", ")}</td>
                  <td className="px-3 py-2">
                    {editable ? (
                      <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          className={buttonClass.secondary}
                          disabled={pending}
                          onClick={() => {
                            setHanded(null);
                            setResult(null);
                            setDraft({ signupId: t.signupId, number: t.number, code: t.code, from: t.from, name: t.name, members: fromMembers(t.members) });
                            window.scrollTo({ top: 0, behavior: "smooth" });
                          }}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          className={armed === t.signupId ? buttonClass.danger : buttonClass.secondary}
                          disabled={pending}
                          onClick={() => {
                            if (armed !== t.signupId) return setArmed(t.signupId);
                            setArmed(null);
                            run(() => removeTeam(eventId, t.signupId));
                          }}
                        >
                          {armed === t.signupId ? `Click again: remove ${t.code}` : "Remove"}
                        </button>
                      </div>
                    ) : null}
                  </td>
                </tr>
              ))}
              {shown.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-3 py-4 text-center text-slate-500">
                    {confirmed.length === 0 ? "No team confirmed yet." : "No team matches."}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
