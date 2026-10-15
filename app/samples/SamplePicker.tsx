'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabaseBrowser } from '@/lib/supabaseBrowser';
import { sampleSessionId } from '../sampleSession';
import { clearDemoJobs } from '../walk/demoJobs';

type Row = { key: string; name: string; headline: string; shows: string; caseId: string | null };

async function authHeaders(): Promise<Record<string, string>> {
  const {
    data: { session },
  } = await supabaseBrowser().auth.getSession();
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token ?? ''}` };
}

export function SamplePicker() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [label, setLabel] = useState('Sample patient, fictional');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function load() {
    try {
      const res = await fetch(`/api/demo/samples?sid=${sampleSessionId()}`, { headers: await authHeaders() });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? `request failed (${res.status})`);
      setRows(json.samples);
      setLabel(json.label);
    } catch {
      setError('Something hiccuped. Tap Reset or reload to try again.');
    }
  }
  useEffect(() => {
    load();
  }, []);

  // Each sample opens its patient home (DEMO_WALKTHROUGHS Flow 4); the
  // home has "Chat with Arik", which makes this tab's chat copy.
  function open(row: Row) {
    setBusy(row.key);
    router.push(`/samples/${row.key}`);
  }

  return (
    <>
      <div className="sample-list">
        {(rows ?? []).map((r, i) => (
          <button
            key={r.key}
            type="button"
            className="sample-card"
            style={{ animationDelay: `${80 + i * 60}ms` }}
            disabled={busy !== null}
            onClick={() => open(r)}
          >
            <span className="sample-avatar" aria-hidden="true">
              {r.name.charAt(0)}
            </span>
            <span className="sample-text">
              <strong>{r.name}</strong>
              <span>{r.headline}</span>
              <span className="sample-shows">Shows: {r.shows}</span>
            </span>
            <span className="tag">{busy === r.key ? 'Opening…' : label}</span>
          </button>
        ))}
        {rows === null && !error ? <p className="lede">Loading…</p> : null}
      </div>
      {error && <p role="alert">{error}</p>}
      <SampleResetButton onDone={load} />
    </>
  );
}

// Reset: deletes this tab's sample copies right away; the next open makes
// fresh ones. Used on the picker and on every sample case page.
export function SampleResetButton({ onDone, redirectTo }: { onDone?: () => void; redirectTo?: string }) {
  const [state, setState] = useState<'idle' | 'busy' | 'done' | 'error'>('idle');
  const router = useRouter();
  async function reset() {
    setState('busy');
    try {
      const res = await fetch('/api/demo/samples/reset', {
        method: 'POST',
        headers: await authHeaders(),
        body: JSON.stringify({ sid: sampleSessionId() }),
      });
      if (!res.ok) throw new Error(String(res.status));
      clearDemoJobs();
      setState('done');
      if (redirectTo) router.push(redirectTo);
      onDone?.();
    } catch {
      setState('error');
    }
  }
  return (
    <div className="sample-reset">
      <button type="button" onClick={reset} disabled={state === 'busy'}>
        {state === 'busy' ? 'Resetting…' : 'Reset sample patients'}
      </button>
      <span role="status">
        {state === 'done' ? 'Done. Sample patients are back to the start.' : null}
        {state === 'error' ? "Couldn't reset. Try again." : null}
      </span>
    </div>
  );
}
