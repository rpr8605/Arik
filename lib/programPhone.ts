// Which program phone number to show (2026-10-16). A number shows only when
// it was copied from the program's own page (exploits.support_phone, with
// the page in support_phone_source_url), and only for a program the
// ranking engine actually offers this patient: the best path first, then
// the other ongoing options, then one-time bridges. A blocked, pending or
// not-applicable row never lends its number. Used by the chat's "Call the
// program" button and the demo call card.

export interface ProgramPhone {
  number: string;
  program: string;
  sourceUrl: string | null;
  hours: string | null;
}

interface RankingLike {
  winner?: { title: string } | null;
  ranked?: { title: string }[];
  bridges?: { title: string }[];
}

export function pickProgramPhone(ranking: RankingLike | null | undefined, rows: any[]): ProgramPhone | null {
  if (!ranking) return null;
  const order = [ranking.winner?.title, ...(ranking.ranked ?? []).map((p) => p.title), ...(ranking.bridges ?? []).map((p) => p.title)];
  for (const title of order) {
    if (!title) continue;
    const row = (rows ?? []).find((r) => r?.title === title && typeof r.support_phone === 'string' && r.support_phone.trim() !== '');
    if (row) {
      return {
        number: row.support_phone.trim(),
        program: row.title,
        sourceUrl: row.support_phone_source_url ?? row.sources?.url ?? null,
        hours: row.support_phone_hours ?? null,
      };
    }
  }
  return null;
}
