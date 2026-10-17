import Link from 'next/link';

// In DEMO_MODE the patient home screens point to the sample patients,
// which have their own homes; the real home reads real accounts only.
export function DemoNote() {
  return (
    <main>
      <h1>Your home</h1>
      <p>This demo shows sample patients instead. Each one has a home with its jobs and documents.</p>
      <p><Link href="/samples">See the sample patients</Link></p>
    </main>
  );
}
