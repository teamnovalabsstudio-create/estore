/**
 * CSV for spreadsheets couriers' portals accept: UTF-8 with BOM (so Excel
 * shows Urdu/special characters correctly), CRLF line endings, RFC 4180
 * quoting, and formula-injection protection — a cell starting with = + - @
 * (or tab/CR) is prefixed with an apostrophe so Excel treats it as text.
 */

export type Cell = string | number | null | undefined;

const FORMULA_START = /^[=+\-@\t\r]/;

export function escapeCell(value: Cell): string {
  if (value == null) return "";
  let s = String(value);
  // Plain negative numbers are data, not formulas.
  if (typeof value !== "number" && FORMULA_START.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) || s !== s.trim() ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(headers: readonly string[], rows: readonly (readonly Cell[])[], opts: { bom?: boolean } = {}): string {
  const lines = [headers, ...rows].map((r) => r.map(escapeCell).join(","));
  return (opts.bom === false ? "" : "﻿") + lines.join("\r\n") + "\r\n";
}

/** Minimal RFC 4180 parser (quoted fields, escaped quotes, CRLF/LF, BOM). */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
    } else if (c === '"' && field === "") quoted = true;
    else if (c === "," || c === "\t") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((f) => f.trim() !== ""));
}
