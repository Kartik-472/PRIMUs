import { describe, expect, test } from "vitest";
import { ADMIN_GROUPS, ADMIN_SECTIONS, adminFocus } from "./sections";

describe("control panel sections", () => {
  test("every section is in a group and every focus is a section", () => {
    for (const s of ADMIN_SECTIONS) expect(ADMIN_GROUPS[s.group]).toBeTruthy();
    const paths = ADMIN_SECTIONS.map((s) => s.path);
    for (const p of ["SETUP", "BRIEFING", "BUILD", "JUDGING_1", "CRISIS_QA", "MARKET", "SETTLEMENT", "AWARDS"] as const) {
      expect(paths).toContain(adminFocus(p));
      expect(paths).toContain(adminFocus(p, true));
    }
  });

  test("the console points at what the phase needs", () => {
    expect(adminFocus("SETUP")).toBe("");
    expect(adminFocus("BRIEFING")).toBe("/lottery");
    expect(adminFocus("CRISIS_QA")).toBe("/lottery");
    expect(adminFocus("RESCUE")).toBe("/tickets");
    expect(adminFocus("JUDGING_2")).toBe("/judge");
    expect(adminFocus("MARKET")).toBe("/rounds");
    expect(adminFocus("SETTLEMENT")).toBe("/results");
    expect(adminFocus("SETTLEMENT", true)).toBe("/fairness");
  });
});
