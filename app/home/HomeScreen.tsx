'use client';

// Home (Phase 7 P1, docs/design/patient_home_screens.md): Talk to Arik,
// Needs you (soonest first), Saved so far (confirmed only, "possible" on
// its own labeled line), Active jobs and Coming up. Empty states teach the
// next step.

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { homeApi, usDate, usd } from './homeApi';
import { BottomNav } from './BottomNav';

type Home = {
  needsYou: { caseId: string; title: string; job: string; due: string | null }[];
  saved: { confirmedUsd: number; monthlyUsd: number; possibleUsd: number };
  activeJobs: { caseId: string; topic: string; chipWords: string; chip: string; next: string | null; forSomeoneElse: boolean }[];
  comingUp: { date: string; title: string; job: string; caseId: string }[];
  jobCount: number;
};

const row = { display: 'block', minHeight: 48, padding: '0.6rem 0', borderBottom: '1px solid #e8edf1', color: 'inherit', textDecoration: 'none' } as const;

export function HomeScreen() {
  const [home, setHome] = useState<Home | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    homeApi('/api/home')
      .then(async (r) => (r.ok ? setHome(await r.json()) : setError('Could not load your home.')))
      .catch(() => setError('Could not load your home.'));
  }, []);

  return (
    <main style={{ paddingBottom: 88 }}>
      <h1>Home</h1>
      <section className="card">
        <h2 style={{ marginTop: 0 }}>Talk to Arik</h2>
        <Link href="/" className="button" style={{ display: 'flex', alignItems: 'center', minHeight: 56, padding: '0 1rem', borderRadius: 12, background: '#325773', color: '#fff', textDecoration: 'none' }}>What&apos;s going on?</Link>
      </section>
      {error && <p role="alert">{error}</p>}
      {home && (
        <>
          <section aria-label="Needs you">
            <h2>Needs you{home.needsYou.length ? ` (${home.needsYou.length})` : ''}</h2>
            {home.needsYou.length === 0 ? (
              <p>You&apos;re all caught up.</p>
            ) : (
              home.needsYou.map((n, i) => (
                <Link key={i} href={`/jobs/${n.caseId}`} style={row}>
                  <strong>{n.title}</strong>
                  <br />
                  <span>{n.due ? `Due ${usDate(n.due)} · ` : ''}{n.job}</span>
                </Link>
              ))
            )}
          </section>
          <section className="card" aria-label="Saved so far">
            <h2 style={{ marginTop: 0 }}>Saved so far</h2>
            {home.saved.confirmedUsd > 0 || home.saved.monthlyUsd > 0 ? (
              <>
                <p style={{ fontSize: '2rem', margin: 0 }}><strong>{usd(home.saved.confirmedUsd)}</strong></p>
                <p style={{ margin: 0 }}>confirmed savings{home.saved.monthlyUsd > 0 ? `, plus ${usd(home.saved.monthlyUsd)} a month going forward` : ''}</p>
              </>
            ) : (
              <p>When Arik saves you money and you confirm it, it adds up here.</p>
            )}
            {home.saved.possibleUsd > 0 && <p><small>+ {usd(home.saved.possibleUsd)} possible, not confirmed yet</small></p>}
          </section>
          <section aria-label="Active jobs">
            <h2>Active jobs {home.jobCount > 0 && <Link href="/jobs" style={{ fontSize: '1rem', fontWeight: 400 }}>See all</Link>}</h2>
            {home.activeJobs.length === 0 ? (
              <p>Snap a bill or ask Arik about a prescription to start your first job.</p>
            ) : (
              home.activeJobs.map((j) => (
                <Link key={j.caseId} href={`/jobs/${j.caseId}`} style={row}>
                  <strong>{j.topic}</strong>{j.forSomeoneElse ? ' (someone you help)' : ''}
                  <br />
                  <span className={`chip chip-${j.chip}`}>{j.chipWords}</span>{j.next ? ` · ${j.next}` : ''}
                </Link>
              ))
            )}
          </section>
          <section aria-label="Coming up">
            <h2>Coming up</h2>
            {home.comingUp.length === 0 ? (
              <p>No dates coming up. Arik adds deadlines here as your jobs move.</p>
            ) : (
              home.comingUp.map((c, i) => (
                <Link key={i} href={`/jobs/${c.caseId}`} style={row}>
                  <strong>{usDate(c.date)}</strong> {c.title} ({c.job})
                </Link>
              ))
            )}
          </section>
        </>
      )}
      <BottomNav />
    </main>
  );
}
