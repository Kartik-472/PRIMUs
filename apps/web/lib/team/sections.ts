// The team portal's sections, in the order of the night (the brief's /team list). Every team plays all three rounds,
// so every team has the same sections; a section that is not in use yet says when it opens. Sections are grouped by
// the stage of the night they belong to, so the menu reads as the night: home, Round 1, Round 2, Round 3, and the
// pages for the whole night (leaderboard, news, how judging works).

import { phaseIndex, phaseReached, type PhaseCode } from "@msim/engine";

export type StageKey = "start" | "r1" | "r2" | "r3" | "end";
export type SectionGroup = "home" | "r1" | "r2" | "r3" | "night";

export interface TeamSection {
  path: string;
  label: string;
  /** A short name for the phone's tab bar. */
  short: string;
  /** The phase from which the section has something to show (it opens before then with a note). */
  from: PhaseCode;
  group: SectionGroup;
}

export const TEAM_SECTIONS: readonly TeamSection[] = [
  { path: "", label: "Home", short: "Home", from: "SETUP", group: "home" },
  { path: "/build", label: "Round 1: PRD", short: "PRD", from: "BRIEFING", group: "r1" },
  { path: "/rescue", label: "Round 2: Rescue", short: "Rescue", from: "CRISIS_QA", group: "r2" },
  { path: "/qa", label: "Q&A", short: "Q&A", from: "CRISIS_QA", group: "r2" },
  { path: "/chat", label: "Rescue chats", short: "Chats", from: "CRISIS_QA", group: "r2" },
  { path: "/market", label: "Market", short: "Market", from: "REVEAL_1", group: "r3" },
  { path: "/trade", label: "Round 3: Trade", short: "Trade", from: "MARKET_BLIND", group: "r3" },
  { path: "/ledger", label: "Ledger", short: "Ledger", from: "MARKET_BLIND", group: "r3" },
  { path: "/leaderboard", label: "Leaderboard", short: "Ranks", from: "REVEAL_1", group: "night" },
  { path: "/bulletins", label: "News", short: "News", from: "SETUP", group: "night" },
  { path: "/judging", label: "How judging works", short: "Judging", from: "SETUP", group: "night" },
];

export const GROUP_LABELS: Record<SectionGroup, string> = {
  home: "Start",
  r1: "Round 1",
  r2: "Round 2",
  r3: "Round 3",
  night: "All night",
};

/** Sections in use now come first in the row; the rest keep their order (the row stays the same all night). */
export function sectionLive(section: TeamSection, phase: PhaseCode): boolean {
  return phaseReached(phase, section.from);
}

// ───────────────────────────── The stages of the night ─────────────────────────────

export interface Stage {
  key: StageKey;
  label: string;
  /** What the team does in it, in a few words. */
  hint: string;
  /** The first phase of the stage. */
  from: PhaseCode;
  /** The section to open for it. */
  href: string;
}

/**
 * The night as a team lives it: arrival, the three rounds and the results. A round runs from its first phase until
 * the next round starts, so its judging and its reveal stay with it (the PRD scores at 23:30 are still Round 1).
 */
export const STAGES: readonly Stage[] = [
  { key: "start", label: "Check-in", hint: "Arrive and get briefed", from: "SETUP", href: "/team" },
  { key: "r1", label: "Round 1 · Build", hint: "Write your PRD", from: "BUILD", href: "/team/build" },
  { key: "r2", label: "Round 2 · Rescue", hint: "Rescue a company", from: "CRISIS_QA", href: "/team/rescue" },
  { key: "r3", label: "Round 3 · Invest", hint: "Trade the market", from: "MARKET_BLIND", href: "/team/trade" },
  { key: "end", label: "Results", hint: "Closing bell and awards", from: "SETTLEMENT", href: "/team/leaderboard" },
];

/** The stage the night is in. */
export function currentStage(phase: PhaseCode): Stage {
  let found = STAGES[0]!;
  for (const s of STAGES) if (phaseIndex(phase) >= phaseIndex(s.from)) found = s;
  return found;
}

/** Whether a stage is over, under way or still ahead. */
export function stageState(stage: Stage, phase: PhaseCode): "done" | "now" | "next" {
  const now = currentStage(phase);
  if (stage.key === now.key) return "now";
  return STAGES.indexOf(stage) < STAGES.indexOf(now) ? "done" : "next";
}

/** True when the section belongs to the stage under way (its group is that round). */
export function sectionIsNow(section: TeamSection, phase: PhaseCode): boolean {
  return section.group === currentStage(phase).key;
}

/**
 * The phone's tab bar: Home, the current round's main section (or the market once Round 1 has its prices), the
 * market or the news, and the leaderboard; everything else sits under More. Always four sections, so the bar never
 * jumps in length.
 */
export function phoneTabs(phase: PhaseCode): TeamSection[] {
  const by = (path: string) => TEAM_SECTIONS.find((s) => s.path === path)!;
  const stage = currentStage(phase).key;
  const round = stage === "r1" ? "/build" : stage === "r2" ? "/rescue" : stage === "r3" || stage === "end" ? "/trade" : "/build";
  // In Round 2 the rescue chats are where teams talk; otherwise the market (or the news before it opens).
  const third = stage === "r2" && !phaseReached(phase, "JUDGING_2") ? "/chat" : phaseReached(phase, "REVEAL_1") ? "/market" : "/bulletins";
  const fourth = third === "/bulletins" ? "/judging" : "/leaderboard";
  return [by(""), by(round), by(third), by(fourth)];
}
