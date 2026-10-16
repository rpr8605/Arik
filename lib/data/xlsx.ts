// Minimal XLSX sheet reader (pure): turns a sheet's XML plus the
// workbook's sharedStrings XML into rows of cell text keyed by column
// letter. Enough for CMS public-use files (plain cells, shared strings,
// inline strings); no formulas, styles or dates are interpreted. The
// loader unzips the .xlsx (it is a zip of XML files) and passes the text.

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
export function unescapeXml(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e] ?? m;
  });
}

export function parseSharedStrings(xml: string): string[] {
  return [...xml.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) =>
    unescapeXml([...m[1].matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join('')),
  );
}

export type SheetRow = Record<string, string | null>;

export function parseSheetRows(xml: string, shared: string[]): SheetRow[] {
  const rows: SheetRow[] = [];
  for (const r of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const cells: SheetRow = {};
    for (const c of r[1].matchAll(/<c\s+r="([A-Z]+)\d+"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const [, col, attrs, body = ''] = c;
      const type = /\bt="(\w+)"/.exec(attrs)?.[1];
      let val: string | null = null;
      if (type === 'inlineStr') {
        const t = /<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/.exec(body);
        val = t ? unescapeXml(t[1]) : null;
      } else {
        const v = /<v>([\s\S]*?)<\/v>/.exec(body);
        if (v) val = type === 's' ? shared[Number(v[1])] ?? null : unescapeXml(v[1]);
      }
      cells[col] = val;
    }
    rows.push(cells);
  }
  return rows;
}

// Rows -> objects using the first row whose cells match `headerProbe`.
// Fully blank rows (spreadsheets often carry formatted empty rows at the
// bottom) are dropped: they are not records.
export function rowsToObjects(rows: SheetRow[], headerProbe: (r: SheetRow) => boolean): Record<string, string | null>[] {
  const hi = rows.findIndex(headerProbe);
  if (hi < 0) return [];
  const header = rows[hi];
  return rows
    .slice(hi + 1)
    .map((r) => Object.fromEntries(Object.entries(header).filter(([, h]) => h).map(([col, h]) => [String(h).trim(), r[col] ?? null])))
    .filter((o) => Object.values(o).some((v) => v != null && String(v).trim() !== ''));
}
