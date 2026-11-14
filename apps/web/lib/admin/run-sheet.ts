// The organiser's run sheet: the night as stages (before the rounds, Round 1, Round 2 with its four crises, Round 3,
// the finish), each a list of steps with its planned time and state, and which one step the organiser may start now
// or delay. Pure: the page reads the rows and renders what this returns.
//
// Only the NEXT step of the CURRENT phase can be started now or delayed: starting a later one first would put the
// plan out of order (its earlier steps would come after it). Moving to the next phase is its own button.

import type { PhaseCode } from "@msim/engine";

export interface SheetPhase {
  code: PhaseCode;
  seq: number;
  starts_at: string;
  ends_at: string;
  started_at: string | null;
  ended_at: string | null;
}
export interface SheetDeadline {
  code: string;
  at: string;
}
export interface SheetSubround {
  k: number;
  revealed_at: string | null;
  hiring_closed_at: string | null;
  due_closed_at: string | null;
  rated_at: string | null;
}

export type StepState = "DONE" | "NOW" | "NEXT" | "LATER";

export interface Step {
  /** Phase code ("phase:PRESSURE") or deadline code ("REVEAL_2"). */
  key: string;
  label: string;
  /** What starting it now does, in the organiser's words. */
  action: string;
  phase: PhaseCode;
  /** Planned time (ISO). */
  at: string;
  /** When it happened, if it has. */
  doneAt: string | null;
  state: StepState;
  /** The organiser may start this step now or add time to it. */
  movable: boolean;
}

export interface Stage {
  key: string;
  title: string;
  /** One line on what happens in this stage. */
  blurb: string;
  phases: PhaseCode[];
  /** Round 2's crises are groups of steps (one per sub-round); other stages have one group. */
  groups: { key: string; title: string | null; steps: Step[] }[];
  state: "DONE" | "NOW" | "LATER";
}

export const PHASE_NAMES: Partial<Record<PhaseCode, string>> = {
  SETUP: "Setup",
  CHECKIN: "Check-in",
  BRIEFING: "Briefing",
  SQUAD_DRAW: "Squad draw",
  BUILD: "Round 1: Build",
  READING: "Round 1: Judging",
  IPO: "IPO",
  PRESSURE: "Round 2: Pressure",
  SATURATION: "Round 3: Saturation",
  CLOSE: "Market close",
  SETTLEMENT: "Settlement",
  APPEALS: "Appeals",
  AWARDS: "Awards",
};

export function phaseName(code: PhaseCode): string {
  return PHASE_NAMES[code] ?? code.charAt(0) + code.slice(1).toLowerCase().replace(/_/g, " ");
}

/** Each deadline's name, what doing it now means, and the phase it belongs to. */
function deadlineInfo(code: string): { label: string; action: string; phase: PhaseCode; group: string | null } | null {
  const m = /^(REVEAL|HIRE|DUE|RATE)_([1-5])$/.exec(code);
  if (m) {
    const k = Number(m[2]);
    const r3 = k === 5;
    const phase: PhaseCode = r3 ? "SATURATION" : "PRESSURE";
    const group = r3 ? null : `crisis-${k}`;
    switch (m[1]) {
      case "REVEAL":
        return { label: `Crisis ${k} revealed`, action: `Start crisis ${k} now: every company gets its card and prices drop 5%`, phase, group };
      case "HIRE":
        return { label: r3 ? "Hiring closes" : "Hiring closes", action: "Close hiring now: open offers lapse", phase, group };
      case "DUE":
        return {
          label: r3 ? "Solutions and memos due" : "Plans and memos due",
          action: "Close submissions now: work is locked and escrow is paid out",
          phase,
          group,
        };
      case "RATE":
        return { label: "Ratings close", action: "Close ratings now: unrated firms get 3 stars", phase, group };
    }
  }
  switch (code) {
    case "PROBLEM_PICK":
      return { label: "Problem cards picked", action: "Close the problem pick now", phase: "BUILD", group: null };
    case "PITCH":
      return { label: "PRDs and crisis memos due", action: "Close Round 1 submissions now", phase: "BUILD", group: null };
    case "CALL_1":
      return { label: "Consultant call ends", action: "End the consultant call now", phase: "READING", group: null };
    case "IPO_BIDS":
      return { label: "IPO bids close", action: "Close IPO bids now", phase: "IPO", group: null };
    case "DRAFT":
      return { label: "Draft ends", action: "End the draft now: unpicked companies get a statement", phase: "SATURATION", group: null };
    default:
      return null;
  }
}

const STAGES: { key: string; title: string; blurb: string; phases: PhaseCode[] }[] = [
  { key: "before", title: "Before the rounds", blurb: "Teams arrive, the rules are explained and squads are drawn.", phases: ["SETUP", "CHECKIN", "BRIEFING", "SQUAD_DRAW"] },
  { key: "r1", title: "Round 1: Build", blurb: "Product writes the PRD, Consulting the crisis memo; the AI judges them, then the IPO sets prices.", phases: ["BUILD", "READING", "IPO"] },
  { key: "r2", title: "Round 2: Pressure", blurb: "Four crises. Each one: card revealed, hire a firm, write the plan, rate the firm. Trading runs throughout.", phases: ["PRESSURE"] },
  { key: "r3", title: "Round 3: Saturation", blurb: "The draft of problem statements, hiring, solutions and ratings. Trading runs throughout.", phases: ["SATURATION"] },
  { key: "finish", title: "Finish", blurb: "The market closes, results are settled, appeals, then the awards.", phases: ["CLOSE", "SETTLEMENT", "APPEALS", "AWARDS"] },
];

const ms = (v: string) => new Date(v).getTime();

function stripGroup(s: Step & { group: string | null }): Step {
  const { group, ...rest } = s;
  void group;
  return rest;
}

export function buildRunSheet(input: {
  now: number;
  current: PhaseCode;
  phases: readonly SheetPhase[];
  deadlines: readonly SheetDeadline[];
  subrounds: readonly SheetSubround[];
}): { stages: Stage[]; next: Step | null } {
  const { now, current } = input;
  const phaseRow = new Map(input.phases.map((p) => [p.code, p]));
  const seqOf = (c: PhaseCode) => phaseRow.get(c)?.seq ?? -1;
  const curSeq = seqOf(current);
  const sub = new Map(input.subrounds.map((s) => [s.k, s]));

  const steps: (Step & { group: string | null })[] = [];
  for (const p of input.phases) {
    steps.push({
      key: `phase:${p.code}`,
      label: `${phaseName(p.code)} starts`,
      action: "",
      phase: p.code,
      at: p.started_at ?? p.starts_at,
      doneAt: p.started_at,
      state: "LATER",
      movable: false,
      group: null,
    });
  }
  for (const d of input.deadlines) {
    const info = deadlineInfo(d.code);
    if (!info || !phaseRow.has(info.phase)) continue;
    const m = /_([1-5])$/.exec(d.code);
    const s = m ? sub.get(Number(m[1])) : undefined;
    let doneAt: string | null = null;
    if (d.code.startsWith("REVEAL_")) doneAt = s?.revealed_at ?? null;
    else if (ms(d.at) <= now) doneAt = d.at;
    steps.push({ key: d.code, label: info.label, action: info.action, phase: info.phase, at: d.at, doneAt, state: "LATER", movable: false, group: info.group });
  }

  // State: done; the current phase's start is NOW; the earliest pending step of the current phase is NEXT.
  const pendingHere = steps
    .filter((s) => s.phase === current && !s.key.startsWith("phase:") && s.doneAt === null)
    .sort((a, b) => ms(a.at) - ms(b.at));
  const nextHere = pendingHere[0] ?? null;
  for (const s of steps) {
    const seq = seqOf(s.phase);
    if (s.key === `phase:${current}`) s.state = "NOW";
    else if (s.doneAt !== null || seq < curSeq) s.state = "DONE";
    else if (s === nextHere) {
      s.state = "NEXT";
      s.movable = ms(s.at) > now;
    }
  }

  const stages: Stage[] = [];
  for (const st of STAGES) {
    const mine = steps.filter((s) => st.phases.includes(s.phase)).sort((a, b) => ms(a.at) - ms(b.at) || (a.key.startsWith("phase:") ? -1 : 1));
    if (mine.length === 0 || !st.phases.some((c) => phaseRow.has(c))) continue;
    const groupKeys = [...new Set(mine.map((s) => s.group))];
    const groups = groupKeys.map((g) => ({
      key: g ?? "main",
      title: g ? `Crisis ${g.split("-")[1]}` : null,
      steps: mine.filter((s) => s.group === g).map(stripGroup),
    }));
    const seqs = st.phases.map(seqOf).filter((x) => x >= 0);
    const state = Math.max(...seqs) < curSeq ? "DONE" : Math.min(...seqs) > curSeq ? "LATER" : "NOW";
    stages.push({ key: st.key, title: st.title, blurb: st.blurb, phases: st.phases.filter((c) => phaseRow.has(c)), groups, state });
  }
  const next = nextHere ? stripGroup(nextHere) : null;
  return { stages, next: next && next.state === "NEXT" ? next : null };
}
