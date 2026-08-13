'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabaseBrowser } from '@/lib/supabaseBrowser';

// The crisis-aware front door (CRISIS_AWARE_DESIGN.md): one question,
// not a profile form. Whatever the patient types creates the case.
//
// Guided entry (2026-08-13 ticket): a blank textarea gives no signal
// about what produces a good answer, so the primary path is three
// tappable chips pointing at the verified, sourced drugs. The open
// textarea stays as the secondary path under a divider.
const SUGGESTED: {
  drug: string;
  note: string;
  query: string;
  // The Eliquis chip's promise includes the Medicare legal safety check
  // — and the AKS hard-block reads profile.insurance_type, which chat
  // extraction never writes (merge handles insurance_plan_name only).
  // So this chip sets plan type to Medicare first, but ONLY when the
  // profile has no plan type yet: an explicitly chosen coverage value
  // is never overwritten by a demo shortcut.
  planTypeIfUnset: 'medicare' | null;
}[] = [
  {
    drug: 'Eliquis',
    note: 'Includes the Medicare legal safety check',
    query: "I'm on Medicare Part D and my Eliquis copay is too high. What are my real options?",
    planTypeIfUnset: 'medicare',
  },
  {
    drug: 'Dupixent',
    note: 'Copay card and patient assistance program',
    query: 'I need help paying for Dupixent. What savings programs do I actually qualify for?',
    planTypeIfUnset: null,
  },
  {
    drug: 'Zepbound',
    note: 'See how Arik handles a real pricing conflict',
    query: 'What does Zepbound cost, and is there any way to pay less for it?',
    planTypeIfUnset: null,
  },
];

export function NewCaseForm({ currentPlanType }: { currentPlanType: string | null }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function start(message: string, planTypeIfUnset: 'medicare' | null) {
    setBusy(true);
    setError(null);
    try {
      const {
        data: { session },
      } = await supabaseBrowser().auth.getSession();
      const auth = { Authorization: `Bearer ${session?.access_token ?? ''}` };

      if (planTypeIfUnset && !currentPlanType) {
        // Best-effort: the case still starts if this fails, the Medicare
        // safety-check demonstration just degrades to the general answer.
        await fetch('/api/profile/insurance-type', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', ...auth },
          body: JSON.stringify({ planType: planTypeIfUnset }),
        }).catch(() => {});
      }

      const res = await fetch('/api/cases/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...auth },
        body: JSON.stringify({ message }),
      });
      const json = await res.json();
      if (res.ok) {
        router.push(`/cases/${json.caseId}?first=${encodeURIComponent(message)}`);
      } else {
        setError(json.error ?? 'Something went wrong starting your case.');
        setBusy(false);
      }
    } catch {
      setError('Something went wrong starting your case.');
      setBusy(false);
    }
  }

  return (
    <div>
      <p className="scope-line">
        Arik has verified, sourced answers for these medications right now — start with one to see
        how it works.
      </p>
      <div className="chips">
        {SUGGESTED.map((s) => (
          <button
            key={s.drug}
            type="button"
            className="chip"
            disabled={busy}
            onClick={() => start(s.query, s.planTypeIfUnset)}
          >
            <strong>{s.drug}</strong>
            <span>{s.note}</span>
          </button>
        ))}
      </div>

      <div className="entry-divider">
        <span>or describe your own situation</span>
      </div>

      <form
        className="own-entry"
        onSubmit={(e) => {
          e.preventDefault();
          if (!text.trim() || busy) return;
          start(text.trim(), null);
        }}
      >
        <label htmlFor="whats-going-on" className="sr-only">
          What&apos;s going on?
        </label>
        <textarea
          id="whats-going-on"
          rows={3}
          required
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="A bill you can't pay, a denial letter, a prescription that costs too much - tell me what happened."
        />
        <button type="submit" disabled={busy}>
          {busy ? 'Starting your case…' : 'Get help'}
        </button>
        {error && <p role="alert">{error}</p>}
      </form>
    </div>
  );
}
