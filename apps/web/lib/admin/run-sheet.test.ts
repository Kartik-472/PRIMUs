import { describe, expect, test } from "vitest";
import { buildSchedule } from "@msim/engine";
import { buildRunSheet, phaseName, type SheetPhase } from "./run-sheet";

const start = new Date("2026-11-20T14:30:00Z"); // 20:00 IST
const sched = buildSchedule(start, 1, "PRIMUS");
const phasesAt = (current: string, startedAt: string): SheetPhase[] =>
  sched.phases.map((p) => ({
    ...p,
    started_at: p.seq <= sched.phases.find((x) => x.code === current)!.seq ? startedAt : null,
    ended_at: p.seq < sched.phases.find((x) => x.code === current)!.seq ? startedAt : null,
  }));
const at = (code: string) => new Date(sched.deadlines.find((d) => d.code === code)!.at).getTime();

describe("run sheet", () => {
  test("PRIMUS stages, with Round 2 as four crises of four steps", () => {
    const { stages } = buildRunSheet({ now: start.getTime(), current: "SETUP", phases: phasesAt("SETUP", start.toISOString()), deadlines: sched.deadlines, subrounds: [] });
    expect(stages.map((s) => s.title)).toEqual(["Before the rounds", "Round 1: Build", "Round 2: Pressure", "Round 3: Saturation", "Finish"]);
    const r2 = stages.find((s) => s.key === "r2")!;
    expect(r2.groups.map((g) => g.title)).toEqual([null, "Crisis 1", "Crisis 2", "Crisis 3", "Crisis 4"]);
    expect(r2.groups[2]!.steps.map((s) => s.label)).toEqual(["Crisis 2 revealed", "Hiring closes", "Plans and memos due", "Ratings close"]);
    expect(stages[0]!.state).toBe("NOW");
    expect(r2.state).toBe("LATER");
  });

  test("only the next step of the current phase can be started now", () => {
    const now = at("REVEAL_1") + 60_000;
    const { stages, next } = buildRunSheet({
      now,
      current: "PRESSURE",
      phases: phasesAt("PRESSURE", new Date(at("REVEAL_1")).toISOString()),
      deadlines: sched.deadlines,
      subrounds: [{ k: 1, revealed_at: new Date(at("REVEAL_1")).toISOString(), hiring_closed_at: null, due_closed_at: null, rated_at: null }],
    });
    expect(next?.key).toBe("HIRE_1");
    expect(next?.movable).toBe(true);
    const all = stages.flatMap((s) => s.groups.flatMap((g) => g.steps));
    expect(all.filter((s) => s.movable).map((s) => s.key)).toEqual(["HIRE_1"]);
    expect(all.find((s) => s.key === "REVEAL_1")!.state).toBe("DONE");
    expect(all.find((s) => s.key === "phase:PRESSURE")!.state).toBe("NOW");
    expect(all.find((s) => s.key === "REVEAL_2")!.state).toBe("LATER");
    expect(stages.find((s) => s.key === "r1")!.state).toBe("DONE");
  });

  test("a crisis not yet revealed is the next step even when its time has passed (held)", () => {
    const now = at("REVEAL_2") + 30_000;
    const { next } = buildRunSheet({
      now,
      current: "PRESSURE",
      phases: phasesAt("PRESSURE", new Date(at("REVEAL_1")).toISOString()),
      deadlines: sched.deadlines.map((d) => (d.code === "REVEAL_2" ? { ...d, at: new Date(now + 120_000).toISOString() } : d)),
      subrounds: [{ k: 1, revealed_at: new Date(at("REVEAL_1")).toISOString(), hiring_closed_at: "x", due_closed_at: "x", rated_at: "x" }],
    });
    expect(next?.key).toBe("REVEAL_2");
    expect(next?.movable).toBe(true);
  });

  test("phase names", () => {
    expect(phaseName("PRESSURE")).toBe("Round 2: Pressure");
    expect(phaseName("ROUNDS_1_4")).toBe("Rounds 1 4");
  });
});
