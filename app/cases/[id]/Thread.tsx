'use client';

import { useEffect, useRef, useState } from 'react';
import { fieldLabel } from '@/lib/caseCard';
import { AttachSheet } from './AttachSheet';
import { useRouter } from 'next/navigation';
import { supabaseBrowser } from '@/lib/supabaseBrowser';
import { Markdown } from '@/app/Markdown';

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

function STYLE_WORDS(offer: { length?: string; order?: string }): string {
  const parts: string[] = [];
  if (offer.length === 'short') parts.push('short answers');
  if (offer.length === 'detailed') parts.push('detailed answers');
  if (offer.length === 'normal') parts.push('normal-length answers');
  if (offer.order === 'answer_first') parts.push('the answer first');
  if (offer.order === 'context_first') parts.push('the background first');
  return parts.join(' and ') || 'this';
}


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
      <Markdown>{main}</Markdown>
      {details ? (
        <div style={{ marginTop: '0.35rem' }}>
          <button type="button" onClick={() => setShowDetails((s) => !s)}>
            {showDetails ? 'Hide details' : 'Show details'}
          </button>
          {showDetails ? (
            <div style={{ marginTop: '0.35rem', fontSize: '0.92em' }}>
              <Markdown>{details}</Markdown>
            </div>
          ) : null}
        </div>
      ) : null}
      {corrections?.map((c) => (
        <div
          key={c.id}
          role="group"
          aria-label="Check a detail"
          style={{ border: '1px solid', padding: '0.5rem', marginTop: '0.5rem', maxWidth: '40rem' }}
        >
          {resolved[c.id] ? (
            <p>{resolved[c.id]}</p>
          ) : (
            <>
              <p>
                You mentioned <strong>{c.new_value}</strong> as your{' '}
                {fieldLabel(c.field)}, but I have{' '}
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
      <div className="actions" style={{ fontSize: '0.92em' }}>
        <button type="button" onClick={() => onRecovery('dont_know')}>I don&apos;t know</button>
        <button type="button" onClick={() => router.push('/')}>Start over</button>
        {programPhone ? (
          <a className="pill-link" href={`tel:${programPhone.replace(/[^0-9+]/g, '')}`}>
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
  introShown = false,
  suggestedFirst = null,
  caseId,
  demoMode = false,
}: {
  sessionId: string;
  initialMessages: Message[];
  firstMessage: string | null;
  // The welcome screen already showed Arik's intro; the first reply skips it.
  introShown?: boolean;
  // A one-tap first question (sample patients). Never sent automatically:
  // a model call only happens when the visitor taps it.
  suggestedFirst?: string | null;
  // For the "+" sheet: the real upload targets this case; in DEMO_MODE the
  // sheet shows sample documents only.
  caseId: string;
  demoMode?: boolean;
}) {
  const [attachOpen, setAttachOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // correction id -> outcome, once the patient has tapped
  const [resolved, setResolved] = useState<Record<string, string>>({});
  const [programPhone, setProgramPhone] = useState<string | null>(null);
  const [comingSoon, setComingSoon] = useState<string | null>(null);
  // Persona one-tap offers (2026-10-14): remember a style the person just
  // asked for, or switch to Spanish. Both are explicit, never automatic.
  const [styleOffer, setStyleOffer] = useState<{ length?: string; order?: string } | null>(null);
  const [langOffer, setLangOffer] = useState<'es' | null>(null);
  const [offerNote, setOfferNote] = useState<string | null>(null);
  const sentFirst = useRef(false);
  const endRef = useRef<HTMLDivElement>(null);

  // Mobile-ready pass (2026-10-14): keep the newest message in view, after
  // every new message and when the keyboard opens.
  const scrollToLatest = () => endRef.current?.scrollIntoView({ block: 'end' });
  useEffect(() => {
    scrollToLatest();
  }, [messages.length, busy]);

  // iOS Safari lays the keyboard OVER the page instead of resizing it, so
  // the sticky composer would sit under it. The visual viewport says how
  // much is covered; globals.css lifts .composer by --kb-inset. (Android
  // Chrome resizes the page itself, so the inset stays 0 there.)
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const root = document.documentElement;
    const update = () => {
      const inset = Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop));
      root.style.setProperty('--kb-inset', `${inset}px`);
    };
    update();
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    return () => {
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
      root.style.removeProperty('--kb-inset');
    };
  }, []);

  async function send(text: string, opts: { introShown?: boolean } = {}) {
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
        body: JSON.stringify({ message: text, sessionId, introShown: opts.introShown === true }),
      });
      const json = await res.json();
      // Rate-limit answers (429/503) are already written for people; any
      // other failure gets one plain sentence instead of a server message.
      if (!res.ok) {
        throw new Error(
          (res.status === 429 || res.status === 503) && json.error
            ? json.error
            : 'Something went wrong. Try sending that again.',
        );
      }
      setProgramPhone(json.program_phone ?? null);
      setStyleOffer(json.style_suggestion ?? null);
      setLangOffer(json.language_suggestion === 'es' ? 'es' : null);
      setOfferNote(null);
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

  async function authedFetch(url: string, init: RequestInit) {
    const {
      data: { session },
    } = await supabaseBrowser().auth.getSession();
    return fetch(url, {
      ...init,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token ?? ''}` },
    });
  }

  async function rememberStyle() {
    if (!styleOffer) return;
    try {
      const res = await authedFetch('/api/preferences/style', { method: 'PUT', body: JSON.stringify(styleOffer) });
      if (!res.ok) throw new Error();
      setOfferNote('Saved. You can change or delete it in Settings (the gear at the top).');
    } catch {
      setOfferNote("Couldn't save that right now.");
    }
    setStyleOffer(null);
  }

  async function switchToSpanish() {
    try {
      const res = await authedFetch('/api/preferences', { method: 'PUT', body: JSON.stringify({ preferred_language: 'es' }) });
      if (!res.ok) throw new Error();
      setOfferNote('Listo: Arik le responderá en español.');
    } catch {
      setOfferNote('No se pudo cambiar el idioma ahora.');
    }
    setLangOffer(null);
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
        [id]: action === 'confirm' ? `Updated to "${json.value}".` : 'Kept what Arik had before.',
      }));
    } catch (e) {
      setError((e as Error).message);
    }
  }

  useEffect(() => {
    if (firstMessage && !sentFirst.current) {
      sentFirst.current = true;
      send(firstMessage, { introShown });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firstMessage]);

  return (
    <section aria-label="Conversation with Arik">
      {suggestedFirst && messages.length === 0 && !busy ? (
        <div className="suggested-first">
          <p>Start with:</p>
          <button type="button" onClick={() => send(suggestedFirst)}>
            {suggestedFirst}
          </button>
        </div>
      ) : null}
      <div aria-live="polite">
        {messages.map((m, i) => (
          <div key={i} className={m.role === 'user' ? 'msg msg-user' : 'msg msg-arik'}>
            {m.role === 'assistant' ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img className="msg-avatar" src="/brand/arik-mark-h84.webp" alt="" width={28} height={28} />
            ) : null}
            <span className="sr-only">{m.role === 'user' ? 'You said:' : 'Arik said:'}</span>
            <div className="bubble-body">
            {m.role === 'assistant' ? (
              <AssistantMessage
                content={m.content}
                corrections={m.corrections}
                resolved={resolved}
                onResolveCorrection={resolveCorrection}
                onRecovery={(kind) => {
                  if (kind === 'dont_know' && !busy) {
                    send("I don't know what to do next. Can you explain this another way?");
                  }
                }}
                programPhone={programPhone}
              />
            ) : (
              <div style={{ whiteSpace: 'pre-wrap' }}>{m.content}</div>
            )}
            </div>
          </div>
        ))}
        {busy && <p>Arik is working…</p>}
        {styleOffer && !busy ? (
          <div className="card" role="group" aria-label="Remember this preference" style={{ marginBottom: '1rem', padding: '0.9rem 1rem' }}>
            <p style={{ margin: '0 0 0.5rem' }}>
              Want me to remember {STYLE_WORDS(styleOffer)} for next time?
            </p>
            <div className="actions">
              <button type="button" onClick={rememberStyle}>Remember this</button>
              <button type="button" onClick={() => setStyleOffer(null)}>No thanks</button>
            </div>
          </div>
        ) : null}
        {langOffer && !busy ? (
          <div className="card" role="group" aria-label="Cambiar a español" lang="es" style={{ marginBottom: '1rem', padding: '0.9rem 1rem' }}>
            <p style={{ margin: '0 0 0.5rem' }}>¿Prefiere que Arik le responda en español?</p>
            <div className="actions">
              <button type="button" onClick={switchToSpanish}>Sí, en español</button>
              <button type="button" onClick={() => setLangOffer(null)}>No, gracias</button>
            </div>
          </div>
        ) : null}
        {offerNote ? <p role="status">{offerNote}</p> : null}
        <div ref={endRef} className="chat-end" />
      </div>
      <form
        className="composer"
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
          aria-label="Voice input: coming soon"
          title="Voice input: coming soon"
          onClick={() => setComingSoon('Voice input: coming soon')}
          className="icon-btn"
          style={{ opacity: 0.5, cursor: 'default' }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <rect x="9" y="2" width="6" height="12" rx="3" />
            <path d="M5 10a7 7 0 0 0 14 0M12 19v3" />
          </svg>
        </button>
        <button
          type="button"
          aria-label={demoMode ? 'Add a sample document' : 'Add a document or photo'}
          aria-haspopup="dialog"
          onClick={() => setAttachOpen(true)}
          className="icon-btn plus-btn"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
            <path d="M12 5v14M5 12h14" />
          </svg>
        </button>
        <input
          id="reply"
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Reply…"
          disabled={busy}
          enterKeyHint="send"
          autoComplete="off"
          onFocus={() => setTimeout(scrollToLatest, 350)}
        />
        <button type="submit" disabled={busy}>Send</button>
      </form>
      {comingSoon ? <p style={{ fontSize: '0.9em', margin: '0.25rem 0 0' }}>{comingSoon}</p> : null}
      {error && <p role="alert">{error}</p>}
      {attachOpen ? <AttachSheet caseId={caseId} demoMode={demoMode} onClose={() => setAttachOpen(false)} /> : null}
    </section>
  );
}
