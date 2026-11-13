// The organisers' team list (Excel or CSV) → rows for the registration desk's roster.
//
// The sheet's first row is its header. Columns are recognised by name, in any order and any wording that contains:
//   team name  "team name" / "team"            track    "track" / "domain"
//   college    "college" / "institute" / "university"
//   email      "email" / "mail"                phone    "phone" / "mobile" / "contact" / "whatsapp"
//   a member   any other column with "name" (leader first, in the sheet's order); a "roll" column belongs to the name
//              column just before it.
// Every other column is kept as it is ("extra") and shown to the desk.

import { parseCsv } from "@msim/engine";
import { readXlsxRows } from "./xlsx";

export interface ListMember {
  full_name: string;
  roll_number: string | null;
}

export interface ListRow {
  team_name: string;
  track: string | null;
  college: string | null;
  email: string | null;
  phone: string | null;
  members: ListMember[];
  extra: Record<string, string>;
}

export type ListResult = { ok: true; rows: ListRow[]; skipped: number } | { ok: false; message: string };

export const MAX_LIST_BYTES = 900 * 1024;

type Role = { kind: "team" | "track" | "college" | "email" | "phone" | "extra" } | { kind: "name" | "roll"; member: number };

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** What each header column holds. */
export function headerRoles(header: string[]): Role[] {
  let members = 0;
  let hasTeam = false;
  return header.map((raw) => {
    const h = norm(raw);
    if (!hasTeam && (/\bteam\b.*\bname\b/.test(h) || h === "team" || h === "team name")) {
      hasTeam = true;
      return { kind: "team" };
    }
    if (/\b(track|domain)\b/.test(h)) return { kind: "track" };
    if (/\b(college|institute|institution|university)\b/.test(h) && !/\bname\b.*\b(member|leader|participant)\b/.test(h)) return { kind: "college" };
    if (/\b(e ?mail|mail)\b/.test(h)) return { kind: "email" };
    if (/\b(phone|mobile|contact|whatsapp)\b/.test(h)) return { kind: "phone" };
    if (/\broll\b/.test(h) && members > 0) return { kind: "roll", member: members - 1 };
    if (/\bname\b/.test(h) && members < 5) return { kind: "name", member: members++ };
    return { kind: "extra" };
  });
}

/** Rows of text (the header first) → team-list rows. Blank rows are skipped. */
export function teamListFromRows(rows: string[][]): ListResult {
  const header = rows[0] ?? [];
  const roles = headerRoles(header);
  if (!roles.some((r) => r.kind === "team")) {
    return { ok: false, message: "The first row must be the header, with a “Team name” column." };
  }
  const out: ListRow[] = [];
  let skipped = 0;
  for (const cells of rows.slice(1)) {
    const cell = (i: number) => (cells[i] ?? "").trim();
    if (cells.every((c) => (c ?? "").trim() === "")) continue;
    const row: ListRow = { team_name: "", track: null, college: null, email: null, phone: null, members: [], extra: {} };
    const members: ListMember[] = [];
    roles.forEach((r, i) => {
      const v = cell(i);
      if (r.kind === "name") members[r.member] = { full_name: v, roll_number: members[r.member]?.roll_number ?? null };
      else if (r.kind === "roll") members[r.member] = { full_name: members[r.member]?.full_name ?? "", roll_number: v || null };
      else if (!v) return;
      else if (r.kind === "team") row.team_name = v.slice(0, 80);
      else if (r.kind === "extra") row.extra[(header[i] ?? `Column ${i + 1}`).trim() || `Column ${i + 1}`] = v;
      else row[r.kind === "track" ? "track" : r.kind] = v;
    });
    row.members = members.filter((m) => m && m.full_name !== "").map((m) => ({ full_name: m.full_name.slice(0, 120), roll_number: m.roll_number }));
    if (!row.team_name) {
      skipped++;
      continue;
    }
    out.push(row);
  }
  if (out.length === 0) return { ok: false, message: "The sheet has no teams under its header." };
  return { ok: true, rows: out, skipped };
}

/** An uploaded .xlsx or .csv file → team-list rows. */
export async function readTeamList(entry: unknown): Promise<ListResult> {
  if (!entry || typeof entry !== "object" || !("arrayBuffer" in entry) || !("name" in entry)) {
    return { ok: false, message: "Choose the team list file (.xlsx or .csv)." };
  }
  const file = entry as { name: string; size: number; arrayBuffer: () => Promise<ArrayBuffer> };
  if (!file.size) return { ok: false, message: "Choose the team list file (.xlsx or .csv)." };
  if (file.size > MAX_LIST_BYTES) return { ok: false, message: "The file is larger than 900 KB: delete unused sheets or columns and try again." };
  const bytes = new Uint8Array(await file.arrayBuffer());
  const name = file.name.toLowerCase();
  try {
    if (name.endsWith(".xlsx")) return teamListFromRows(readXlsxRows(bytes));
    if (name.endsWith(".csv")) return teamListFromRows(parseCsv(new TextDecoder("utf-8").decode(bytes).replace(/^﻿/, "")));
  } catch (e) {
    return { ok: false, message: `Could not read “${file.name}”: ${e instanceof Error ? e.message : String(e)}.` };
  }
  return { ok: false, message: `“${file.name}” is not an Excel (.xlsx) or .csv file. In Excel, use Save As → Excel Workbook.` };
}
