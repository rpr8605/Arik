import { isDemoMode } from '@/lib/demo/samples';
import { HomeScreen } from './HomeScreen';
import { DemoNote } from './DemoNote';

// Patient home (Phase 7 P1). Real accounts only; the demo has sample
// patient homes, so DEMO_MODE behavior is unchanged.
export const dynamic = 'force-dynamic';

export default function HomePage() {
  return isDemoMode() ? <DemoNote /> : <HomeScreen />;
}
