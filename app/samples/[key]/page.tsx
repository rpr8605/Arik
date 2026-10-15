import { notFound } from 'next/navigation';
import { isDemoMode, sampleByKey } from '@/lib/demo/samples';
import { PatientHome } from './PatientHome';

// A sample patient's home (DEMO_WALKTHROUGHS.md Flow 4). DEMO_MODE only.
export default async function SamplePatientPage({ params }: { params: Promise<{ key: string }> }) {
  if (!isDemoMode()) notFound();
  const { key } = await params;
  if (!sampleByKey(key)) notFound();
  return <PatientHome sampleKey={key} />;
}
