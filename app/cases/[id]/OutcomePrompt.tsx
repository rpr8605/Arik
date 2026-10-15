'use client';

import { useState } from 'react';
import { supabaseBrowser } from '@/lib/supabaseBrowser';

// Outcome confirmation (build-plan step 9): the KPI loop only counts
// patient-confirmed outcomes, so a resolved case asks once — what did you
// actually pay, and where? The case page shows this only when the case is
// terminal AND no confirmed outcome exists (decision: lib/outcomes.ts
// shouldPromptOutcomeConfirmation). "Not now" dismisses for this view
// only; the prompt returns on reload until an outcome is confirmed.
export function OutcomePrompt({ caseId }: { caseId: string }) {
  const [amount, setAmount] = useState('');
  const [pharmacy, setPharmacy] = useState('');
  const [state, setState] = useState<'idle' | 'saving' | 'done' | 'dismissed' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    setState('saving');
    setError(null);
    try {
      const {
        data: { session },
      } = await supabaseBrowser().auth.getSession();
      const headers = {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session?.access_token ?? ''}`,
      };
      const parsed = amount.trim() === '' ? undefined : Number(amount);
      if (parsed !== undefined && (!Number.isFinite(parsed) || parsed < 0)) {
        throw new Error('Amount should be a number like 0 or 12.50');
      }
      const record = await fetch('/api/outcomes', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          caseId,
          fields: {
            revisedAmountOwedUsd: parsed,
            pharmacyUsed: pharmacy.trim() || undefined,
            causedByArik: true,
          },
        }),
      });
      const recordJson = await record.json();
      if (!record.ok) throw new Error(recordJson.error ?? 'could not save the outcome');
      const yes = await fetch('/api/outcomes', {
        method: 'POST',
        headers,
        body: JSON.stringify({ outcomeId: recordJson.outcome.id, patientConfirmed: true }),
      });
      if (!yes.ok) throw new Error('saved but could not mark confirmed');
      setState('done');
    } catch (e) {
      setError((e as Error).message);
      setState('error');
    }
  }

  if (state === 'dismissed') return null;
  if (state === 'done') {
    return (
      <section aria-label="Outcome confirmed" style={{ border: '1px solid', padding: '0.75rem', maxWidth: '40rem' }}>
        <p>Thanks, outcome confirmed. This is what proves the savings were real.</p>
      </section>
    );
  }

  return (
    <section aria-label="Confirm the outcome" style={{ border: '1px solid', padding: '0.75rem', maxWidth: '40rem' }}>
      <p>
        <strong>Before this case closes out:</strong> did it work? What did you actually pay, and
        where? This is how Arik proves a recommendation actually saved money. Nothing counts
        without your confirmation.
      </p>
      <label htmlFor="outcome-amount">What did you pay? (USD)</label>{' '}
      <input
        id="outcome-amount"
        type="text"
        inputMode="decimal"
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        placeholder="e.g. 0 or 12.50"
        style={{ width: '8rem' }}
      />{' '}
      <label htmlFor="outcome-pharmacy">Where did you fill it?</label>{' '}
      <input
        id="outcome-pharmacy"
        type="text"
        value={pharmacy}
        onChange={(e) => setPharmacy(e.target.value)}
        placeholder="e.g. Costco, CVS"
        style={{ width: '12rem' }}
      />{' '}
      <button type="button" onClick={confirm} disabled={state === 'saving'}>
        {state === 'saving' ? 'Saving…' : 'Confirm outcome'}
      </button>{' '}
      <button type="button" onClick={() => setState('dismissed')} disabled={state === 'saving'}>
        Not now
      </button>
      {error ? <p role="alert">{error}</p> : null}
    </section>
  );
}
