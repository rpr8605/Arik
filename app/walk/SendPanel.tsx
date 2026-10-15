'use client';

import { useEffect, useRef, useState } from 'react';
import type { DemoLetter } from '@/lib/walkthrough/letters';
import { newRef, type DemoReceipt } from './demoJobs';

const METHODS = ['Fax', 'Mail', 'Email', 'Portal'] as const;

// The send screen (scripted): recipient, method, attachments, a one-time
// finger signature, then a "Demo, not sent" receipt. No network call is
// made; nothing leaves the browser.
export function SendPanel({ letter, onSent }: { letter: DemoLetter; onSent: (r: DemoReceipt) => void }) {
  const [method, setMethod] = useState<(typeof METHODS)[number]>('Fax');
  const [signed, setSigned] = useState(false);
  const [state, setState] = useState<'ready' | 'sending' | 'sent'>('ready');
  const [receipt, setReceipt] = useState<DemoReceipt | null>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);

  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    const ratio = window.devicePixelRatio || 1;
    c.width = c.clientWidth * ratio;
    c.height = c.clientHeight * ratio;
    ctx.scale(ratio, ratio);
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#22425c';
  }, []);

  function point(e: React.PointerEvent<HTMLCanvasElement>) {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  const to =
    method === 'Fax'
      ? `${letter.to.dept}, fax ${letter.to.fax}`
      : method === 'Mail'
        ? `${letter.to.dept}, ${letter.to.address}`
        : method === 'Email'
          ? letter.to.email
          : letter.to.portal;

  function send() {
    setState('sending');
    setTimeout(() => {
      const r: DemoReceipt = {
        ref: newRef(),
        title: letter.title,
        to: `${letter.to.name}, ${to}`,
        method,
        date: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
        status: 'Demo, not sent',
      };
      setReceipt(r);
      setState('sent');
      onSent(r);
    }, 1800);
  }

  if (state === 'sent' && receipt) {
    return (
      <div className="receipt" role="status">
        <p className="receipt-badge">Demo, not sent</p>
        <h3>{receipt.title}</h3>
        <dl>
          <dt>Reference</dt>
          <dd>{receipt.ref}</dd>
          <dt>Date</dt>
          <dd>{receipt.date}</dd>
          <dt>Method</dt>
          <dd>{receipt.method}</dd>
          <dt>To</dt>
          <dd>{receipt.to}</dd>
        </dl>
        <p>We&apos;ll watch for a reply. Typical response: 30 days.</p>
      </div>
    );
  }

  return (
    <div className="send-panel">
      <h3>Send to {letter.to.name}</h3>
      <p className="lede">{letter.to.dept}</p>
      <fieldset className="method-row">
        <legend>How to send</legend>
        {METHODS.map((m) => (
          <button key={m} type="button" aria-pressed={method === m} onClick={() => setMethod(m)} disabled={state !== 'ready'}>
            {m}
          </button>
        ))}
      </fieldset>
      <p className="send-to">To: {to}</p>
      <p className="send-attach">Attached: {letter.title} (letter), {letter.attachments.join(', ')}</p>
      <div className="sign">
        <p>Sign once to let Arik send for you</p>
        <canvas
          ref={canvas}
          className="sign-pad"
          aria-label="Signature pad: draw your signature with a finger"
          onPointerDown={(e) => {
            drawing.current = true;
            e.currentTarget.setPointerCapture(e.pointerId);
            const ctx = e.currentTarget.getContext('2d')!;
            const p = point(e);
            ctx.beginPath();
            ctx.moveTo(p.x, p.y);
          }}
          onPointerMove={(e) => {
            if (!drawing.current) return;
            const ctx = e.currentTarget.getContext('2d')!;
            const p = point(e);
            ctx.lineTo(p.x, p.y);
            ctx.stroke();
            setSigned(true);
          }}
          onPointerUp={() => (drawing.current = false)}
        />
        <div className="actions">
          <button
            type="button"
            onClick={() => {
              const c = canvas.current!;
              c.getContext('2d')!.clearRect(0, 0, c.width, c.height);
              setSigned(false);
            }}
          >
            Clear
          </button>
          <button type="button" onClick={() => setSigned(true)} disabled={signed}>
            Use a typed signature
          </button>
        </div>
      </div>
      <button type="submit" className="send-btn" disabled={!signed || state === 'sending'} onClick={send}>
        {state === 'sending' ? 'Sending…' : 'Send'}
      </button>
      {state === 'sending' ? <div className="sending-bar" aria-hidden="true" /> : null}
      <p className="sheet-note">Demo: nothing is actually sent.</p>
    </div>
  );
}
