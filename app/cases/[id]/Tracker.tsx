'use client';

// "Arik watches it" (Phase 6, real path): every sent letter on this case
// with its timeline, when an answer is due, whether it is overdue, and the
// replies with Arik's suggested next step for the patient to approve.
// With the demo executors, a practice reply can be "faxed in" to try it.

import { useCallback, useEffect, useState } from 'react';
import { supabaseBrowser } from '@/lib/supabaseBrowser';

const big = { minHeight: 48, padding: '0 1rem' } as const;
const usDate = (iso: string) => `${iso.slice(5, 7)}/${iso.slice(8, 10)}/${iso.slice(0, 4)}`;
const when = (iso: string) => new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const KIND_WORDS: Record<string, string> = { approved: 'Approved', denied_again: 'Denied again', info_requested: 'They need more information', collections_notice: 'Collection notice', corrected_bill: 'Corrected bill', unknown: 'Not sure yet' };
const EVENT_WORDS: Record<string, string> = { approved: 'You approved it', queued: 'Queued', sent: 'Sent', printed: 'Printed', mailed: 'Mailed', in_transit: 'In transit', delivered: 'Delivered', failed: 'Not sent', cancelled: 'Cancelled', reply_received: 'Reply received' };

async function api(path: string, init: RequestInit = {}) {
  const { data: { session } } = await supabaseBrowser().auth.getSession();
  return fetch(path, { ...init, headers: { ...(init.body ? { 'content-type': 'application/json' } : {}), Authorization: `Bearer ${session?.access_token ?? ''}` } });
}

export function Tracker({ caseId }: { caseId: string }) {
  const [data, setData] = useState<{ jobs: any[]; inboundNumber: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await api(`/api/cases/${caseId}/jobs`);
    if (res.ok) setData(await res.json());
  }, [caseId]);
  useEffect(() => {
    load().catch(() => setError('Could not load what Arik is watching.'));
  }, [load]);

  const post = async (path: string, body: unknown) => {
    setError(null);
    setNote(null);
    const res = await api(path, { method: 'POST', body: JSON.stringify(body) });
    const json = await res.json();
    if (!res.ok) setError(json.error ?? 'Something went wrong.');
    else if (json.letter) setNote('Arik drafted the next letter. Find it with your documents, review it, and approve it before anything is sent.');
    else if (json.draftError) setNote(json.draftError);
    await load();
  };

  if (!data || data.jobs.length === 0) return null;
  return (
    <section className="card" aria-label="What Arik is watching" style={{ marginTop: '1rem' }}>
      <h3>What Arik is watching</h3>
      {data.inboundNumber && <p>Replies can come to this case at {data.inboundNumber}{data.inboundNumber.startsWith('PRACTICE') ? ' (a practice number, not a real fax line)' : ''}.</p>}
      {data.jobs.map((j) => (
        <div key={j.id} className="job" style={{ borderTop: '1px solid #e3e8ee', paddingTop: '0.75rem', marginTop: '0.75rem' }}>
          <p><strong>{j.letters?.subject ?? 'Letter'}</strong>{j.practice ? ' (practice send)' : ''}</p>
          {j.response_due && <p>{j.overdue ? j.overdue_text : `Answer due by ${usDate(j.response_due)}.`}</p>}
          {!j.response_due && j.status === 'delivered' && <p>There is no set deadline for an answer to this letter. Check in if you have not heard back in a few weeks.</p>}
          <ol style={{ paddingLeft: '1.25rem' }}>
            {j.events.map((e: any, i: number) => <li key={i}>{EVENT_WORDS[e.kind] ?? e.kind}, {when(e.at)}{e.detail ? `: ${e.detail}` : ''}</li>)}
          </ol>
          {j.replies.map((r: any) => (
            <div key={r.id} className="finding finding-ask" style={{ marginBottom: '0.5rem' }}>
              <p><strong>{KIND_WORDS[r.classification]}</strong>: {r.proposal.title}. {r.proposal.why}</p>
              {r.status === 'proposed' ? (
                <div className="actions" style={{ flexWrap: 'wrap' }}>
                  <button type="button" style={big} onClick={() => post(`/api/cases/${caseId}/replies/${r.id}`, { decision: 'approve' })}>{r.proposal.letterType ? 'Yes, draft it' : 'OK'}</button>
                  <button type="button" style={big} onClick={() => post(`/api/cases/${caseId}/replies/${r.id}`, { decision: 'dismiss' })}>Not now</button>
                  <label>
                    It actually says
                    <select style={{ minHeight: 44 }} defaultValue="" onChange={(e) => e.target.value && post(`/api/cases/${caseId}/replies/${r.id}`, { decision: 'reclassify', kind: e.target.value })}>
                      <option value="">Choose</option>
                      {Object.entries(KIND_WORDS).map(([k, w]) => <option key={k} value={k}>{w}</option>)}
                    </select>
                  </label>
                </div>
              ) : (
                <p>{r.status === 'approved' ? 'You approved this step.' : 'You set this aside.'}</p>
              )}
            </div>
          ))}
          {['delivered', 'sent', 'replied'].includes(j.status) && (
            <label style={{ display: 'block', minHeight: 44 }}>
              Got a reply in the mail? Add a photo or PDF of it
              <input
                type="file"
                accept=".pdf,.png,.jpg,.jpeg,.heic,.heif"
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  if (!f) return;
                  const { data: { session } } = await supabaseBrowser().auth.getSession();
                  const form = new FormData();
                  form.append('file', f);
                  const up = await fetch(`/api/cases/${caseId}/documents`, { method: 'POST', headers: { Authorization: `Bearer ${session?.access_token ?? ''}` }, body: form });
                  const json = await up.json();
                  if (!up.ok) return setError("Arik couldn't read that file. Try a clearer photo.");
                  await post(`/api/cases/${caseId}/jobs/${j.id}/replies`, { documentId: json.document.id });
                }}
              />
            </label>
          )}
          {j.practice && ['delivered', 'replied'].includes(j.status) && (
            <label>
              Try a practice reply by fax
              <select style={{ minHeight: 44, width: '100%' }} defaultValue="" onChange={(e) => e.target.value && post(`/api/cases/${caseId}/jobs/${j.id}/replies`, { practice: e.target.value })}>
                <option value="">Choose a practice reply</option>
                {Object.entries(KIND_WORDS).filter(([k]) => k !== 'unknown').map(([k, w]) => <option key={k} value={k}>{w}</option>)}
              </select>
            </label>
          )}
        </div>
      ))}
      {note && <p role="status">{note}</p>}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
