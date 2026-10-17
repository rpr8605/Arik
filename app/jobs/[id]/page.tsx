import { isDemoMode } from '@/lib/demo/samples';
import { JobScreen } from './JobScreen';
import { DemoNote } from '../../home/DemoNote';

// Job detail (Phase 7 P1). Real accounts only; DEMO_MODE unchanged. The
// API checks the user may see this job (the same 404 otherwise).
export const dynamic = 'force-dynamic';

export default async function JobPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return isDemoMode() ? <DemoNote /> : <JobScreen caseId={id} />;
}
