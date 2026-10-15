import { notFound } from 'next/navigation';
import { isDemoMode } from '@/lib/demo/samples';
import { SamplePicker } from './SamplePicker';

// "Try a sample patient" (DEMO_DAY.md stage 1). Exists only with
// DEMO_MODE=true.
export default function SamplesPage() {
  if (!isDemoMode()) notFound();
  return (
    <main>
      <h1>Try a sample patient</h1>
      <p className="lede">
        Pick someone to see what Arik does. Everyone here is made up. Drug prices come from Arik&apos;s
        real sourced data.
      </p>
      <SamplePicker />
    </main>
  );
}
