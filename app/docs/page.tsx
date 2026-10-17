import { isDemoMode } from '@/lib/demo/samples';
import { DocsScreen } from './DocsScreen';
import { DemoNote } from '../home/DemoNote';

// Documents vault (Phase 7 P1). Real accounts only; DEMO_MODE unchanged.
export const dynamic = 'force-dynamic';

export default function DocsPage() {
  return isDemoMode() ? <DemoNote /> : <DocsScreen />;
}
