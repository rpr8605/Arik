'use client';

// The real denial path on a case (Phase 5, outside DEMO_MODE): check what
// Arik read from a denial letter, answer "Who pays your claims?", then
// "Looks right" runs the rules engine: the deadline, what may be wrong,
// what the appeal will say, and the letters that fit. Letters are drafted,
// edited, frozen and downloaded. Nothing is sent anywhere.

import { useEffect, useState } from 'react';
import { supabaseBrowser } from '@/lib/supabaseBrowser';
import type { DenialView } from '@/lib/production/denialReview';
import type { DenialDraft } from '@/lib/rules/denials/parse';

type Letter = { id: string; subject: string; body: string; footer: string; status: 'draft' | 'frozen'; letter_type: string; version: number };

const FUNDING: [string, string][] = [
  ['fully_insured', 'My job, and an insurance company pays the claims'],
  ['self_funded', 'My job, and my employer pays the claims itself (self-funded)'],
  ['marketplace', 'A plan I bought myself (Marketplace or HealthCare.gov)'],
  ['medicare_part_d', 'Medicare drug plan (Part D)'],
  ['medicare_advantage', 'Medicare Advantage plan'],
  ['medicaid', 'Medicaid'],
  ['unknown', "I don't know"],
];
const CATEGORY: [string, string][] = [
  ['medical_necessity', 'They say it was not medically necessary'],
  ['no_prior_authorization', 'They say it needed approval first'],
  ['excluded_service', 'They say the plan does not cover it'],
  ['administrative', 'A paperwork problem (missing information, coding, filing)'],
  ['no_reason_given', 'The letter does not say why'],
  ['other', 'Something else'],
];
const LETTER_WORDS: Record<string, string> = {
  insurer_appeal: 'Write my appeal',
  external_review_request: 'Ask for an external review',
  specific_reason_request: 'Ask for the specific reason',
  claim_file_request: 'Ask for my claim file',
  medical_necessity_request: 'Ask my doctor for a letter and records',
  part_d_exception: 'Ask for a drug coverage exception',
};
const usDate = (iso: string) => `${iso.slice(5, 7)}/${iso.slice(8, 10)}/${iso.slice(0, 4)}`;
const big = { minHeight: 48, padding: '0 1rem' } as const;
const cell = { width: '100%', minHeight: 44, boxSizing: 'border-box' } as const;

async function api(path: string, init: RequestInit = {}) {
  const { data: { session } } = await supabaseBrowser().auth.getSession();
  return fetch(path, { ...init, headers: { ...(init.body ? { 'content-type': 'application/json' } : {}), Authorization: `Bearer ${session?.access_token ?? ''}` } });
}

type Form = Record<string, string | boolean>;
const toForm = (d: DenialDraft): Form => ({
  payerName: d.payerName ?? '', providerName: d.providerName ?? '', planFunding: d.planFunding, medicaidDelivery: d.medicaidDelivery, category: d.category,
  carcCodes: d.carcCodes.join(', '), rarcCodes: d.rarcCodes.join(', '), serviceOrDrug: d.serviceOrDrug ?? '', serviceCode: d.serviceCode ?? '', isDrug: d.isDrug,
  noticeDate: d.noticeDate ?? '', dateOfService: d.dateOfService ?? '', requestDate: d.requestDate ?? '', appealLevel: d.appealLevel, timing: d.timing,
  isPriorAuthDecision: d.isPriorAuthDecision, isUrgent: d.isUrgent, statedReason: d.statedReason ?? '', claimNumber: d.claimNumber ?? '',
  letterDeadlineDays: d.letterDeadlineDays == null ? '' : String(d.letterDeadlineDays), paRef: '', paCode: '', paFrom: '', paTo: '',
});

export function DenialReview({ caseId, documentId }: { caseId: string; documentId: string }) {
  const [form, setForm] = useState<Form | null>(null);
  const [unsure, setUnsure] = useState<string[]>([]);
  const [review, setReview] = useState<DenialView | null>(null);
  const [letter, setLetter] = useState<Letter | null>(null);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const res = await api(`/api/cases/${caseId}/documents/${documentId}/denial`);
      const json = await res.json();
      if (!res.ok) return setError(json.error ?? 'Arik could not read this letter.');
      setForm(toForm(json.draft));
      setUnsure(json.draft.unsure ?? []);
      if (json.review) setReview(json.review);
    })().catch(() => setError('Arik could not read this letter.'));
  }, [caseId, documentId]);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const set = (k: string, v: string | boolean) => setForm({ ...form!, [k]: v });
  const list = (v: string | boolean) => String(v).split(/[,\s]+/).map((x) => x.trim()).filter(Boolean);

  const confirm = () => run(async () => {
    const f = form!;
    const body = {
      ...Object.fromEntries(['payerName', 'providerName', 'planFunding', 'medicaidDelivery', 'category', 'serviceOrDrug', 'serviceCode', 'noticeDate', 'dateOfService', 'requestDate', 'appealLevel', 'timing', 'statedReason', 'claimNumber'].map((k) => [k, f[k] || null])),
      isDrug: !!f.isDrug, isUrgent: !!f.isUrgent, isPriorAuthDecision: !!f.isPriorAuthDecision,
      carcCodes: list(f.carcCodes), rarcCodes: list(f.rarcCodes),
      letterDeadlineDays: f.letterDeadlineDays ? Number(f.letterDeadlineDays) : null,
      priorAuth: f.paFrom && f.paTo ? { reference: f.paRef || null, serviceCode: f.paCode || null, validFrom: f.paFrom, validTo: f.paTo } : null,
    };
    const res = await api(`/api/cases/${caseId}/documents/${documentId}/denial`, { method: 'POST', body: JSON.stringify(body) });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error ? `Please check this: ${json.error}.` : 'Arik could not check this letter. Try again.');
    setReview(json.review);
    setLetter(null);
  });

  const write = (type: string) => run(async () => {
    if (name.trim().length < 2) throw new Error('Type your name as it should appear on the letter.');
    const res = await api(`/api/cases/${caseId}/letters`, { method: 'POST', body: JSON.stringify({ documentId, type, name, phone: phone || undefined }) });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error ?? 'Arik could not write the letter. Try again.');
    setLetter(json.letter);
  });

  const save = () => run(async () => {
    const res = await api(`/api/cases/${caseId}/letters/${letter!.id}`, { method: 'PATCH', body: JSON.stringify({ subject: letter!.subject, body: letter!.body }) });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error ?? 'Could not save your changes.');
    setLetter(json.letter);
  });

  const freezeAndDownload = () => run(async () => {
    let l = letter!;
    if (l.status === 'draft') {
      const res = await api(`/api/cases/${caseId}/letters/${l.id}`, { method: 'PATCH', body: JSON.stringify({ action: 'freeze' }) });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Could not save the final copy.');
      l = json.letter;
      setLetter(l);
    }
    const pdf = await api(`/api/cases/${caseId}/letters/${l.id}?format=pdf`);
    if (!pdf.ok) throw new Error('Could not make the PDF. Try again.');
    const url = URL.createObjectURL(await pdf.blob());
    const a = document.createElement('a');
    a.href = url;
    a.download = `letter-${l.letter_type}-v${l.version}.pdf`;
    a.click();
    URL.revokeObjectURL(url);
  });

  const mark = (k: string) => (unsure.includes(k) ? { outline: '2px solid var(--coral, #e8735a)' } : {});
  const text = (k: string, label: string, type = 'text') => (
    <label key={k}>
      {label}
      <input style={{ ...cell, ...mark(k) }} type={type} value={String(form![k] ?? '')} onChange={(e) => set(k, e.target.value)} />
    </label>
  );
  const box = (k: string, label: string) => (
    <label key={k} style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', minHeight: 44 }}>
      <input type="checkbox" style={{ width: 24, height: 24 }} checked={!!form![k]} onChange={(e) => set(k, e.target.checked)} />
      {label}
    </label>
  );

  if (!form && !error) return <p>Reading your letter...</p>;
  const deadline = review?.flags.find((f) => f.id === 'patient_deadline');

  return (
    <section className="card" aria-label="Check your denial" style={{ marginTop: '1rem' }}>
      {form && !review && (
        <>
          <h3>Here&apos;s what I read</h3>
          <p>Check it against your letter and fix anything I got wrong. I only work from what you confirm.</p>
          <fieldset style={{ border: 0, padding: 0, ...mark('planFunding') }}>
            <legend><strong>Who pays your claims?</strong></legend>
            {FUNDING.map(([v, label]) => (
              <label key={v} style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', minHeight: 44 }}>
                <input type="radio" name="planFunding" style={{ width: 24, height: 24 }} checked={form.planFunding === v} onChange={() => set('planFunding', v)} />
                {label}
              </label>
            ))}
            {form.planFunding === 'unknown' && <p>Ask HR or your benefits office whether the plan is &quot;self-funded&quot; or &quot;fully insured&quot;, or look in your plan summary. Until you know, use the deadline printed on the letter.</p>}
            {form.planFunding === 'medicaid' && (
              <label>
                Who sent the letter?
                <select style={cell} value={String(form.medicaidDelivery)} onChange={(e) => set('medicaidDelivery', e.target.value)}>
                  <option value="managed_care">My Medicaid health plan</option>
                  <option value="state">The state Medicaid office</option>
                  <option value="unknown">I&apos;m not sure</option>
                </select>
              </label>
            )}
          </fieldset>
          <label>
            Why they said no
            <select style={{ ...cell, ...mark('category') }} value={String(form.category)} onChange={(e) => set('category', e.target.value)}>
              {CATEGORY.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </label>
          <label>
            Their reason, as printed
            <textarea style={{ ...cell, minHeight: 72 }} value={String(form.statedReason)} onChange={(e) => set('statedReason', e.target.value)} />
          </label>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '0.5rem' }}>
            {text('payerName', 'Insurance plan')}
            {text('noticeDate', 'Date on the letter', 'date')}
            {text('claimNumber', 'Claim number')}
            {text('serviceOrDrug', 'Care or drug denied')}
            {text('serviceCode', 'Code (if shown)')}
            {text('dateOfService', 'Date of care', 'date')}
            {text('carcCodes', 'Reason codes (numbers)')}
            {text('rarcCodes', 'Remark codes')}
            {text('providerName', 'Your doctor or hospital')}
            {text('letterDeadlineDays', 'Days to appeal the letter gives')}
            {text('requestDate', 'When you sent the request or appeal (if known)', 'date')}
          </div>
          <label>
            This letter is
            <select style={cell} value={String(form.appealLevel)} onChange={(e) => set('appealLevel', e.target.value)}>
              <option value="initial">The plan&apos;s first answer</option>
              <option value="internal_appeal">The answer to my appeal</option>
            </select>
          </label>
          <label>
            The care was
            <select style={{ ...cell, ...mark('timing') }} value={String(form.timing)} onChange={(e) => set('timing', e.target.value)}>
              <option value="pre_service">Not received yet</option>
              <option value="post_service">Already received</option>
              <option value="payment">A drug I already paid for</option>
            </select>
          </label>
          {box('isUrgent', 'Waiting could seriously harm my health (urgent)')}
          {box('isPriorAuthDecision', 'This was a request for approval before care')}
          {box('isDrug', 'This is a prescription drug')}
          {form.category === 'no_prior_authorization' && (
            <fieldset style={{ border: 0, padding: 0 }}>
              <legend>If you have an approval for this care, enter it</legend>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '0.5rem' }}>
                {text('paRef', 'Approval number')}
                {text('paCode', 'Code approved')}
                {text('paFrom', 'Approved from', 'date')}
                {text('paTo', 'Approved to', 'date')}
              </div>
            </fieldset>
          )}
          <div className="actions" style={{ marginTop: '0.75rem' }}>
            <button type="button" style={big} disabled={busy} onClick={confirm}>{busy ? 'Checking...' : 'Looks right'}</button>
          </div>
        </>
      )}

      {review && !letter && (
        <>
          <h3>{review.category.title}</h3>
          <p>{review.category.plain}</p>
          {deadline && (
            <p className={`finding finding-${deadline.status === 'ok' ? 'ask' : 'wrong'}`} role="status">
              <strong>{deadline.deadline?.due ? `Deadline: ${usDate(deadline.deadline.due)}` : 'Your deadline'}</strong> {deadline.plainText}
            </p>
          )}
          {review.codes.length > 0 && (
            <p>
              Codes on the letter:{' '}
              {review.codes.map((c, i) => (
                <span key={c.code}>
                  {i > 0 && ', '}
                  {c.code}
                  {c.explanation ? ` (${c.explanation})` : ''}
                </span>
              ))}
              . <a href={review.codes[0].url} target="_blank" rel="noreferrer">What the codes mean (x12.org)</a>
            </p>
          )}
          <h4>What I found</h4>
          {review.flags.filter((f) => f.id !== 'patient_deadline').map((f, i) => (
            <div key={f.id} className={`finding finding-${f.tone === 'wrong' ? 'wrong' : 'ask'}`} style={{ display: 'flex', gap: '0.5rem', alignItems: 'baseline', marginBottom: '0.5rem' }}>
              <span className="finding-n">{i + 1}</span>
              <span>{f.plainText}</span>
            </div>
          ))}
          <h4>What your appeal will say</h4>
          <ol>{review.arguments.map((a) => <li key={a.type}>{a.sentence}</li>)}</ol>
          <label>
            Your name, as it should appear on the letter
            <input style={cell} value={name} autoComplete="name" onChange={(e) => setName(e.target.value)} />
          </label>
          <label>
            Your phone number for the letter (optional)
            <input style={cell} type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </label>
          <div className="actions" style={{ marginTop: '0.75rem', flexWrap: 'wrap' }}>
            {review.letterOptions.map((t) => <button key={t} type="button" style={big} disabled={busy} onClick={() => write(t)}>{LETTER_WORDS[t] ?? t}</button>)}
            <button type="button" style={big} onClick={() => setReview(null)}>Change what I read</button>
          </div>
        </>
      )}

      {letter && (
        <div className="letter-wrap">
          <h3>Your letter</h3>
          <p>{letter.status === 'frozen' ? 'This is the final copy. It downloads exactly as saved.' : 'Edit anything you like. When it is right, save the final copy and download it. Nothing is sent.'}</p>
          <label>
            Subject
            <input style={cell} value={letter.subject} readOnly={letter.status === 'frozen'} onChange={(e) => setLetter({ ...letter, subject: e.target.value })} />
          </label>
          <label>
            Letter
            <textarea className="letter-edit" style={{ width: '100%', minHeight: 320, boxSizing: 'border-box' }} value={letter.body} readOnly={letter.status === 'frozen'} onChange={(e) => setLetter({ ...letter, body: e.target.value })} />
          </label>
          <p className="paper-footer">{letter.footer}</p>
          <div className="actions">
            {letter.status === 'draft' && <button type="button" style={big} disabled={busy} onClick={save}>Save my changes</button>}
            <button type="button" style={big} disabled={busy} onClick={freezeAndDownload}>{letter.status === 'draft' ? 'Save final copy and download PDF' : 'Download PDF'}</button>
            <button type="button" style={big} onClick={() => setLetter(null)}>Back to what I found</button>
          </div>
        </div>
      )}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
