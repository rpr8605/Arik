import Link from 'next/link';
import {
  ILLUSTRATIVE_TAG,
  JOB_STATUS_LABEL,
  SAMPLE_LABEL,
  type SamplePatient,
} from '@/lib/demo/samples';
import { SampleResetButton } from '../../samples/SamplePicker';

// The sample patient card on a sample case (DEMO_DAY.md stage 1): who this
// made-up person is, their past jobs (a simple list until stage 5 adds
// full timelines), and Reset.
export function SamplePanel({ sample }: { sample: SamplePatient }) {
  const dateFmt = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
  return (
    <section aria-label="Sample patient" className="sample-panel">
      <p className="tag tag-sample">{SAMPLE_LABEL}</p>
      <h1>{sample.name}</h1>
      <ul className="sample-facts">
        {sample.situation.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      {sample.walkthrough !== 'chat' ? (
        <p className="soon-note" role="note">
          {sample.walkthrough === 'bill_review' ? 'The bill review walkthrough' : 'The denial appeal walkthrough'} is
          coming in this demo soon.
        </p>
      ) : null}

      <h2>Past jobs</h2>
      <ul className="job-list">
        {sample.pastJobs.map((j) => (
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
          </li>
        ))}
      </ul>

      <div className="actions">
        <Link href="/samples" className="pill-link">
          All sample patients
        </Link>
      </div>
      <SampleResetButton redirectTo="/samples" />
    </section>
  );
}
