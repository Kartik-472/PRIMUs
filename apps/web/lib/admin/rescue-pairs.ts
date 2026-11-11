// The organisers' rescue pairs: which team rescues which team's company in Round 2. A list comes from the form (one
// pair) or from a spreadsheet (.xlsx or .csv) with two columns: the rescuing team, then the team whose company it
// rescues. The database checks every pair again and names each bad row. Pure apart from reading the uploaded file.

import { parseCsv } from "@msim/engine";
import type { Parsed } from "./content";
import { readXlsxRows } from "./xlsx";

export interface RescuePair {
  /** The code of the team that rescues… */
  rescuer: string;
  /** …the company of this team. */
  founder: string;
}

export const PAIR_COLUMNS = ["Rescuing team", "Rescues the company of"] as const;
export const MAX_PAIRS_BYTES = 1024 * 1024;

/** A login-card code as people type it: T014, d3, X001. */
const CODE = /^[A-Za-z]{1,3}[0-9]{1,4}$/;
const clean = (s: string | undefined) => (s ?? "").trim().toUpperCase();

export interface SheetPairs {
  pairs: RescuePair[];
  /** The sheet row each pair came from (1 is the first row of the sheet), for messages. */
  rows: number[];
  /** Rows with a rescuing team but no company: left to the lottery. */
  left: number;
}

/**
 * The pairs in a sheet's rows: column A is the rescuing team, column B the team whose company it rescues. A first row
 * that is not a team code is the header. Empty rows are skipped; a row with a rescuing team and no company is left to
 * the lottery (so the downloaded template can be filled in part).
 */
export function pairsFromRows(sheet: readonly (readonly string[])[]): Parsed<SheetPairs> {
  const out: SheetPairs = { pairs: [], rows: [], left: 0 };
  let headerSeen = false;
  for (let i = 0; i < sheet.length; i++) {
    const a = clean(sheet[i]?.[0]);
    const b = clean(sheet[i]?.[1]);
    if (a === "" && b === "") continue;
    if (!headerSeen && out.pairs.length === 0 && out.left === 0 && !CODE.test(a)) {
      headerSeen = true;
      continue;
    }
    if (a === "") return { ok: false, message: `Row ${i + 1}: the rescuing team (column A) is empty.` };
    if (b === "") {
      out.left++;
      continue;
    }
    out.pairs.push({ rescuer: a, founder: b });
    out.rows.push(i + 1);
  }
  if (out.pairs.length === 0) {
    return { ok: false, message: `The sheet has no pairs. Put the rescuing team's code in column A and the code of the team whose company it rescues in column B.` };
  }
  return { ok: true, value: out };
}

interface UploadedFile {
  name: string;
  size: number;
  type: string;
  text(): Promise<string>;
  arrayBuffer(): Promise<ArrayBuffer>;
}

const isFile = (v: unknown): v is UploadedFile =>
  typeof v === "object" && v !== null && typeof (v as UploadedFile).arrayBuffer === "function" && typeof (v as UploadedFile).size === "number";

/** The pairs in the spreadsheet chosen in a form's file input (.xlsx or .csv). */
export async function readPairsUpload(entry: unknown): Promise<Parsed<SheetPairs>> {
  if (!isFile(entry) || entry.size === 0) return { ok: false, message: "Choose an Excel (.xlsx) or CSV file to upload." };
  if (entry.size > MAX_PAIRS_BYTES) {
    return { ok: false, message: `The file is ${Math.ceil(entry.size / 1024)} KB; the limit is ${MAX_PAIRS_BYTES / 1024} KB.` };
  }
  const bytes = new Uint8Array(await entry.arrayBuffer());
  // A zip archive (.xlsx) starts with "PK"; the old .xls format starts with D0 CF.
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) {
    try {
      return pairsFromRows(readXlsxRows(bytes));
    } catch (err) {
      return { ok: false, message: `“${entry.name}” could not be read: ${err instanceof Error ? err.message : "it is not an Excel workbook"}.` };
    }
  }
  if (bytes[0] === 0xd0 && bytes[1] === 0xcf) {
    return { ok: false, message: `“${entry.name}” is an old Excel file (.xls). Save it as an Excel workbook (.xlsx) or as CSV and upload that.` };
  }
  const text = new TextDecoder("utf-8").decode(bytes);
  if (text.includes("\u0000")) return { ok: false, message: `“${entry.name}” is not an Excel workbook (.xlsx) or a CSV file.` };
  try {
    return pairsFromRows(parseCsv(text));
  } catch (err) {
    return { ok: false, message: `“${entry.name}” could not be read as CSV: ${err instanceof Error ? err.message : "bad file"}.` };
  }
}

/** "Row 3: …" in the database's list counts pairs; the organiser needs the sheet's own row numbers. */
export function withSheetRows(problems: readonly string[], rows: readonly number[]): string[] {
  return problems.map((p) => p.replace(/^Row (\d+):/, (all, n: string) => (rows[Number(n) - 1] ? `Row ${rows[Number(n) - 1]}:` : all)));
}

/** A CSV to fill in: one row per team that plays, the company column empty. */
export function pairsTemplate(codes: readonly string[], set: ReadonlyMap<string, string> = new Map()): string {
  const lines = [PAIR_COLUMNS.join(","), ...[...codes].sort().map((c) => `${c},${set.get(c) ?? ""}`)];
  return `${lines.join("\r\n")}\r\n`;
}

export interface PairTeam {
  id: string;
  code: string;
  name: string;
  status: string;
}

export interface PairView {
  rescuer: PairTeam;
  founder: PairTeam;
  /** Fixed by an organiser (otherwise drawn by the lottery). */
  fixed: boolean;
}

/** The pairs to show, by the rescuing team's code. */
export function pairViews(teams: readonly PairTeam[], pairs: readonly { rescuer_team_id: string; founder_team_id: string }[], fixed: (rescuerCode: string) => boolean): PairView[] {
  const byId = new Map(teams.map((t) => [t.id, t]));
  return pairs
    .flatMap((p) => {
      const rescuer = byId.get(p.rescuer_team_id);
      const founder = byId.get(p.founder_team_id);
      return rescuer && founder ? [{ rescuer, founder, fixed: fixed(rescuer.code) }] : [];
    })
    .sort((a, b) => (a.rescuer.code < b.rescuer.code ? -1 : 1));
}
