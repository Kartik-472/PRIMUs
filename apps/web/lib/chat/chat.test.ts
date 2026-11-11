import { describe, expect, it } from "vitest";
import { author, chatState, mergeMessages, messageCheck, type ChatMessage } from "./chat";

const msg = (id: string, at: string, from_rescuer = false): ChatMessage => ({ id, company_id: "c", sender_team_id: "t", from_rescuer, body: id, created_at: at });

describe("rescue chats", () => {
  const base = { crisisApplied: true, phase: "CRISIS_QA" as const, paused: false, solutionLock: "2026-11-20T20:15:00Z", nowMs: Date.parse("2026-11-20T19:00:00Z") };

  it("opens at the crisis and closes at the solution lock, a pause or after Rescue", () => {
    expect(chatState({ ...base, crisisApplied: false })).toBe("NOT_YET");
    expect(chatState(base)).toBe("OPEN");
    expect(chatState({ ...base, phase: "RESCUE" })).toBe("OPEN");
    expect(chatState({ ...base, paused: true })).toBe("CLOSED");
    expect(chatState({ ...base, phase: "JUDGING_2" })).toBe("CLOSED");
    expect(chatState({ ...base, nowMs: Date.parse("2026-11-20T20:16:00Z") })).toBe("CLOSED");
  });

  it("checks the length after trimming, in characters", () => {
    expect(messageCheck("   ").ok).toBe(false);
    expect(messageCheck("héllo").chars).toBe(5);
    expect(messageCheck("x".repeat(501)).ok).toBe(false);
    expect(messageCheck("x".repeat(601), 600).ok).toBe(false);
  });

  it("merges messages oldest first without repeats", () => {
    const a = msg("a", "2026-11-20T19:00:01Z");
    const b = msg("b", "2026-11-20T19:00:02Z");
    expect(mergeMessages([b, a], [a]).map((m) => m.id)).toEqual(["a", "b"]);
  });

  it("names the author as the reader sees it", () => {
    const sides = { rescuer: "T002", founder: "T001" };
    expect(author({ from_rescuer: true }, sides, "RESCUER")).toBe("You");
    expect(author({ from_rescuer: false }, sides, "RESCUER")).toBe("T001 (founder)");
    expect(author({ from_rescuer: false }, sides, "FOUNDER")).toBe("You");
    expect(author({ from_rescuer: true }, sides, "STAFF")).toBe("T002 (rescuer)");
  });
});
