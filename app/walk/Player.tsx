'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { supabaseBrowser } from '@/lib/supabaseBrowser';
import { flowScript } from '@/lib/walkthrough/flows';
import { END_NOTE, TYPED_REPLY, formatUsd, renderTotal, type Step } from '@/lib/walkthrough/script';
import { LETTERS } from '@/lib/walkthrough/letters';
import { SAMPLE_DOCS, type SampleDoc } from '@/lib/demo/sampleDocs';
import { sampleByKey, SAMPLE_LABEL } from '@/lib/demo/samples';
import type { RxOptions } from '@/lib/demo/rxOptions';
import { AttachSheet } from '../cases/[id]/AttachSheet';
import { DocView } from './DocView';
import { LetterView } from './LetterView';
import { SendPanel } from './SendPanel';
import { RxResults, CallCard, bestPathText } from './RxCards';
import { addDemoJob, type DemoReceipt } from './demoJobs';

// Plays one scripted walkthrough (docs/kimi/DEMO_WALKTHROUGHS.md) in the
// chat look. Steps auto-advance until one needs the visitor (chips, pick,
// confirm, letter, send, call card). Typing never reaches a model.
// idx = the step's index in its sequence (-1 for items the player adds).
type Item =
  | { id: number; seq: string; idx: number; step: Step }
  | { id: number; seq: string; idx: number; step: { kind: 'user'; text: string; doc?: SampleDoc } }
  | { id: number; seq: string; idx: number; step: { kind: 'typed_reply' } }
  | { id: number; seq: string; idx: number; step: { kind: 'rx_explain'; text: string } };

const HALTS = new Set(['chips', 'pick', 'summary', 'letter', 'send', 'call_card']);
const docById = (id: string | null) => SAMPLE_DOCS.find((d) => d.id === id) ?? null;

export function Player({ flow, patient, drug }: { flow: string; patient: string | null; drug: string | null }) {
  const [script] = useState(() => flowScript(flow, patient, drug)!);
  const sample = sampleByKey(script.patient)!;
  const [items, setItems] = useState<Item[]>([]);
  const [pos, setPos] = useState<{ seq: string; idx: number } | null>({ seq: script.start, idx: 0 });
  const [halted, setHalted] = useState<number | null>(null); // item id waiting on the visitor
  const [picking, setPicking] = useState<string[] | null>(null);
  const [phone, setPhone] = useState('');
  const [rx, setRx] = useState<RxOptions | null>(null);
  const [rxError, setRxError] = useState(false);
  const [pulse, setPulse] = useState<number | null>(null);
  const [typed, setTyped] = useState('');
  const receipts = useRef<DemoReceipt[]>([]);
  const nextId = useRef(1);
  const endRef = useRef<HTMLDivElement>(null);
  const reduce = useRef(false);

  useEffect(() => {
    reduce.current = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }, []);
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end', behavior: reduce.current ? 'auto' : 'smooth' });
  }, [items.length, halted]);

  const push = (seq: string, step: Item['step'], idx = -1) => {
    const id = nextId.current++;
    setItems((xs) => [...xs, { id, seq, idx, step } as Item]);
    return id;
  };
  // Each position runs once (React dev mode runs effects twice).
  const ran = useRef(new Set<string>());

  // The step runner: append the step at pos; continue automatically unless
  // it needs the visitor.
  useEffect(() => {
    if (!pos) return;
    const steps = script.sequences[pos.seq];
    const step = steps?.[pos.idx];
    if (!step) {
      setPos(null);
      return;
    }
    const key = `${pos.seq}:${pos.idx}`;
    if (ran.current.has(key)) return;
    ran.current.add(key);
    const id = push(pos.seq, step, pos.idx);
    if (step.kind === 'job') {
      addDemoJob({ patient: script.patient, title: step.title, status: step.status, flow: step.flow, receipts: receipts.current });
    }
    if (step.kind === 'rx_results') {
      setRx(null);
      setRxError(false);
      (async () => {
        try {
          const {
            data: { session },
          } = await supabaseBrowser().auth.getSession();
          const res = await fetch(`/api/demo/rx?drug=${encodeURIComponent(step.drug)}&patient=${script.patient}`, {
            headers: { Authorization: `Bearer ${session?.access_token ?? ''}` },
          });
          if (!res.ok) throw new Error(String(res.status));
          const data = (await res.json()) as RxOptions;
          setRx(data);
          push(pos.seq, { kind: 'rx_explain', text: bestPathText(data, sample) });
          setPos({ seq: pos.seq, idx: pos.idx + 1 });
        } catch {
          setRxError(true);
        }
      })();
      return;
    }
    if (HALTS.has(step.kind)) {
      setHalted(id);
      return;
    }
    const delay =
      step.kind === 'reading' ? (reduce.current ? 1200 : step.lines.length * 1100) : step.kind === 'end' ? 0 : reduce.current ? 150 : 650;
    setTimeout(() => setPos({ seq: pos.seq, idx: pos.idx + 1 }), delay);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pos]);

  function advance(seq: string, idx: number) {
    setHalted(null);
    setPos({ seq, idx });
  }
  function go(seq: string, label?: string) {
    if (label) push(pos?.seq ?? seq, { kind: 'user', text: label });
    advance(seq, 0);
  }

  // Tap a box: scroll to its finding. Tap a finding: scroll to its box.
  // Either way both pulse.
  function jump(selector: string, n: number) {
    document.querySelector(selector)?.scrollIntoView({ block: 'center', behavior: reduce.current ? 'auto' : 'smooth' });
    setPulse(n);
    setTimeout(() => setPulse(null), 1400);
  }
  const onBox = (n: number) => jump(`[data-finding="${n}"]`, n);
  const onFinding = (n: number) => jump(`[data-box="${n}"]`, n);

  function render(item: Item) {
    const s = item.step;
    const live = halted === item.id;
    switch (s.kind) {
      case 'arik':
      case 'rx_explain':
        return <Arik>{s.text}</Arik>;
      case 'typed_reply':
        return <Arik>{TYPED_REPLY}</Arik>;
      case 'user':
        return (
          <div className="msg msg-user">
            <span className="sr-only">You said:</span>
            <div className="bubble-body">
              {s.doc?.image ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img className="picked-doc" src={s.doc.image} alt="" />
              ) : null}
              {s.text}
            </div>
          </div>
        );
      case 'chips':
        return live ? (
          <div className="walk-chips">
            {s.options.map((o) => (
              <button key={o.go + o.label} type="button" onClick={() => go(o.go, o.label)}>
                {o.label}
              </button>
            ))}
          </div>
        ) : null;
      case 'pick':
        return live ? (
          <div className="walk-chips">
            <button type="button" onClick={() => setPicking(s.docs)}>
              {s.text}
            </button>
          </div>
        ) : null;
      case 'reading': {
        const doc = docById(s.docId);
        return <Reading lines={s.lines} image={doc?.image ?? null} />;
      }
      case 'summary':
        return (
          <>
            <Arik>
              <p className="walk-label">Here&apos;s what I read:</p>
              <dl className="summary-list">
                {s.rows.map(([k, v]) => (
                  <div key={k}>
                    <dt>{k}</dt>
                    <dd>{v}</dd>
                  </div>
                ))}
              </dl>
              <p>Is that right?</p>
            </Arik>
            {live ? (
              <div className="walk-chips">
                <button type="button" onClick={() => go(s.go, s.confirm)}>
                  {s.confirm}
                </button>
              </div>
            ) : null}
          </>
        );
      case 'doc': {
        const doc = docById(s.docId)!;
        return <DocView src={doc.image!} title={doc.title} highlights={s.highlights} onBox={onBox} pulse={pulse} />;
      }
      case 'finding':
        return (
          <div className={`msg msg-arik finding finding-${s.tone}${pulse === s.n ? ' pulse' : ''}`} data-finding={s.n}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className="msg-avatar" src="/brand/arik-mark-h84.webp" alt="" width={28} height={28} />
            <button type="button" className="bubble-body finding-body" onClick={() => onFinding(s.n)}>
              <span className="finding-n">{s.n}</span>
              <span>
                {s.text}
                {s.amountUsd ? <strong className="finding-amt"> {formatUsd(s.amountUsd)}</strong> : null}
              </span>
            </button>
          </div>
        );
      case 'total':
        return (
          <Arik>
            <strong>{renderTotal(s.text, script.sequences[item.seq])}</strong>
          </Arik>
        );
      case 'letter':
        return (
          <LetterView
            letter={LETTERS[s.letterId]}
            phone={phone}
            onPhone={setPhone}
            done={!live}
            onContinue={() => advance(item.seq, item.idx + 1)}
          />
        );
      case 'send':
        return (
          <SendPanel
            letter={LETTERS[s.letterId]}
            onSent={(r) => {
              receipts.current = [...receipts.current, r];
              setTimeout(() => advance(item.seq, item.idx + 1), 900);
            }}
          />
        );
      case 'deadline':
        return <Deadline label={s.label} date={s.date} />;
      case 'rx_results':
        return rx ? (
          <RxResults data={rx} insuranceType={sample.subject.insuranceType} />
        ) : rxError ? (
          <Arik>
            Something hiccuped loading prices.{' '}
            <button type="button" onClick={() => window.location.reload()}>
              Tap to try again
            </button>
          </Arik>
        ) : (
          <Reading lines={['Pulling sourced prices...']} image={null} />
        );
      case 'call_card':
        return rx ? (
          <>
            <CallCard data={rx} sample={sample} onReceipt={(r) => (receipts.current = [...receipts.current, r])} />
            {live ? (
              <div className="walk-chips">
                <button type="button" onClick={() => advance(item.seq, item.idx + 1)}>
                  Save this to {sample.name}&apos;s jobs
                </button>
              </div>
            ) : null}
          </>
        ) : null;
      case 'job':
        return (
          <div className="job-added" role="status">
            Added to {sample.name}&apos;s jobs: <strong>{s.title}</strong> · {s.status}
          </div>
        );
      case 'end':
        return (
          <div className="walk-end">
            <p>{END_NOTE}</p>
            <div className="actions">
              <Link href={`/samples/${script.patient}`} className="pill-link">
                See {sample.name}&apos;s jobs
              </Link>
              <Link href="/" className="pill-link">
                Try another
              </Link>
            </div>
          </div>
        );
    }
  }

  return (
    <main className="walk">
      <p className="tag tag-sample">Sample case · {SAMPLE_LABEL}</p>
      <h1 className="walk-title">
        {script.title} <span>· {sample.name}</span>
      </h1>
      <section aria-label="Conversation with Arik" aria-live="polite">
        {items.map((item) => (
          <div key={item.id}>{render(item)}</div>
        ))}
        <div ref={endRef} className="chat-end" />
      </section>
      <form
        className="composer"
        onSubmit={(e) => {
          e.preventDefault();
          if (!typed.trim()) return;
          // Never sent anywhere: one fixed reply, then the options stay.
          push(pos?.seq ?? script.start, { kind: 'user', text: typed.trim() });
          push(pos?.seq ?? script.start, { kind: 'typed_reply' });
          setTyped('');
        }}
      >
        <label htmlFor="walk-reply" className="sr-only">
          Reply
        </label>
        <input
          id="walk-reply"
          type="text"
          autoComplete="off"
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          placeholder="Tap an option above, or type here"
        />
        <button type="submit">Send</button>
      </form>
      {picking ? (
        <AttachSheet
          caseId={null}
          demoMode
          only={picking}
          onClose={() => setPicking(null)}
          onPick={(doc) => {
            const item = items.find((i) => i.id === halted);
            if (!item || item.step.kind !== 'pick') return;
            const step = item.step;
            push(item.seq, { kind: 'user', text: doc.title, doc });
            setPicking(null);
            advance(step.go, 0);
          }}
        />
      ) : null}
    </main>
  );
}

function Arik({ children }: { children: React.ReactNode }) {
  return (
    <div className="msg msg-arik">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className="msg-avatar" src="/brand/arik-mark-h84.webp" alt="" width={28} height={28} />
      <span className="sr-only">Arik said:</span>
      <div className="bubble-body walk-text">{children}</div>
    </div>
  );
}

// Reading animation: a scanning line over the document and rotating lines.
function Reading({ lines, image }: { lines: string[]; image: string | null }) {
  const [i, setI] = useState(0);
  useEffect(() => {
    if (lines.length < 2) return;
    const t = setInterval(() => setI((x) => Math.min(x + 1, lines.length - 1)), 1100);
    return () => clearInterval(t);
  }, [lines.length]);
  return (
    <div className="scan" role="status" aria-live="polite">
      <div className="scan-doc">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {image ? <img src={image} alt="" /> : null}
        <div className="scan-line" aria-hidden="true" />
      </div>
      <p>{lines[i]}</p>
    </div>
  );
}

function Deadline({ label, date }: { label: string; date: string }) {
  const days = Math.ceil((new Date(date).getTime() - Date.now()) / 86_400_000);
  return (
    <div className="deadline" role="note">
      <span className="deadline-label">Deadline tracker</span>
      <strong>
        {label} {date}
      </strong>
      {days > 0 ? <span>{days} days from today</span> : null}
    </div>
  );
}
