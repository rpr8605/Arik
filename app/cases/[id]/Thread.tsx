'use client';

import { useEffect, useRef, useState } from 'react';
import { supabaseBrowser } from '@/lib/supabaseBrowser';

interface Message {
  role: string;
  content: string;
}

// One chat thread per case (CASE_MODEL.md). The first message - the
// patient's own description of the problem - is sent automatically when
// arriving from the "what's going on?" front door.
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
      setMessages((m) => [...m, { role: 'assistant', content: json.response }]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
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
