'use client';

// Jobs list (Phase 7 P1): every job with its status chip in words and its
// next step, filtered by All / Needs you / Open / Done.

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { homeApi, usDate } from '../home/homeApi';
import { BottomNav } from '../home/BottomNav';

type Job = { caseId: string; topic: string; chip: string; chipWords: string; next: string | null; due: string | null; forSomeoneElse: boolean };
const FILTERS: [string, string, (j: Job) => boolean][] = [
  ['all', 'All', () => true],
  ['needs', 'Needs you', (j) => j.chip === 'needs_you'],
  ['open', 'Open', (j) => j.chip !== 'won' && j.chip !== 'closed'],
  ['done', 'Done', (j) => j.chip === 'won' || j.chip === 'closed'],
];

export function JobsScreen() {
  const [jobs, setJobs] = useState<Job[] | null>(null);
  const [filter, setFilter] = useState('all');
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    homeApi('/api/jobs')
      .then(async (r) => (r.ok ? setJobs((await r.json()).jobs) : setError('Could not load your jobs.')))
      .catch(() => setError('Could not load your jobs.'));
  }, []);
  const shown = (jobs ?? []).filter(FILTERS.find((f) => f[0] === filter)![2]);

  return (
    <main style={{ paddingBottom: 88 }}>
      <h1>Jobs <Link href="/" style={{ fontSize: '1rem', fontWeight: 400, marginLeft: '0.5rem' }}>+ New</Link></h1>
      <div role="group" aria-label="Filter jobs" style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
        {FILTERS.map(([k, label]) => (
          <button key={k} type="button" aria-pressed={filter === k} style={{ minHeight: 44, padding: '0 1rem', borderRadius: 22 }} onClick={() => setFilter(k)}>{label}</button>
        ))}
      </div>
      {error && <p role="alert">{error}</p>}
      {jobs && jobs.length === 0 && <p>Snap a bill or ask Arik about a prescription to start your first job.</p>}
      {jobs && jobs.length > 0 && shown.length === 0 && <p>Nothing here right now.</p>}
      {shown.map((j) => (
        <Link key={j.caseId} href={`/jobs/${j.caseId}`} className="card" style={{ display: 'block', marginTop: '0.75rem', color: 'inherit', textDecoration: 'none', minHeight: 48 }}>
          <strong>{j.topic}</strong>{j.forSomeoneElse ? ' (someone you help)' : ''}
          <br />
          <span className={`chip chip-${j.chip}`}>{j.chipWords}</span>{j.next ? ` · ${j.next}` : ''}
          {j.due && <><br /><span>Next deadline {usDate(j.due)}</span></>}
        </Link>
      ))}
      <BottomNav />
    </main>
  );
}
