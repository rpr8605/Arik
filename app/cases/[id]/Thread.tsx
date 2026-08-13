'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabaseBrowser } from '@/lib/supabaseBrowser';

interface Correction {
  id: string;
  field: string;
  old_value: string | null;
  new_value: string;
}

interface Message {
  role: string;
  content: string;
  corrections?: Correction[];
}

const FIELD_LABELS: Record<string, string> = {
  employer_name: 'employer',
  institution_name: 'hospital or clinic',
  insurance_plan_name: 'insurance plan',
  prescriber_name: 'prescriber',
  state_or_location_raw: 'location',
  zip_code: 'ZIP code',
  state: 'state',
};

// Assistant message with the guided-advocate structure (2026-08-12):
// the model writes the main answer, then a ---DETAILS--- marker, then the
// citations/trust receipt. The details render behind a toggle, and every
// assistant answer carries the recovery actions. "Call the program"
// renders ONLY when the API returned a real, sourced number
// (programPhone) — never fabricated.
function AssistantMessage({
  content,
  corrections,
  resolved,
  onResolveCorrection,
  onRecovery,
  programPhone,
}: {
  content: string;
  corrections?: Correction[];
  resolved: Record<string, string>;
  onResolveCorrection: (id: string, action: 'confirm' | 'dismiss') => void;
  onRecovery: (kind: 'dont_know') => void;
  programPhone: string | null;
}) {
  const [showDetails, setShowDetails] = useState(false);
  const router = useRouter();
  const parts = content.split(/\n?---DETAILS---\n?/);
  const main = parts[0];
  const details = parts.length > 1 ? parts.slice(1).join('\n---DETAILS---\n') : null;

  return (
    <div>
      <div style={{ whiteSpace: 'pre-wrap' }}>{main}</div>
      {details ? (
        <div style={{ marginTop: '0.35rem' }}>
          <button type="button" onClick={() => setShowDetails((s) => !s)}>
            {showDetails ? 'Hide details' : 'Show details'}
          </button>
          {showDetails ? (
            <div style={{ whiteSpace: 'pre-wrap', marginTop: '0.35rem', fontSize: '0.92em' }}>{details}</div>
          ) : null}
        </div>
      ) : null}
      {corrections?.map((c) => (
        <div
          key={c.id}
          role="group"
          aria-label="Confirm a correction"
          style={{ border: '1px solid', padding: '0.5rem', marginTop: '0.5rem', maxWidth: '40rem' }}
        >
          {resolved[c.id] ? (
            <p>{resolved[c.id]}</p>
          ) : (
            <>
              <p>
                You mentioned <strong>{c.new_value}</strong> as your{' '}
                {FIELD_LABELS[c.field] ?? c.field}, but I have{' '}
                <strong>{c.old_value ?? 'nothing'}</strong> on file. Update it?
              </p>
              <button type="button" onClick={() => onResolveCorrection(c.id, 'confirm')}>
                Update to {c.new_value}
              </button>{' '}
              <button type="button" onClick={() => onResolveCorrection(c.id, 'dismiss')}>
                Keep {c.old_value ?? 'current'}
              </button>
            </>
          )}
        </div>
      ))}
      <div style={{ marginTop: '0.4rem', fontSize: '0.92em' }}>
        <button type="button" onClick={() => onRecovery('dont_know')}>I don&apos;t know</button>{' '}
        <button type="button" onClick={() => router.push('/')}>Start over</button>{' '}
        {programPhone ? (
          <a href={`tel:${programPhone.replace(/[^0-9+]/g, '')}`} style={{ textDecoration: 'underline' }}>
            Call the program: {programPhone}
          </a>
        ) : null}
      </div>
    </div>
  );
}

// One chat thread per case (CASE_MODEL.md). The first message - the
// patient's own description of the problem - is sent automatically when
// arriving from the "what's going on?" front door.
//
// Contradicting extractions arrive on the assistant message as pending
// corrections (don't-silently-overwrite). They render as inline one-tap
// cards; nothing changes until the patient confirms, and the existing
// value keeps being used meanwhile - a pending correction never blocks
// case work.
export function Thread({
  sessionId,
  initialMessages,
  firstMessage,
}: {
  sessionId: string;
  initialMessages: Message[];
  firstMessage: string | null;
}) {
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // correction id -> outcome, once the patient has tapped
  const [resolved, setResolved] = useState<Record<string, string>>({});
  const [programPhone, setProgramPhone] = useState<string | null>(null);
  const [comingSoon, setComingSoon] = useState<string | null>(null);
  const sentFirst = useRef(false);

  async function send(text: string) {
    setBusy(true);
    setError(null);
    setMessages((m) => [...m, { role: 'user', content: text }]);
    try {
      const {
        data: { session },
      } = await supabaseBrowser().auth.getSession();
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session?.access_token ?? ''}`,
        },
        body: JSON.stringify({ message: text, sessionId }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? `request failed (${res.status})`);
      setProgramPhone(json.program_phone ?? null);
      setMessages((m) => [
        ...m,
        {
          role: 'assistant',
          content: json.response,
          corrections: (json.corrections ?? []).length > 0 ? json.corrections : undefined,
        },
      ]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function resolveCorrection(id: string, action: 'confirm' | 'dismiss') {
    try {
      const {
        data: { session },
      } = await supabaseBrowser().auth.getSession();
      const res = await fetch('/api/corrections', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session?.access_token ?? ''}`,
        },
        body: JSON.stringify({ id, action }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? `request failed (${res.status})`);
      setResolved((r) => ({
        ...r,
        [id]: action === 'confirm' ? `Updated to "${json.value}".` : 'Kept the existing value.',
      }));
    } catch (e) {
      setError((e as Error).message);
    }
  }

  useEffect(() => {
    if (firstMessage && !sentFirst.current) {
      sentFirst.current = true;
      send(firstMessage);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firstMessage]);

  return (
    <section aria-label="Case conversation">
      <div aria-live="polite">
        {messages.map((m, i) => (
          <div key={i} style={{ marginBottom: '1rem' }}>
            <strong>{m.role === 'user' ? 'You' : 'Arik'}:</strong>
            {m.role === 'assistant' ? (
              <AssistantMessage
                content={m.content}
                corrections={m.corrections}
                resolved={resolved}
                onResolveCorrection={resolveCorrection}
                onRecovery={(kind) => {
                  if (kind === 'dont_know' && !busy) {
                    send("I don't know what to do next — can you explain this another way?");
                  }
                }}
                programPhone={programPhone}
              />
            ) : (
              <div style={{ whiteSpace: 'pre-wrap' }}>{m.content}</div>
            )}
          </div>
        ))}
        {busy && <p>Arik is working…</p>}
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!input.trim() || busy) return;
          send(input.trim());
          setInput('');
        }}
      >
        <label htmlFor="reply" className="sr-only">Reply</label>
        {/*
          PLACEHOLDER ICONS ONLY (2026-08-12 ticket) — deliberately not
          functional. Voice: when this gets built for real, the decision is
          between the browser-native Web Speech API (free, inconsistent
          cross-browser quality) and a third-party STT/TTS service (more
          reliable, adds a new vendor data-handling relationship) — that
          choice is for the real voice ticket, not now. Document/photo:
          NEVER wire this to capture or transmit a file until the PHI
          document-vault decisions (encryption at rest, access controls,
          data-handling policy) are made — a card photo is PHI on capture.
        */}
        <button
          type="button"
          aria-disabled="true"
          aria-label="Voice input — coming soon"
          title="Voice input — coming soon"
          onClick={() => setComingSoon('Voice input — coming soon')}
          style={{ opacity: 0.5, cursor: 'default', marginRight: '0.25rem' }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <rect x="9" y="2" width="6" height="12" rx="3" />
            <path d="M5 10a7 7 0 0 0 14 0M12 19v3" />
          </svg>
        </button>
        <button
          type="button"
          aria-disabled="true"
          aria-label="Document or photo upload — coming soon"
          title="Document or photo upload — coming soon"
          onClick={() => setComingSoon('Document or photo upload — coming soon')}
          style={{ opacity: 0.5, cursor: 'default', marginRight: '0.5rem' }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12" />
          </svg>
        </button>
        <input
          id="reply"
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Reply…"
          disabled={busy}
          style={{ width: '100%', maxWidth: '40rem' }}
        />
        <button type="submit" disabled={busy}>Send</button>
        {comingSoon ? <span style={{ marginLeft: '0.5rem', fontSize: '0.9em' }}>{comingSoon}</span> : null}
      </form>
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
