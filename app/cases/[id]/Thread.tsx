'use client';

import { useEffect, useRef, useState } from 'react';
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
            <div style={{ whiteSpace: 'pre-wrap' }}>{m.content}</div>
            {m.corrections?.map((c) => (
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
                    <button type="button" onClick={() => resolveCorrection(c.id, 'confirm')}>
                      Update to {c.new_value}
                    </button>{' '}
                    <button type="button" onClick={() => resolveCorrection(c.id, 'dismiss')}>
                      Keep {c.old_value ?? 'current'}
                    </button>
                  </>
                )}
              </div>
            ))}
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
      </form>
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
