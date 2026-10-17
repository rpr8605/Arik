'use client';

// Shared by the patient home screens (Phase 7 P1): an authed fetch, date
// and money words, and a PDF download that keeps the bytes exactly as
// served (a frozen copy is byte-identical every time).

import { supabaseBrowser } from '@/lib/supabaseBrowser';

export async function homeApi(path: string) {
  const { data: { session } } = await supabaseBrowser().auth.getSession();
  return fetch(path, { headers: { Authorization: `Bearer ${session?.access_token ?? ''}` } });
}

export const usDate = (iso: string) => new Date(`${iso.slice(0, 10)}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
export const usd = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 })}`;

export async function downloadPdf(path: string, filename: string) {
  const res = await homeApi(path);
  if (!res.ok) throw new Error('Could not download the PDF. Try again.');
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
