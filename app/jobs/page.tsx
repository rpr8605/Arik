import { isDemoMode } from '@/lib/demo/samples';
import { JobsScreen } from './JobsScreen';
import { DemoNote } from '../home/DemoNote';

// Jobs list (Phase 7 P1). Real accounts only; DEMO_MODE unchanged.
export const dynamic = 'force-dynamic';

export default function JobsPage() {
  return isDemoMode() ? <DemoNote /> : <JobsScreen />;
}
