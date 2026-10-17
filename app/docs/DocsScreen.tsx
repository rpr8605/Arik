'use client';

// Documents (Phase 7 P1): From you / From Arik. Letters show Draft, Final
// copy, Final signed, Sent, or Practice send; a final copy downloads exactly
// as saved, with its SHA-256 fingerprint. Uploads note the 48-hour removal
// of the original file.

import { useEffect, useState } from 'react';
import { homeApi } from '../home/homeApi';
import { BottomNav } from '../home/BottomNav';
import { DocLine } from '../jobs/[id]/JobScreen';

type Doc = { id: string; caseId: string; from: 'you' | 'arik'; title: string; job: string; at: string; status: string; pdf: 'letter' | 'signed' | null; sha256: string | null; note: string | null };

export function DocsScreen() {
  const [docs, setDocs] = useState<Doc[] | null>(null);
  const [tab, setTab] = useState<'arik' | 'you'>('arik');
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    homeApi('/api/documents')
      .then(async (r) => (r.ok ? setDocs((await r.json()).documents) : setError('Could not load your documents.')))
      .catch(() => setError('Could not load your documents.'));
  }, []);
  const shown = (docs ?? []).filter((d) => d.from === tab);

  return (
    <main style={{ paddingBottom: 88 }}>
      <h1>Documents</h1>
      <div role="group" aria-label="Whose documents" style={{ display: 'flex', gap: '0.5rem' }}>
        <button type="button" aria-pressed={tab === 'you'} style={{ minHeight: 44, padding: '0 1rem', borderRadius: 22 }} onClick={() => setTab('you')}>From you</button>
        <button type="button" aria-pressed={tab === 'arik'} style={{ minHeight: 44, padding: '0 1rem', borderRadius: 22 }} onClick={() => setTab('arik')}>From Arik</button>
      </div>
      {error && <p role="alert">{error}</p>}
      {docs && shown.length === 0 && <p>{tab === 'arik' ? 'Letters Arik drafts for you show up here.' : 'Bills, denial letters and other documents you add show up here.'}</p>}
      {shown.map((d) => (
        <div key={d.id}>
          <small>{d.job}</small>
          <DocLine d={d} onError={setError} />
        </div>
      ))}
      <BottomNav />
    </main>
  );
}
