'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { supabaseBrowser } from '@/lib/supabaseBrowser';
import { ILLUSTRATIVE_TAG, JOB_STATUS_LABEL, SAMPLE_LABEL, sampleByKey, type PastJob } from '@/lib/demo/samples';
import { sampleSessionId } from '../../sampleSession';
import { demoJobsFor, type DemoJob } from '../../walk/demoJobs';
import { SampleResetButton } from '../SamplePicker';

const dateFmt = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
const KIND_WORDS: Record<string, string> = {
  document: 'Document',
  letter: 'Letter',
  sent: 'Sent',
  reply: 'Reply',
  outcome: 'Outcome',
  note: 'Note',
};

// The sample patient's home: Needs you, Saved so far (illustrative), Active
// jobs and Past jobs with the full canned history. Jobs the visitor just
// finished in a walkthrough (this tab only) show first.
export function PatientHome({ sampleKey }: { sampleKey: string }) {
  const sample = sampleByKey(sampleKey)!;
  const [mine, setMine] = useState<DemoJob[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [chatBusy, setChatBusy] = useState(false);
  const [chatError, setChatError] = useState(false);
  const router = useRouter();

  useEffect(() => {
    setMine(demoJobsFor(sample.key));
  }, [sample.key]);

  const active = sample.pastJobs.filter((j) => j.status !== 'done');
  const past = sample.pastJobs.filter((j) => j.status === 'done');

  async function openChat() {
    setChatBusy(true);
    setChatError(false);
    try {
      const {
        data: { session },
      } = await supabaseBrowser().auth.getSession();
      const res = await fetch('/api/demo/samples', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token ?? ''}` },
        body: JSON.stringify({ sid: sampleSessionId(), key: sample.key }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error();
      router.push(`/cases/${json.caseId}`);
    } catch {
      setChatError(true);
      setChatBusy(false);
    }
  }

  return (
    <main className="patient-home">
      <p className="tag tag-sample">{SAMPLE_LABEL}</p>
      <h1>{sample.name}</h1>
      <p className="lede">{sample.headline}</p>
      {sample.subject.caringFor ? (
        <p className="caregiver-note" role="note">
          Caregiver mode: {sample.name} manages {sample.subject.caringFor.name}&apos;s care. Arik uses{' '}
          {sample.subject.caringFor.name}&apos;s Medicare coverage, not {sample.name}&apos;s.
        </p>
      ) : null}

      <section aria-label="Needs you" className="home-block needs-block">
        <h2>Needs you</h2>
        <Link href={sample.needsYou.walk} className="needs-link">
          {sample.needsYou.text}
          <span aria-hidden="true">›</span>
        </Link>
      </section>

      <section aria-label="Saved so far" className="home-block">
        <h2>Saved so far</h2>
        <p className="saved">
          {sample.savedSoFarUsd != null ? <strong>${sample.savedSoFarUsd.toLocaleString('en-US')}</strong> : null}{' '}
          {sample.savedSoFarNote} <span className="tag">{ILLUSTRATIVE_TAG}</span>
        </p>
      </section>

      {mine.length > 0 ? (
        <section aria-label="Just now" className="home-block">
          <h2>Just now</h2>
          <ul className="job-list">
            {mine.map((j) => (
              <li key={j.id}>
                <div className="job-top">
                  <strong>{j.title}</strong>
                  <span className="chip chip-waiting">Demo</span>
                </div>
                <span className="job-date">{j.status}</span>
                {j.receipts.map((r) => (
                  <span key={r.ref} className="job-outcome">
                    {r.title}: {r.method}, ref {r.ref} <span className="tag">{r.status}</span>
                  </span>
                ))}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section aria-label="Active jobs" className="home-block">
        <h2>Active jobs</h2>
        <JobList jobs={active} open={open} setOpen={setOpen} />
      </section>

      <section aria-label="Past jobs" className="home-block">
        <h2>Past jobs</h2>
        <JobList jobs={past} open={open} setOpen={setOpen} />
      </section>

      <div className="actions">
        <button type="button" onClick={openChat} disabled={chatBusy}>
          {chatBusy ? 'Opening…' : `Chat with Arik as ${sample.name}`}
        </button>
        <Link href="/samples" className="pill-link">
          All sample patients
        </Link>
      </div>
      {chatError ? <p role="alert">Something hiccuped. Tap to try again.</p> : null}
      <SampleResetButton redirectTo="/samples" />
    </main>
  );
}

function JobList({ jobs, open, setOpen }: { jobs: PastJob[]; open: string | null; setOpen: (t: string | null) => void }) {
  if (jobs.length === 0) return <p className="lede">Nothing here right now.</p>;
  return (
    <ul className="job-list">
      {jobs.map((j) => (
        <li key={j.title}>
          <div className="job-top">
            <strong>{j.title}</strong>
            <span className={`chip chip-${j.status}`}>{JOB_STATUS_LABEL[j.status]}</span>
          </div>
          <span className="job-date">Opened {dateFmt.format(new Date(j.date))}</span>
          {j.outcome ? (
            <span className="job-outcome">
              {j.outcome} <span className="tag">{ILLUSTRATIVE_TAG}</span>
            </span>
          ) : null}
          {open === j.title ? (
            <ol className="timeline">
              {j.timeline.map((e) => (
                <li key={e.date + e.text}>
                  <span className="timeline-kind">{KIND_WORDS[e.kind]}</span> {dateFmt.format(new Date(e.date))}: {e.text}
                </li>
              ))}
            </ol>
          ) : null}
          <div className="actions">
            <button type="button" aria-expanded={open === j.title} onClick={() => setOpen(open === j.title ? null : j.title)}>
              {open === j.title ? 'Hide history' : 'Replay history'}
            </button>
            {j.walk ? (
              <Link href={j.walk} className="pill-link">
                Start
              </Link>
            ) : null}
          </div>
        </li>
      ))}
    </ul>
  );
}
