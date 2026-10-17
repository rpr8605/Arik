'use client';

// Send a frozen letter (Phase 6, real path): the one-time authorization,
// the patient's signature on the letter, fax or mail, a one-screen review
// and one tap to approve. With the demo executors this is a practice send:
// nothing leaves Arik, and the receipt says so.

import { useEffect, useState } from 'react';
import { supabaseBrowser } from '@/lib/supabaseBrowser';
import { SignaturePad } from './SignaturePad';

type Address = { name: string; line1: string; line2: string; city: string; state: string; zip: string };
const emptyAddr = (): Address => ({ name: '', line1: '', line2: '', city: '', state: '', zip: '' });
const big = { minHeight: 48, padding: '0 1rem' } as const;
const cell = { width: '100%', minHeight: 44, boxSizing: 'border-box' } as const;

async function api(path: string, init: RequestInit = {}) {
  const { data: { session } } = await supabaseBrowser().auth.getSession();
  return fetch(path, { ...init, headers: { ...(init.body ? { 'content-type': 'application/json' } : {}), Authorization: `Bearer ${session?.access_token ?? ''}` } });
}

export function SendFlow({ caseId, letterId, signerName }: { caseId: string; letterId: string; signerName?: string }) {
  const [auth, setAuth] = useState<{ current: unknown; text: string; version: string } | null>(null);
  const [name, setName] = useState(signerName ?? '');
  const [authSig, setAuthSig] = useState<string | null>(null);
  const [letterSig, setLetterSig] = useState<string | null>(null);
  const [letterSigned, setLetterSigned] = useState(false);
  const [channel, setChannel] = useState<'fax' | 'mail'>('fax');
  const [recipientName, setRecipientName] = useState('');
  const [fax, setFax] = useState('');
  const [to, setTo] = useState<Address>(emptyAddr);
  const [from, setFrom] = useState<Address>(emptyAddr);
  const [certified, setCertified] = useState(true);
  const [prepared, setPrepared] = useState<{ job: { id: string }; summary: { letter: string; shares: string[]; practice: boolean; certified: boolean } } | null>(null);
  const [done, setDone] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api('/api/authorization').then((r) => r.json()).then(setAuth).catch(() => setError('Could not load the authorization.'));
  }, []);

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
  const post = async (path: string, body: unknown) => {
    const res = await api(path, { method: 'POST', body: JSON.stringify(body) });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error ?? 'Something went wrong. Try again.');
    return json;
  };

  const signAuth = () => run(async () => {
    await post('/api/authorization', { name, signature: authSig });
    setAuth({ ...auth!, current: { signed: true } });
  });
  const signLetter = () => run(async () => {
    await post(`/api/cases/${caseId}/letters/${letterId}/sign`, { name, signature: letterSig });
    setLetterSigned(true);
  });
  const prepare = () => run(async () => {
    const strip = (a: Address) => ({ ...a, state: a.state.toUpperCase(), line2: a.line2 || null });
    const body = channel === 'fax' ? { letterId, channel, recipientName, fax } : { letterId, channel, recipientName, address: strip({ ...to, name: recipientName }), returnAddress: strip({ ...from, name }), certified };
    setPrepared(await post(`/api/cases/${caseId}/jobs`, body));
  });
  const approve = () => run(async () => {
    const out = await post(`/api/cases/${caseId}/jobs/${prepared!.job.id}`, { action: 'approve' });
    setDone(out.job);
  });
  const cancel = () => run(async () => {
    await post(`/api/cases/${caseId}/jobs/${prepared!.job.id}`, { action: 'cancel' });
    setPrepared(null);
  });

  const addr = (a: Address, set: (a: Address) => void, label: string) => (
    <fieldset style={{ border: 0, padding: 0 }}>
      <legend>{label}</legend>
      <input style={cell} aria-label={`${label} street`} placeholder="Street" value={a.line1} onChange={(e) => set({ ...a, line1: e.target.value })} />
      <input style={cell} aria-label={`${label} line 2`} placeholder="Suite or unit (optional)" value={a.line2} onChange={(e) => set({ ...a, line2: e.target.value })} />
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: '0.5rem' }}>
        <input style={cell} aria-label={`${label} city`} placeholder="City" value={a.city} onChange={(e) => set({ ...a, city: e.target.value })} />
        <input style={cell} aria-label={`${label} state`} placeholder="State" maxLength={2} value={a.state} onChange={(e) => set({ ...a, state: e.target.value })} />
        <input style={cell} aria-label={`${label} ZIP`} placeholder="ZIP" inputMode="numeric" value={a.zip} onChange={(e) => set({ ...a, zip: e.target.value })} />
      </div>
    </fieldset>
  );

  if (!auth) return error ? <p role="alert">{error}</p> : <p>Loading...</p>;

  if (done) {
    return (
      <div className="receipt" role="status">
        {done.practice && <p className="receipt-badge">Practice send: nothing left Arik</p>}
        <h3>{done.status === 'failed' ? 'Not sent' : done.status === 'delivered' ? 'Delivered' : 'Sent'}</h3>
        <dl>
          <dt>Confirmation</dt>
          <dd>{done.confirmation ?? 'None'}</dd>
          {done.tracking && (<><dt>Tracking</dt><dd>{done.tracking}</dd></>)}
          <dt>Method</dt>
          <dd>{done.channel === 'fax' ? 'Fax' : done.certified ? 'Certified mail' : 'Mail'}</dd>
        </dl>
        <p>{done.response_due ? `Arik is watching for a reply. The answer is due by ${done.response_due.slice(5, 7)}/${done.response_due.slice(8, 10)}/${done.response_due.slice(0, 4)}.` : 'Arik is watching for a reply. There is no set deadline for this kind of letter, so Arik will remind you to check in.'}</p>
      </div>
    );
  }

  return (
    <section className="send-panel" aria-label="Send this letter">
      <h3>Send it</h3>
      <label>
        Your full name
        <input style={cell} autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} />
      </label>

      {!auth.current && (
        <>
          <h4>First, let Arik send for you (once)</h4>
          <pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit' }}>{auth.text}</pre>
          <SignaturePad label="Sign to allow it" onChange={setAuthSig} />
          <button type="button" style={big} disabled={busy || !authSig || name.trim().length < 2} onClick={signAuth}>I agree and sign</button>
        </>
      )}

      {!!auth.current && !letterSigned && (
        <>
          <h4>Sign the letter</h4>
          <SignaturePad label="Your signature goes at the end of the letter" onChange={setLetterSig} />
          <button type="button" style={big} disabled={busy || !letterSig || name.trim().length < 2} onClick={signLetter}>Sign the letter</button>
        </>
      )}

      {!!auth.current && letterSigned && !prepared && (
        <>
          <h4>Where it goes</h4>
          <label>
            Send to (name or department)
            <input style={cell} value={recipientName} onChange={(e) => setRecipientName(e.target.value)} />
          </label>
          <fieldset className="method-row" style={{ border: 0, padding: 0 }}>
            <legend>How to send</legend>
            {(['fax', 'mail'] as const).map((m) => (
              <button key={m} type="button" style={big} aria-pressed={channel === m} onClick={() => setChannel(m)}>{m === 'fax' ? 'Fax' : 'Mail'}</button>
            ))}
          </fieldset>
          {channel === 'fax' ? (
            <label>
              Their fax number (from the letter or their website)
              <input style={cell} type="tel" value={fax} onChange={(e) => setFax(e.target.value)} />
            </label>
          ) : (
            <>
              {addr(to, setTo, 'Their address')}
              {addr(from, setFrom, 'Your return address')}
              <label style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', minHeight: 44 }}>
                <input type="checkbox" style={{ width: 24, height: 24 }} checked={certified} onChange={(e) => setCertified(e.target.checked)} />
                Certified mail with tracking (proof they got it)
              </label>
            </>
          )}
          <button type="button" style={big} disabled={busy} onClick={prepare}>Review before sending</button>
        </>
      )}

      {prepared && (
        <>
          <h4>Check and approve</h4>
          {prepared.summary.practice && <p className="receipt-badge">Practice send: nothing will leave Arik</p>}
          <p><strong>{prepared.summary.letter}</strong></p>
          <p>To: {recipientName}, by {channel === 'fax' ? `fax ${fax}` : prepared.summary.certified ? 'certified mail' : 'mail'}</p>
          <p>What goes out: {prepared.summary.shares.join(', ')}.</p>
          <div className="actions">
            <button type="button" style={big} disabled={busy} onClick={approve}>{busy ? 'Sending...' : 'Approve and send'}</button>
            <button type="button" style={big} disabled={busy} onClick={cancel}>Cancel</button>
          </div>
        </>
      )}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
