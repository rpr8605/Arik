'use client';

import { useEffect, useState } from 'react';
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

// Saved style preference (persona, db/027): shown here so it is always
// visible and deletable. Only what the person asked Arik to remember.
function savedWords(p: { length?: string | null; order?: string | null }): string | null {
  const parts: string[] = [];
  if (p.length === 'short') parts.push('short answers');
  if (p.length === 'detailed') parts.push('detailed answers');
  if (p.length === 'normal') parts.push('normal-length answers');
  if (p.order === 'answer_first') parts.push('answer first');
  if (p.order === 'context_first') parts.push('background first');
  return parts.length ? parts.join(', ') : null;
}

async function authHeaders(): Promise<Record<string, string>> {
  const {
    data: { session },
  } = await supabaseBrowser().auth.getSession();
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token ?? ''}` };
}

export function ExplanationPreference({ current }: { current: string | null }) {
  const [selected, setSelected] = useState(current === 'simple' ? 'simple' : 'standard');
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [saved, setSaved] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/preferences/style', { headers: await authHeaders() });
        if (res.ok) setSaved(savedWords(await res.json()));
      } catch {
        // nothing saved shown
      }
    })();
  }, []);

  async function forget() {
    try {
      const res = await fetch('/api/preferences/style', { method: 'DELETE', headers: await authHeaders() });
      if (res.ok) setSaved(null);
    } catch {
      // keep showing it; the person can try again
    }
  }

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
      {saved ? (
        <div className="actions" style={{ alignItems: 'center' }}>
          <span>Arik remembers: {saved}.</span>
          <button type="button" onClick={forget}>Forget this</button>
        </div>
      ) : null}
    </section>
  );
}
