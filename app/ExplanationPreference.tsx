'use client';

import { useState } from 'react';
import { supabaseBrowser } from '@/lib/supabaseBrowser';

// Explanation-style toggle (2026-08-12 ticket): an EXPLICIT, optional
// choice — never inferred from anything about the visitor, switchable
// anytime, 'standard' when unset. 'simple' makes the guided-advocate card
// format the default response shape; the boundary line and recovery
// actions are present in both modes regardless.
const OPTIONS = [
  { value: 'standard', label: 'Standard' },
  { value: 'simple', label: 'Simple, step-by-step' },
] as const;

export function ExplanationPreference({ current }: { current: string | null }) {
  const [selected, setSelected] = useState(current === 'simple' ? 'simple' : 'standard');
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  async function choose(value: string) {
    setSelected(value);
    setState('saving');
    try {
      const {
        data: { session },
      } = await supabaseBrowser().auth.getSession();
      const res = await fetch('/api/preferences', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session?.access_token ?? ''}`,
        },
        body: JSON.stringify({ explanation_style: value }),
      });
      setState(res.ok ? 'saved' : 'error');
    } catch {
      setState('error');
    }
  }

  return (
    <section aria-label="How should Arik explain things" style={{ marginBottom: '1rem' }}>
      <strong>How should Arik explain things?</strong>{' '}
      {OPTIONS.map((o) => (
        <label key={o.value} style={{ marginRight: '0.75rem' }}>
          <input
            type="radio"
            name="explanation-style"
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
    </section>
  );
}
