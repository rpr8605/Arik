import Link from 'next/link';
import { SAMPLE_LABEL, type SamplePatient } from '@/lib/demo/samples';

// The sample patient card on a sample patient's real chat (DEMO_DAY stage 1).
// Their history lives on the patient home (/samples/[key]); bill and denial
// samples point to their scripted walkthrough.
export function SamplePanel({ sample }: { sample: SamplePatient }) {
  return (
    <section aria-label="Sample patient" className="sample-panel">
      <p className="tag tag-sample">{SAMPLE_LABEL}</p>
      <h1>{sample.name}</h1>
      <ul className="sample-facts">
        {sample.situation.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      <div className="actions">
        {sample.walkthrough !== 'chat' ? (
          <Link href={sample.needsYou.walk} className="pill-link">
            {sample.walkthrough === 'bill_review' ? 'Start the bill review' : 'Start the denial appeal'}
          </Link>
        ) : null}
        <Link href={`/samples/${sample.key}`} className="pill-link">
          {sample.name}&apos;s home
        </Link>
      </div>
    </section>
  );
}
