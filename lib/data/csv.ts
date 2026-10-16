// Small RFC 4180 CSV parser (pure): quoted fields, doubled quotes, commas
// and newlines inside quotes, CRLF or LF. Returns header-keyed rows with
// their 1-based line number for error messages.

export function parseCsv(text: string): { header: string[]; rows: { line: number; values: Record<string, string> }[] } {
  const records: { line: number; cells: string[] }[] = [];
  let cell = '';
  let row: string[] = [];
  let inQuotes = false;
  let line = 1;
  let rowLine = 1;
  const s = text.replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inQuotes) {
      if (ch === '"' && s[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        if (ch === '\n') line++;
        cell += ch;
      }
      continue;
    }
    if (ch === '"') inQuotes = true;
    else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && s[i + 1] === '\n') i++;
      row.push(cell);
      if (row.some((c) => c.trim() !== '')) records.push({ line: rowLine, cells: row });
      row = [];
      cell = '';
      line++;
      rowLine = line;
    } else cell += ch;
  }
  if (cell !== '' || row.length) {
    row.push(cell);
    if (row.some((c) => c.trim() !== '')) records.push({ line: rowLine, cells: row });
  }
  if (records.length === 0) return { header: [], rows: [] };
  const header = records[0].cells.map((h) => h.trim());
  return {
    header,
    rows: records.slice(1).map((r) => ({ line: r.line, values: Object.fromEntries(header.map((h, i) => [h, (r.cells[i] ?? '').trim()])) })),
  };
}
