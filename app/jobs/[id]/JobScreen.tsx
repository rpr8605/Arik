'use client';

// Job detail (Phase 7 P1): status and next step, the timeline (newest
// first), money (confirmed and possible, labeled), the job's documents
// with their frozen PDFs, and "Continue with Arik" into this job's chat.

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { downloadPdf, homeApi, usDate, usd } from '../../home/homeApi';
import { BottomNav } from '../../home/BottomNav';

type Doc = { id: string; caseId: string; from: 'you' | 'arik'; title: string; at: string; status: string; pdf: 'letter' | 'signed' | null; sha256: string | null; note: string | null };
type Job = {
  job: { topic: string; chip: string; chipWords: string; next: string | null; due: string | null };
  needsYou: { title: string; due: string | null }[];
  timeline: { at: string; kind: string; title: string; detail: string | null }[];
  money: { confirmedUsd: number; monthlyUsd: number; possibleUsd: number };
  documents: Doc[];
};

export function pdfPath(d: Doc) {
  return d.pdf === 'signed' ? `/api/cases/${d.caseId}/letters/${d.id}/sign` : `/api/cases/${d.caseId}/letters/${d.id}?format=pdf`;
}

export function JobScreen({ caseId }: { caseId: string }) {
  const [job, setJob] = useState<Job | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    homeApi(`/api/jobs/${caseId}`)
      .then(async (r) => (r.ok ? setJob(await r.json()) : setError(r.status === 404 ? 'Job not found.' : 'Could not load this job.')))
      .catch(() => setError('Could not load this job.'));
  }, [caseId]);

  return (
    <main style={{ paddingBottom: 88 }}>
      <p><Link href="/jobs">‹ Jobs</Link></p>
      {error && <p role="alert">{error}</p>}
      {job && (
        <>
          <h1>{job.job.topic}</h1>
          <p><span className={`chip chip-${job.job.chip}`}>{job.job.chipWords}</span>{job.job.due ? ` · Next deadline ${usDate(job.job.due)}` : ''}</p>
          {job.needsYou[0] && <p className="finding finding-ask"><strong>Next:</strong> {job.needsYou[0].title}</p>}
          <Link href={`/cases/${caseId}`} style={{ display: 'inline-flex', alignItems: 'center', minHeight: 48, padding: '0 1rem', borderRadius: 12, background: '#325773', color: '#fff', textDecoration: 'none' }}>Continue with Arik</Link>
          <section className="card" aria-label="Money" style={{ marginTop: '1rem' }}>
            <strong>Money:</strong>{' '}
            {job.money.confirmedUsd > 0 || job.money.monthlyUsd > 0 ? `${usd(job.money.confirmedUsd)} confirmed${job.money.monthlyUsd > 0 ? `, plus ${usd(job.money.monthlyUsd)} a month` : ''}` : 'confirmed none yet'}
            {job.money.possibleUsd > 0 ? ` · possible ${usd(job.money.possibleUsd)}, not confirmed` : ''}
          </section>
          <h2>Timeline</h2>
          {job.timeline.length === 0 ? (
            <p>Nothing has happened on this job yet. Add a document or tell Arik what is going on.</p>
          ) : (
            <ol style={{ listStyle: 'none', padding: 0 }}>
              {job.timeline.map((t, i) => (
                <li key={i} style={{ borderBottom: '1px solid #e8edf1', padding: '0.5rem 0' }}>
                  <span style={{ display: 'inline-block', minWidth: 96 }}>{usDate(t.at)}</span> <strong>{t.title}</strong>
                  {t.detail && <><br /><span>{t.detail}</span></>}
                </li>
              ))}
            </ol>
          )}
          <h2>Documents</h2>
          {job.documents.length === 0 ? <p>No documents on this job yet.</p> : job.documents.map((d) => <DocLine key={d.id} d={d} onError={setError} />)}
        </>
      )}
      <BottomNav />
    </main>
  );
}

export function DocLine({ d, onError }: { d: Doc; onError: (m: string) => void }) {
  return (
    <div style={{ borderBottom: '1px solid #e8edf1', padding: '0.6rem 0', minHeight: 48 }}>
      <strong>{d.title}</strong> <span className="chip">{d.status}</span>
      <br />
      <span>{usDate(d.at)}{d.note ? ` · ${d.note}` : ''}</span>
      {d.pdf && (
        <>
          <br />
          <button type="button" style={{ minHeight: 44, padding: '0 1rem', marginTop: 4 }} onClick={() => downloadPdf(pdfPath(d), `${d.title.slice(0, 40).replace(/[^A-Za-z0-9]+/g, '-')}.pdf`).catch((e) => onError(e.message))}>PDF</button>
          {d.sha256 && <small style={{ marginLeft: 8, wordBreak: 'break-all' }}>Fingerprint (SHA-256) {d.sha256.slice(0, 16)}...</small>}
        </>
      )}
    </div>
  );
}
