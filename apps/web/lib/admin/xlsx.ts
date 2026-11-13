// Reads the first sheet of an Excel workbook (.xlsx) as rows of text, on the server, with nothing but Node's zlib: an
// .xlsx file is a zip of XML files. Only what a plain list needs is read (cell text and numbers; no dates, styles or
// formulas beyond their stored result). Used for the rescue pairs upload.

import { inflateRawSync } from "node:zlib";

const MAX_ENTRY_BYTES = 8 * 1024 * 1024;

const u16 = (b: Uint8Array, o: number) => b[o]! | (b[o + 1]! << 8);
const u32 = (b: Uint8Array, o: number) => (b[o]! | (b[o + 1]! << 8) | (b[o + 2]! << 16) | (b[o + 3]! << 24)) >>> 0;

/** The files of a zip archive by name, each unpacked on demand. */
function zipEntries(bytes: Uint8Array): Map<string, () => string> {
  // The end-of-central-directory record is the last 22 bytes, or earlier when the archive has a comment.
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 65535); i--) {
    if (u32(bytes, i) === 0x06054b50) {
      end = i;
      break;
    }
  }
  if (end < 0) throw new Error("not an Excel workbook (.xlsx)");
  const count = u16(bytes, end + 10);
  let at = u32(bytes, end + 16);
  const entries = new Map<string, () => string>();
  const decoder = new TextDecoder("utf-8");
  for (let n = 0; n < count; n++) {
    if (at + 46 > bytes.length || u32(bytes, at) !== 0x02014b50) throw new Error("the workbook is damaged");
    const method = u16(bytes, at + 10);
    const packed = u32(bytes, at + 20);
    const size = u32(bytes, at + 24);
    const nameLength = u16(bytes, at + 28);
    const local = u32(bytes, at + 42);
    const name = decoder.decode(bytes.subarray(at + 46, at + 46 + nameLength));
    entries.set(name, () => {
      if (size > MAX_ENTRY_BYTES) throw new Error("the workbook is too large");
      if (local + 30 > bytes.length || u32(bytes, local) !== 0x04034b50) throw new Error("the workbook is damaged");
      const start = local + 30 + u16(bytes, local + 26) + u16(bytes, local + 28);
      const data = bytes.subarray(start, start + packed);
      if (method === 0) return decoder.decode(data);
      if (method === 8) return decoder.decode(inflateRawSync(data, { maxOutputLength: MAX_ENTRY_BYTES }));
      throw new Error("the workbook uses a compression this page cannot read");
    });
    at += 46 + nameLength + u16(bytes, at + 30) + u16(bytes, at + 32);
  }
  return entries;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
const unescape = (s: string) =>
  s.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-z]+);/g, (all, e: string) =>
    e[0] === "#" ? String.fromCodePoint(e[1] === "x" ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : (ENTITIES[e] ?? all),
  );

/** The text of every <t> in a string item (a rich string has several runs), leaving out phonetic guides. */
const textOf = (xml: string) => [...xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, "").matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((m) => unescape(m[1]!)).join("");

const attr = (tag: string, name: string) => new RegExp(`\\b${name}="([^"]*)"`).exec(tag)?.[1];

/** "A" → 0, "B" → 1, "AA" → 26. */
const column = (ref: string) => [...ref.replace(/[^A-Z]/g, "")].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;

/**
 * The rows of the workbook's first sheet, each a list of cell texts (empty cells are ""). Rows keep their place: a
 * blank row in the sheet is an empty row here, so row 5 of the sheet is rows[4].
 */
export function readXlsxRows(bytes: Uint8Array): string[][] {
  const files = zipEntries(bytes);
  const read = (name: string) => files.get(name)?.() ?? null;

  // The first sheet in the workbook's own order, found through its relationship; else the usual name.
  let sheetPath = "xl/worksheets/sheet1.xml";
  const workbook = read("xl/workbook.xml");
  const rels = read("xl/_rels/workbook.xml.rels");
  const first = workbook ? /<sheet\b[^>]*>/.exec(workbook)?.[0] : undefined;
  const rid = first ? attr(first, "r:id") : undefined;
  if (rid && rels) {
    const rel = [...rels.matchAll(/<Relationship\b[^>]*>/g)].map((m) => m[0]).find((r) => attr(r, "Id") === rid);
    const target = rel ? attr(rel, "Target") : undefined;
    if (target) sheetPath = target.startsWith("/") ? target.slice(1) : `xl/${target}`;
  }
  const sheet = read(sheetPath);
  if (sheet === null) throw new Error("the workbook has no sheet");

  const shared = [...(read("xl/sharedStrings.xml") ?? "").matchAll(/<si\b[^>]*?(?:\/>|>([\s\S]*?)<\/si>)/g)].map((m) => textOf(m[1] ?? ""));
  const rows: string[][] = [];
  for (const r of sheet.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const index = Number(attr(r[1]!, "r") ?? rows.length + 1) - 1;
    if (!Number.isInteger(index) || index < 0 || index > 100_000) throw new Error("the sheet has too many rows");
    const cells: string[] = [];
    let next = 0;
    for (const c of (r[2] ?? "").matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const ref = attr(c[1]!, "r");
      const col = ref ? column(ref) : next;
      next = col + 1;
      if (col < 0 || col > 255) continue;
      const type = attr(c[1]!, "t");
      const body = c[2] ?? "";
      const v = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(body)?.[1];
      const text = type === "inlineStr" ? textOf(body) : v === undefined ? "" : type === "s" ? (shared[Number(v)] ?? "") : unescape(v);
      while (cells.length < col) cells.push("");
      cells[col] = text.trim();
    }
    while (rows.length < index) rows.push([]);
    rows[index] = cells;
  }
  return rows;
}
