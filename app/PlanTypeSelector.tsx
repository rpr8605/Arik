'use client';

import { useState } from 'react';
import { supabaseBrowser } from '@/lib/supabaseBrowser';

// Pre-demo item 3: insurance entry reduced to broad plan type. This one
// selection feeds the AKS hard-block (lib/medicareEligibility.ts), so the
// copy says plainly that it changes what options are legal to show. We
// deliberately do not collect member ID, group number, or PCN anywhere.
const OPTIONS = [
  { value: 'commercial', label: 'Commercial / Employer' },
  { value: 'medicare', label: 'Medicare' },
  { value: 'medicaid', label: 'Medicaid' },
  { value: 'uninsured', label: 'Uninsured / Cash' },
] as const;

// DB value -> selector value (schema also allows 'marketplace' etc. from
// conversational extraction; those display as commercial for this control).
function toSelectorValue(insuranceType: string | null): string {
  if (insuranceType === 'medicare_part_d' || insuranceType === 'medicare' || insuranceType === 'medicare_advantage') return 'medicare';
  if (insuranceType === 'medicaid') return 'medicaid';
  if (insuranceType === 'uninsured') return 'uninsured';
  return insuranceType ? 'commercial' : '';
}

export function PlanTypeSelector({ current }: { current: string | null }) {
  const [selected, setSelected] = useState(toSelectorValue(current));
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  async function choose(value: string) {
    setSelected(value);
    setState('saving');
    try {
      const {
        data: { session },
      } = await supabaseBrowser().auth.getSession();
      const res = await fetch('/api/profile/insurance-type', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session?.access_token ?? ''}`,
        },
        body: JSON.stringify({ planType: value }),
      });
      setState(res.ok ? 'saved' : 'error');
    } catch {
      setState('error');
    }
  }

  return (
    <section aria-label="Your coverage type" style={{ marginBottom: '1rem' }}>
      <strong>Your coverage type:</strong>{' '}
      {OPTIONS.map((o) => (
        <label key={o.value} style={{ marginRight: '0.75rem' }}>
          <input
            type="radio"
            name="plan-type"
            value={o.value}
            checked={selected === o.value}
            onChange={() => choose(o.value)}
            disabled={state === 'saving'}
          />{' '}
          {o.label}
        </label>
      ))}
      {state === 'saved' ? <span> — saved</span> : null}
      {state === 'error' ? <span role="alert"> — couldn&apos;t save, try again</span> : null}
      <div style={{ fontSize: '0.9em' }}>
        This changes which savings paths are legal to show you (for example, manufacturer copay
        cards are federally prohibited on Medicare/Medicaid). We never ask for member IDs or group
        numbers — we can&apos;t verify them yet.
      </div>
    </section>
  );
}
