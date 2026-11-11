import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { pairViews, pairsFromRows, pairsTemplate, readPairsUpload, withSheetRows } from "./rescue-pairs";
import { readXlsxRows } from "./xlsx";

const fixture = (name: string) => new Uint8Array(readFileSync(new URL(`./fixtures/${name}`, import.meta.url)));
const file = (name: string, bytes: Uint8Array) => ({
  name,
  size: bytes.length,
  type: "",
  text: async () => new TextDecoder().decode(bytes),
  arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
});

const ROWS = [
  ["Rescuing team", "Rescues the company of"],
  ["T001", "T002"],
  ["t002", "T003"],
  [],
  ["T003", "T001"],
  ["T004"],
  ["T005", "R&D <Co>"],
];
const padded = (rows: string[][]) => rows.map((r) => [r[0] ?? "", r[1] ?? ""]);

describe("reading an Excel workbook", () => {
  test.each(["pairs-openpyxl.xlsx", "pairs-xlsxwriter.xlsx", "pairs-libreoffice.xlsx"])("%s: the first sheet's rows, in place, as text", (name) => {
    const rows = readXlsxRows(fixture(name));
    expect(padded(rows.slice(0, 7))).toEqual(padded(ROWS));
  });

  test("a number cell is read as its text; what is not a workbook is refused", () => {
    expect(readXlsxRows(fixture("pairs-xlsxwriter.xlsx"))[7]).toEqual(["7", "T001"]);
    expect(() => readXlsxRows(new TextEncoder().encode("T001,T002\n"))).toThrow(/not an Excel workbook/);
    const cut = fixture("pairs-openpyxl.xlsx").slice(0, 2000);
    expect(() => readXlsxRows(cut)).toThrow();
  });
});

describe("rescue pairs from a sheet", () => {
  test("header skipped, codes upper-cased, blank rows skipped, a team without a company left to the lottery", () => {
    const r = pairsFromRows(ROWS);
    expect(r).toEqual({
      ok: true,
      value: {
        pairs: [
          { rescuer: "T001", founder: "T002" },
          { rescuer: "T002", founder: "T003" },
          { rescuer: "T003", founder: "T001" },
          { rescuer: "T005", founder: "R&D <CO>" },
        ],
        rows: [2, 3, 5, 7],
        left: 1,
      },
    });
  });

  test("no header is fine; an empty rescuing team or an empty sheet is refused", () => {
    expect(pairsFromRows([["d001", "d002"]])).toMatchObject({ ok: true, value: { pairs: [{ rescuer: "D001", founder: "D002" }], rows: [1] } });
    expect(pairsFromRows([["Team", "Company"], ["", "T002"]])).toEqual({ ok: false, message: "Row 2: the rescuing team (column A) is empty." });
    expect(pairsFromRows([["Team", "Company"], ["T001", ""]])).toMatchObject({ ok: false });
    expect(pairsFromRows([])).toMatchObject({ ok: false });
  });

  test("an upload: .xlsx and .csv give the same pairs; .xls and other files are refused with a reason", async () => {
    const xlsx = await readPairsUpload(file("pairs.xlsx", fixture("pairs-openpyxl.xlsx")));
    const csv = await readPairsUpload(file("pairs.csv", new TextEncoder().encode('﻿Rescuing team,Rescues the company of\r\nT001,T002\r\nt002,"T003 "\r\n,\r\nT003,T001\r\nT004,\r\nT005,R&D <Co>\r\n')));
    expect(xlsx).toMatchObject({ ok: true, value: { rows: [2, 3, 5, 7], left: 1 } });
    // The CSV reader drops blank lines, so only the row numbers after one differ.
    expect(csv).toMatchObject({ ok: true, value: { pairs: (xlsx as { value: { pairs: unknown } }).value.pairs, left: 1 } });
    expect(await readPairsUpload(file("old.xls", new Uint8Array([0xd0, 0xcf, 0x11, 0xe0])))).toMatchObject({ ok: false, message: expect.stringMatching(/old Excel file/) });
    expect(await readPairsUpload(file("x.bin", new Uint8Array([1, 0, 2])))).toMatchObject({ ok: false });
    expect(await readPairsUpload(file("bad.xlsx", new Uint8Array([0x50, 0x4b, 3, 4, 0, 0])))).toMatchObject({ ok: false, message: expect.stringMatching(/could not be read/) });
    expect(await readPairsUpload(null)).toMatchObject({ ok: false });
    expect(await readPairsUpload(file("big.csv", new Uint8Array(1024 * 1024 + 1)))).toMatchObject({ ok: false, message: expect.stringMatching(/limit/) });
  });

  test("the database's row numbers become the sheet's", () => {
    expect(withSheetRows(["Row 1: there is no team ZZ99.", "Row 3: T003 cannot rescue its own company.", "Something else"], [2, 3, 5])).toEqual([
      "Row 2: there is no team ZZ99.",
      "Row 5: T003 cannot rescue its own company.",
      "Something else",
    ]);
  });

  test("the template lists every team, with the pairs already set", () => {
    expect(pairsTemplate(["T002", "T001"], new Map([["T001", "T002"]]))).toBe("Rescuing team,Rescues the company of\r\nT001,T002\r\nT002,\r\n");
  });

  test("pairs to show, by rescuing team", () => {
    const teams = [
      { id: "1", code: "T001", name: "One", status: "ACTIVE" },
      { id: "2", code: "T002", name: "Two", status: "ACTIVE" },
    ];
    const views = pairViews(teams, [{ rescuer_team_id: "2", founder_team_id: "1" }, { rescuer_team_id: "1", founder_team_id: "2" }, { rescuer_team_id: "9", founder_team_id: "1" }], (c) => c === "T001");
    expect(views.map((v) => `${v.rescuer.code}>${v.founder.code}${v.fixed ? "*" : ""}`)).toEqual(["T001>T002*", "T002>T001"]);
  });
});
