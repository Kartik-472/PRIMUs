import { describe, expect, test } from "vitest";
import { STAGES, TEAM_SECTIONS, currentStage, phoneTabs, sectionIsNow, sectionLive, stageState } from "./sections";

describe("team sections", () => {
  test("every team has the same sections, in the order of the night", () => {
    expect(TEAM_SECTIONS.map((s) => s.label)).toEqual([
      "Home",
      "Round 1: PRD",
      "Round 2: Rescue",
      "Q&A",
      "Rescue chats",
      "Market",
      "Round 3: Trade",
      "Ledger",
      "Leaderboard",
      "News",
      "How judging works",
    ]);
  });

  test("a section is live from its phase on", () => {
    const trade = TEAM_SECTIONS.find((s) => s.path === "/trade")!;
    expect(sectionLive(trade, "RESCUE")).toBe(false);
    expect(sectionLive(trade, "MARKET_BLIND")).toBe(true);
    expect(sectionLive(TEAM_SECTIONS[0]!, "SETUP")).toBe(true);
  });
});

describe("stages of the night", () => {
  test("each phase belongs to one stage; a round keeps its judging and reveal", () => {
    expect(currentStage("SETUP").key).toBe("start");
    expect(currentStage("BRIEFING").key).toBe("start");
    expect(currentStage("BUILD").key).toBe("r1");
    expect(currentStage("REVEAL_1").key).toBe("r1");
    expect(currentStage("CRISIS_QA").key).toBe("r2");
    expect(currentStage("JUDGING_2").key).toBe("r2");
    expect(currentStage("MARKET").key).toBe("r3");
    expect(currentStage("AWARDS").key).toBe("end");
  });

  test("stages before the current one are done, after it are ahead", () => {
    const [start, r1, r2] = STAGES;
    expect(stageState(start!, "RESCUE")).toBe("done");
    expect(stageState(r2!, "RESCUE")).toBe("now");
    expect(stageState(r1!, "SETUP")).toBe("next");
  });

  test("the sections of the round under way are marked as now", () => {
    const rescue = TEAM_SECTIONS.find((s) => s.path === "/rescue")!;
    expect(sectionIsNow(rescue, "RESCUE")).toBe(true);
    expect(sectionIsNow(rescue, "MARKET")).toBe(false);
  });

  test("the phone shows four tabs, the round under way second", () => {
    expect(phoneTabs("SETUP").map((s) => s.short)).toEqual(["Home", "PRD", "News", "Judging"]);
    expect(phoneTabs("RESCUE").map((s) => s.short)).toEqual(["Home", "Rescue", "Chats", "Ranks"]);
    expect(phoneTabs("JUDGING_2").map((s) => s.short)).toEqual(["Home", "Rescue", "Market", "Ranks"]);
    expect(phoneTabs("MARKET").map((s) => s.short)).toEqual(["Home", "Trade", "Market", "Ranks"]);
  });
});
