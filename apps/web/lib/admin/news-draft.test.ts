import { describe, expect, test } from "vitest";
import { newsPrompt, parseNewsDraft, takesServerFallback } from "./news-draft";

describe("news drafts", () => {
  test("the prompt lists the biggest movers first, in rupees, with the angle and recent headlines", () => {
    const p = newsPrompt({
      angle: "Energy shock",
      phase: "ROUND_3",
      companies: [
        { ticker: "SLOW", name: "Slow Co", sector: "FMCG", open: 10000, now: 10100 },
        { ticker: "BOOM", name: "Boom Ltd", sector: "Energy", open: 10000, now: 15000 },
        { ticker: "NONE", name: "No price", sector: null, open: null, now: null },
      ],
      recentTitles: ["Markets open"],
    });
    expect(p).toContain("<angle>Energy shock</angle>");
    expect(p.indexOf("BOOM")).toBeLessThan(p.indexOf("SLOW"));
    expect(p).toContain("BOOM | Boom Ltd | Energy | ₹150 | +50.0% since opening");
    expect(p).not.toContain("NONE");
    expect(p).toContain("Markets open");
  });

  test("a draft must be valid JSON of the right kind and fit the composer", () => {
    expect(parseNewsDraft('{"kind":"GENERAL","title":" Energy rallies ","body":"BOOM is up 50%."}')).toEqual({ kind: "GENERAL", title: "Energy rallies", body: "BOOM is up 50%." });
    expect(parseNewsDraft('{"kind":"FLASH","title":"x","body":"y"}')).toBeNull();
    expect(parseNewsDraft(`{"kind":"GENERAL","title":"${"x".repeat(200)}","body":""}`)).toBeNull();
    expect(parseNewsDraft("not json")).toBeNull();
  });

  test("the refusal fallback is asked for only on models that take it", () => {
    expect(takesServerFallback("claude-opus-5-5")).toBe(true);
    expect(takesServerFallback("claude-sonnet-5-5")).toBe(true);
    expect(takesServerFallback("claude-haiku-5-5")).toBe(false);
    expect(takesServerFallback("claude-opus-4-8")).toBe(false);
  });
});
