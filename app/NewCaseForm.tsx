'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabaseBrowser } from '@/lib/supabaseBrowser';

// The crisis-aware front door (CRISIS_AWARE_DESIGN.md): one question,
// not a profile form. Whatever the patient types creates the case.
export function NewCaseForm() {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const {
      data: { session },
    } = await supabaseBrowser().auth.getSession();
    const res = await fetch('/api/cases/start', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session?.access_token ?? ''}`,
      },
      body: JSON.stringify({ message: text }),
    });
    const json = await res.json();
    if (res.ok) {
      router.push(`/cases/${json.caseId}?first=${encodeURIComponent(text)}`);
    } else {
      setError(json.error ?? 'Something went wrong starting your case.');
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <label htmlFor="whats-going-on">
        <strong>What&apos;s going on?</strong>
      </label>
      <textarea
        id="whats-going-on"
        rows={4}
        required
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="A bill you can't pay, a denial letter, a prescription that costs too much - tell me what happened."
        style={{ display: 'block', width: '100%', maxWidth: '40rem' }}
      />
      <button type="submit" disabled={busy}>
        {busy ? 'Starting your case…' : 'Get help'}
      </button>
      {error && <p role="alert">{error}</p>}
    </form>
  );
}
