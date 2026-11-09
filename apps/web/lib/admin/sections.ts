// The control panel's sections, grouped by what an organiser is doing (running the night, scoring, what the teams
// read, the records), and the one section the phase under way needs most, so the console points at it.

import type { PhaseCode } from "@msim/engine";

export type AdminGroup = "run" | "score" | "content" | "records";

export interface AdminSection {
  path: string;
  label: string;
  group: AdminGroup;
}

export const ADMIN_GROUPS: Record<AdminGroup, string> = {
  run: "Run the night",
  score: "Scores",
  content: "What teams read",
  records: "Records",
};

export const ADMIN_SECTIONS: readonly AdminSection[] = [
  { path: "", label: "Phase", group: "run" },
  { path: "/timing", label: "Timing", group: "run" },
  { path: "/signups", label: "Sign-ups", group: "run" },
  { path: "/teams", label: "Registration desk", group: "run" },
  { path: "/lottery", label: "Lottery", group: "run" },
  { path: "/rounds", label: "Rounds", group: "run" },
  { path: "/judge", label: "Judge", group: "score" },
  { path: "/results", label: "Results", group: "score" },
  { path: "/fairness", label: "Fairness", group: "score" },
  { path: "/bulletins", label: "Bulletins", group: "content" },
  { path: "/content", label: "Content", group: "content" },
  { path: "/ledger", label: "Ledger", group: "records" },
  { path: "/exports", label: "Exports", group: "records" },
  { path: "/health", label: "Health", group: "records" },
  { path: "/access", label: "Access", group: "records" },
];

/**
 * The section the phase needs: the draws in the briefing (21:15) and at the crisis (23:45), the judge while a round
 * is judged, the rounds while the market trades, the fairness flags at settlement (fairness officer) and the results
 * at the end; otherwise the phase controls.
 */
export function adminFocus(phase: PhaseCode, fairness = false): string {
  switch (phase) {
    case "BRIEFING":
    case "CRISIS_QA":
      return "/lottery";
    case "JUDGING_1":
    case "JUDGING_2":
      return "/judge";
    case "MARKET_BLIND":
    case "MARKET":
      return "/rounds";
    case "SETTLEMENT":
      return fairness ? "/fairness" : "/results";
    case "AWARDS":
      return "/results";
    default:
      return "";
  }
}
