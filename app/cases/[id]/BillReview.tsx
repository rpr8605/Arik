'use client';

// The real bill path on a case (Phases 2 to 4, outside DEMO_MODE): check
// what Arik read, line by line, then "Looks right" runs the bill checks,
// then a letter is drafted, edited, frozen and downloaded. Nothing is
// sent anywhere. Same steps as the demo walkthrough, live data.

import { useState } from 'react';
import { supabaseBrowser } from '@/lib/supabaseBrowser';
import { SendFlow } from './SendFlow';
import type { ExtractedDocument, Finding } from '@/lib/production/types';

type Line = { date: string; code: string; description: string; units: string; chargeUsd: string };
type Header = { patientName: string; provider: string; accountNumber: string; statementDate: string; serviceFrom: string; serviceTo: string; totalChargesUsd: string; amountDueUsd: string };
type Letter = { id: string; subject: string; body: string; footer: string; status: 'draft' | 'frozen'; letter_type: string; version: number };

const HEADER_LABELS: [keyof Header, string, string][] = [
  ['patientName', 'Patient name', 'text'],
  ['provider', 'Billed by', 'text'],
  ['accountNumber', 'Account number', 'text'],
  ['statementDate', 'Statement date', 'date'],
  ['serviceFrom', 'Care started', 'date'],
  ['serviceTo', 'Care ended', 'date'],
  ['totalChargesUsd', 'Total charges ($)', 'number'],
  ['amountDueUsd', 'Amount you owe ($)', 'number'],
];
const usd = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const s = (v: unknown) => (v == null ? '' : String(v));
const big = { minHeight: 48, padding: '0 1rem' } as const;

async function api(path: string, init: RequestInit = {}) {
  const { data: { session } } = await supabaseBrowser().auth.getSession();
  return fetch(path, { ...init, headers: { ...(init.body ? { 'content-type': 'application/json' } : {}), Authorization: `Bearer ${session?.access_token ?? ''}` } });
}

export function BillReview({ caseId, documentId, reading }: { caseId: string; documentId: string; reading: ExtractedDocument }) {
  const [header, setHeader] = useState<Header>(() => Object.fromEntries(HEADER_LABELS.map(([k]) => [k, s(reading.header[k].value)])) as Header);
  const [lines, setLines] = useState<Line[]>(() => reading.lines.map((l) => ({ date: s(l.date.value), code: s(l.code.value), description: s(l.description.value), units: s(l.units.value), chargeUsd: s(l.chargeUsd.value) })));
  const [findings, setFindings] = useState<Finding[] | null>(null);
  const [total, setTotal] = useState(0);
  const [letter, setLetter] = useState<Letter | null>(null);
  const [phone, setPhone] = useState('');
  const [estimate, setEstimate] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
  const num = (v: string) => (v.trim() === '' ? null : Number(v.replace(/[$,]/g, '')));

  const confirm = () => run(async () => {
    const body = {
      header: { ...header, totalChargesUsd: num(header.totalChargesUsd), amountDueUsd: num(header.amountDueUsd) },
      lines: lines.map((l) => ({ date: l.date || null, code: l.code || null, description: l.description || null, units: l.units ? Number(l.units) : null, chargeUsd: num(l.chargeUsd) })),
      goodFaithEstimateUsd: num(estimate),
    };
    const res = await api(`/api/cases/${caseId}/documents/${documentId}/confirm`, { method: 'POST', body: JSON.stringify(body) });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error ? `Please check this: ${json.error}.` : 'Arik could not check this bill. Try again.');
    setFindings(json.findings);
    setTotal(json.total_usd);
    setLetter(null);
  });

  const write = (type: string) => run(async () => {
    const res = await api(`/api/cases/${caseId}/letters`, { method: 'POST', body: JSON.stringify({ documentId, type, phone: phone || undefined }) });
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

  const cell = { width: '100%', minHeight: 44, boxSizing: 'border-box' } as const;

  return (
    <section className="card" aria-label="Check your bill" style={{ marginTop: '1rem' }}>
      {!findings && (
        <>
          <h3>Here&apos;s what I read</h3>
          <p>Check it against your bill and fix anything I got wrong. I only check what you confirm.</p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '0.5rem' }}>
            {HEADER_LABELS.map(([k, label, type]) => (
              <label key={k}>
                {label}
                <input style={cell} type={type} step={type === 'number' ? '0.01' : undefined} value={header[k]} onChange={(e) => setHeader({ ...header, [k]: e.target.value })} />
              </label>
            ))}
          </div>
          <div style={{ overflowX: 'auto', marginTop: '0.75rem' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 560 }}>
              <thead>
                <tr><th>Date</th><th>Code</th><th>What it says</th><th>How many</th><th>Amount ($)</th><th aria-label="Remove" /></tr>
              </thead>
              <tbody>
                {lines.map((l, i) => (
                  <tr key={i}>
                    <td><input aria-label={`Line ${i + 1} date`} style={cell} type="date" value={l.date} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, date: e.target.value } : x)))} /></td>
                    <td><input aria-label={`Line ${i + 1} code`} style={cell} value={l.code} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, code: e.target.value } : x)))} /></td>
                    <td><input aria-label={`Line ${i + 1} description`} style={cell} value={l.description} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)))} /></td>
                    <td><input aria-label={`Line ${i + 1} how many`} style={cell} inputMode="numeric" value={l.units} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, units: e.target.value } : x)))} /></td>
                    <td><input aria-label={`Line ${i + 1} amount`} style={cell} inputMode="decimal" value={l.chargeUsd} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, chargeUsd: e.target.value } : x)))} /></td>
                    <td><button type="button" style={{ minHeight: 44, minWidth: 44 }} aria-label={`Remove line ${i + 1}`} onClick={() => setLines(lines.filter((_, j) => j !== i))}>x</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <label style={{ display: 'block', marginTop: '0.75rem' }}>
            If this provider gave you a good faith estimate before your care, its amount ($) (optional)
            <input style={cell} inputMode="decimal" value={estimate} onChange={(e) => setEstimate(e.target.value)} />
          </label>
          <div className="actions" style={{ marginTop: '0.75rem' }}>
            <button type="button" style={big} onClick={() => setLines([...lines, { date: '', code: '', description: '', units: '1', chargeUsd: '' }])}>Add a line</button>
            <button type="button" style={big} disabled={busy} onClick={confirm}>{busy ? 'Checking...' : 'Looks right'}</button>
          </div>
        </>
      )}

      {findings && !letter && (
        <>
          <h3>What I found</h3>
          {findings.length === 0 && <p>I didn&apos;t find anything to question on this bill. You can still ask for an itemized bill.</p>}
          {findings.map((f, i) => (
            <div key={f.id} className={`finding finding-${f.tone}`} style={{ display: 'flex', gap: '0.5rem', alignItems: 'baseline', marginBottom: '0.5rem' }}>
              <span className="finding-n">{i + 1}</span>
              <span>
                {f.plainText}
                {f.amountUsd != null && <strong className="finding-amt"> {usd(f.amountUsd)}</strong>}
              </span>
            </div>
          ))}
          {total > 0 && <p><strong>That&apos;s {usd(total)} in charges worth questioning.</strong></p>}
          <label>
            Your phone number for the letter (optional)
            <input style={cell} type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </label>
          <div className="actions" style={{ marginTop: '0.75rem' }}>
            {findings.length > 0 && <button type="button" style={big} disabled={busy} onClick={() => write('billing_dispute')}>Write a dispute letter</button>}
            <button type="button" style={big} disabled={busy} onClick={() => write('itemized_bill_request')}>Ask for an itemized bill</button>
            <button type="button" style={big} onClick={() => setFindings(null)}>Change what I read</button>
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
          {letter.status === 'frozen' && <SendFlow caseId={caseId} letterId={letter.id} />}
        </div>
      )}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
