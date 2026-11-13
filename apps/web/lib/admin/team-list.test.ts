import { describe, expect, test } from "vitest";
import { headerRoles, readTeamList, teamListFromRows } from "./team-list";

const file = (name: string, text: string) => {
  const bytes = new TextEncoder().encode(text);
  return { name, size: bytes.length, arrayBuffer: async () => bytes.buffer.slice(0) as ArrayBuffer };
};

describe("the team list sheet", () => {
  test("columns are found by their names, members in order with their roll numbers", () => {
    expect(headerRoles(["S.No", "Team Name", "Track", "College", "Leader Name", "Leader Roll No", "Leader Email", "Leader Phone", "Member 2 Name", "Member 2 Roll No"])).toEqual([
      { kind: "extra" },
      { kind: "team" },
      { kind: "track" },
      { kind: "college" },
      { kind: "name", member: 0 },
      { kind: "roll", member: 0 },
      { kind: "email" },
      { kind: "phone" },
      { kind: "name", member: 1 },
      { kind: "roll", member: 1 },
    ]);
  });

  test("rows become teams; blank rows and rows without a team name are skipped", () => {
    const r = teamListFromRows([
      ["S.No", "Team Name", "Track", "Leader Name", "Leader Roll No", "Phone", "Member 2 Name", "Member 2 Roll No", "Member 3 Name"],
      ["1", "Alpha", "Product", "Asha", "1021", "98765", "Bilal", "1022", ""],
      [],
      ["2", "", "Finance", "Nobody"],
      ["3", "Beta", "", "Chen", "", "", "", "", "Dev"],
    ]);
    expect(r).toEqual({
      ok: true,
      skipped: 1,
      rows: [
        {
          team_name: "Alpha",
          track: "Product",
          college: null,
          email: null,
          phone: "98765",
          members: [
            { full_name: "Asha", roll_number: "1021" },
            { full_name: "Bilal", roll_number: "1022" },
          ],
          extra: { "S.No": "1" },
        },
        {
          team_name: "Beta",
          track: null,
          college: null,
          email: null,
          phone: null,
          members: [
            { full_name: "Chen", roll_number: null },
            { full_name: "Dev", roll_number: null },
          ],
          extra: { "S.No": "3" },
        },
      ],
    });
  });

  test("a sheet without a team name column, or without teams, is refused", () => {
    expect(teamListFromRows([["Name", "Phone"], ["A", "1"]])).toMatchObject({ ok: false });
    expect(teamListFromRows([["Team name"]])).toMatchObject({ ok: false });
  });

  test("a .csv upload is read; other files are refused", async () => {
    expect(await readTeamList(file("teams.csv", "Team name,Leader name\nAlpha,Asha\n"))).toMatchObject({ ok: true, rows: [{ team_name: "Alpha" }] });
    expect(await readTeamList(file("teams.pdf", "x"))).toMatchObject({ ok: false });
    expect(await readTeamList(null)).toMatchObject({ ok: false });
  });
});

describe("Excel workbooks", () => {
  test.each(["pairs-openpyxl.xlsx", "pairs-libreoffice.xlsx"])("%s (shared strings) is read as rows of text", async (name) => {
    const { readFileSync } = await import("node:fs");
    const { readXlsxRows } = await import("./xlsx");
    const rows = readXlsxRows(new Uint8Array(readFileSync(new URL(`./fixtures/${name}`, import.meta.url))));
    expect(rows[0]).toEqual(["Rescuing team", "Rescues the company of"]);
    expect(rows[1]).toEqual(["T001", "T002"]);
  });
});
