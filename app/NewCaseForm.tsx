'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabaseBrowser } from '@/lib/supabaseBrowser';

// The welcome screen (FIRST_RUN_AND_BRAND.md Part 2), still the
// crisis-aware front door (CRISIS_AWARE_DESIGN.md): one question, not a
// profile form. Whatever the patient types or taps creates the case.
//
// Arik greets first, then four starters, then the real-drug strip, with
// the chat box pinned at the bottom. Bill, denial and sample-patient
// starters say "coming soon" until those walkthroughs exist (demo 5a).

type Starter = {
  id: string;
  label: string;
  icon: React.ReactNode;
  // A message starts a case now; null shows the coming-soon note instead.
  message: string | null;
};

const ICON = { width: 24, height: 24, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;

const STARTERS: Starter[] = [
  {
    id: 'rx',
    label: 'Lower my prescription cost',
    message: 'I want to pay less for my prescription.',
    icon: (
      <svg {...ICON} aria-hidden="true">
        <rect x="3" y="9" width="18" height="6" rx="3" transform="rotate(-45 12 12)" />
        <path d="m8.5 8.5 7 7" />
      </svg>
    ),
  },
  {
    id: 'bill',
    label: 'Check a medical bill',
    message: null,
    icon: (
      <svg {...ICON} aria-hidden="true">
        <path d="M6 3h12v18l-3-2-3 2-3-2-3 2z" />
        <path d="M9 8h6M9 12h6" />
      </svg>
    ),
  },
  {
    id: 'denial',
    label: 'Fight a denial',
    message: null,
    icon: (
      <svg {...ICON} aria-hidden="true">
        <path d="M12 3 5 6v5c0 4.5 3 8 7 10 4-2 7-5.5 7-10V6z" />
        <path d="m9 12 2 2 4-4" />
      </svg>
    ),
  },
  {
    id: 'sample',
    label: 'Try a sample patient',
    message: null,
    icon: (
      <svg {...ICON} aria-hidden="true">
        <circle cx="12" cy="8" r="4" />
        <path d="M4 21c1-4 4-6 8-6s7 2 8 6" />
      </svg>
    ),
  },
];

// Real-drug strip: the verified, sourced drugs.
const SUGGESTED: {
  drug: string;
  query: string;
  // The Eliquis button's promise includes the Medicare legal safety check,
  // and the AKS hard-block reads profile.insurance_type, which chat
  // extraction never writes (merge handles insurance_plan_name only).
  // So this button sets plan type to Medicare first, but ONLY when the
  // profile has no plan type yet: an explicitly chosen coverage value
  // is never overwritten by a demo shortcut.
  planTypeIfUnset: 'medicare' | null;
}[] = [
  {
    drug: 'Eliquis',
    query: "I'm on Medicare Part D and my Eliquis copay is too high. What are my real options?",
    planTypeIfUnset: 'medicare',
  },
  {
    drug: 'Dupixent',
    query: 'I need help paying for Dupixent. What savings programs do I actually qualify for?',
    planTypeIfUnset: null,
  },
  {
    drug: 'Zepbound',
    query: 'What does Zepbound cost, and is there any way to pay less for it?',
    planTypeIfUnset: null,
  },
];

// children (the case list and settings) render between the drug strip and
// the composer, so the composer stays the last thing in <main> and its
// sticky bottom holds for the whole page.
export function NewCaseForm({
  currentPlanType,
  intro,
  children,
}: {
  currentPlanType: string | null;
  intro: string;
  children?: React.ReactNode;
}) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [soon, setSoon] = useState<string | null>(null);
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
    <>
      <div className="bubble bubble-arik">
        <p>{intro}</p>
        <p>Tell me what&apos;s going on, or tap one to start.</p>
      </div>

      <div className="starters">
        {STARTERS.map((s, i) => (
          <button
            key={s.id}
            type="button"
            className="starter"
            style={{ animationDelay: `${120 + i * 70}ms` }}
            disabled={busy}
            onClick={() => (s.message ? start(s.message, null) : setSoon(s.id))}
          >
            <span className="starter-icon">{s.icon}</span>
            <span>{s.label}</span>
          </button>
        ))}
      </div>
      {soon && (
        <p className="soon-note" role="status">
          {STARTERS.find((s) => s.id === soon)?.label}: coming in this demo soon.
        </p>
      )}

      <h2 className="strip-title">Try it with a real drug</h2>
      <div className="drug-strip">
        {SUGGESTED.map((s) => (
          <button
            key={s.drug}
            type="button"
            className="drug-chip"
            disabled={busy}
            onClick={() => start(s.query, s.planTypeIfUnset)}
          >
            {s.drug}
          </button>
        ))}
      </div>

      {children}

      <form
        className="composer home-composer"
        onSubmit={(e) => {
          e.preventDefault();
          if (!text.trim() || busy) return;
          start(text.trim(), null);
        }}
      >
        <label htmlFor="whats-going-on" className="sr-only">
          What&apos;s going on?
        </label>
        <input
          id="whats-going-on"
          type="text"
          autoComplete="off"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Tell Arik what's going on"
        />
        <button type="submit" disabled={busy || !text.trim()}>
          {busy ? 'Starting…' : 'Send'}
        </button>
      </form>
      {error && <p role="alert">{error}</p>}
    </>
  );
}
