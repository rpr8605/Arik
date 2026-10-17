// Phase 6 smoke: authorization, signing, sending, tracking and replies over
// HTTP, on a SYNTHETIC bill, with the demo executors (practice sends:
// nothing leaves Arik). upload -> confirm -> dispute letter -> freeze ->
// send refused until authorized and signed -> blank signatures refused ->
// authorize -> sign -> signed PDF -> mail (certified) and fax practice
// sends -> events append-only, approvals ledgered, no IP stored -> practice
// replies classified -> next step approved drafts a letter, sends nothing
// -> "Delete everything" removes the whole trail. Self-cleaning.
// Needs: a non-demo dev server (DEMO_MODE=false, SEND_EXECUTOR unset or
// 'demo'), db/038 to db/042 applied, `npm run ingest -- bill_refs`, and the
// synthetic library (`npx tsx scripts/synth_docs/generate.ts`).
//   node scripts/smoke_agent_actions.mjs
import { readFileSync } from 'node:fs';
import pg from 'pg';
import sharp from 'sharp';
import { createClient } from '@supabase/supabase-js';

function loadEnv(path) {
  const out = {};
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/i);
    if (!m || m[1].startsWith('#')) continue;
    out[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
  }
  return out;
}
const env = loadEnv(new URL('../.env.local', import.meta.url));
const BASE = process.env.BASE_URL ?? 'http://localhost:3000';
if (!/^(127\.0\.0\.1|localhost)$/.test(env.SUPABASE_DB_HOST ?? '')) throw new Error('smoke_agent_actions runs against a local database only');

let failures = 0;
function check(name, cond, detail = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ' - ' + detail : ''}`);
  if (!cond) failures++;
}
const timed = (ms) => AbortSignal.timeout(ms);

const pgClient = new pg.Client({ host: env.SUPABASE_DB_HOST, port: Number(env.SUPABASE_DB_PORT ?? 5432), user: 'postgres', password: env.SUPABASE_DB_PASSWORD, database: 'postgres', ssl: false, connectionTimeoutMillis: 10_000 });
await pgClient.connect();
const admin = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const EMAIL = 'agent_actions_smoke@example.invalid';
const { data: old } = await admin.auth.admin.listUsers();
for (const u of old?.users ?? []) if (u.email === EMAIL) await admin.auth.admin.deleteUser(u.id);
const { data: created, error: createErr } = await admin.auth.admin.createUser({ email: EMAIL, password: 'smoke-pass-123', email_confirm: true });
if (createErr) throw createErr;
const USER = created.user.id;

async function cleanup() {
  for (const t of ['replies', 'send_jobs', 'letter_signatures', 'case_inbound_numbers', 'agent_authorizations', 'letters', 'bill_audit_findings', 'uploaded_documents', 'consent_ledger']) await pgClient.query(`delete from ${t} where user_id = $1`, [USER]).catch(() => {});
  await pgClient.query('delete from cases where user_id = $1', [USER]).catch(() => {});
  await admin.auth.admin.deleteUser(USER).catch(() => {});
}

const strokes = await sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="400" height="120"><path d="M10 80 C 60 10, 110 110, 160 50 S 260 20, 390 90" stroke="#22425c" stroke-width="4" fill="none"/></svg>')).png().toBuffer();
const SIGNATURE = `data:image/png;base64,${strokes.toString('base64')}`;
const blankPng = await sharp({ create: { width: 400, height: 120, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 0 } } }).png().toBuffer();
const BLANK = `data:image/png;base64,${blankPng.toString('base64')}`;
const to = { name: 'Billing office', line1: '100 Sample Way', line2: null, city: 'Fairhaven', state: 'OH', zip: '43000' };
const from = { name: 'Sample Patient', line1: '12 Cedar Road', line2: null, city: 'Fairhaven', state: 'OH', zip: '43001' };

try {
  const { rows: [kase] } = await pgClient.query(`insert into cases (user_id, case_type) values ($1, 'bill_dispute') returning id`, [USER]);
  const tok = await fetch(`${env.SUPABASE_URL}/auth/v1/token?grant_type=password`, { method: 'POST', signal: timed(20_000), headers: { apikey: env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ email: EMAIL, password: 'smoke-pass-123' }) }).then((r) => r.json());
  const auth = { Authorization: `Bearer ${tok.access_token}` };
  const api = async (path, init = {}) => {
    const res = await fetch(`${BASE}${path}`, { ...init, signal: timed(120_000), headers: { ...auth, ...(init.body && typeof init.body === 'string' ? { 'content-type': 'application/json' } : {}) } });
    const type = res.headers.get('content-type') ?? '';
    return { status: res.status, json: type.includes('json') ? await res.json() : null, bytes: type.includes('pdf') ? Buffer.from(await res.arrayBuffer()) : null };
  };
  const post = (path, body) => api(path, { method: 'POST', body: JSON.stringify(body) });
  console.log(`smoke target: ${BASE}\n`);
  const health = await api('/api/health');
  check('dev server is not in DEMO_MODE', health.json?.demo_mode === false);

  // A frozen dispute letter from a synthetic bill.
  const truth = JSON.parse(readFileSync(new URL('../.data/synth/bill-3.json', import.meta.url), 'utf8'));
  const form = new FormData();
  form.append('file', new Blob([readFileSync(new URL(`../.data/synth/${truth.file}`, import.meta.url))], { type: 'application/pdf' }), truth.file);
  const up = await fetch(`${BASE}/api/cases/${kase.id}/documents`, { method: 'POST', body: form, headers: auth, signal: timed(120_000) }).then(async (r) => ({ status: r.status, json: await r.json() }));
  const docId = up.json.document.id;
  const reading = await api(`/api/cases/${kase.id}/documents/${docId}/confirm`);
  await post(`/api/cases/${kase.id}/documents/${docId}/confirm`, reading.json.draft);
  const letter = (await post(`/api/cases/${kase.id}/letters`, { documentId: docId, type: 'billing_dispute' })).json.letter;
  const draftJob = await post(`/api/cases/${kase.id}/jobs`, { letterId: letter.id, channel: 'mail', recipientName: 'Billing office', address: to, returnAddress: from, certified: true });
  check('send: a draft letter cannot be prepared for sending (409)', draftJob.status === 409, String(draftJob.status));
  await api(`/api/cases/${kase.id}/letters/${letter.id}`, { method: 'PATCH', body: JSON.stringify({ action: 'freeze' }) });

  const mailJob = (await post(`/api/cases/${kase.id}/jobs`, { letterId: letter.id, channel: 'mail', recipientName: 'Billing office', address: to, returnAddress: from, certified: true })).json;
  check('prepare: a practice mail job waits for approval, with what will be shared', mailJob.job?.status === 'awaiting_approval' && mailJob.summary.practice === true && mailJob.summary.shares.length > 0, JSON.stringify(mailJob).slice(0, 200));
  const early = await post(`/api/cases/${kase.id}/jobs/${mailJob.job.id}`, { action: 'approve' });
  check('approve: refused without the authorization (409), nothing sent', early.status === 409 && /authorization/.test(early.json.error), JSON.stringify(early.json));

  const authz = await api('/api/authorization');
  check('authorization: placeholder text for counsel, not yet signed', authz.json.current === null && /PLACEHOLDER/.test(authz.json.text) && authz.json.needsCounsel === true);
  const blank = await post('/api/authorization', { name: 'Sample Patient', signature: BLANK });
  check('authorization: a blank signature is refused (400)', blank.status === 400, JSON.stringify(blank.json));
  const signedAuth = await post('/api/authorization', { name: 'Sample Patient', signature: SIGNATURE });
  check('authorization: signed (201)', signedAuth.status === 201);
  const authRow = (await pgClient.query('select text_version, text_sha256, signed_copy_sha256 from agent_authorizations where user_id = $1 and revoked_at is null', [USER])).rows[0];
  check('authorization: stored with the text version and hashes', authRow?.text_version === authz.json.version && /^[0-9a-f]{64}$/.test(authRow.text_sha256) && /^[0-9a-f]{64}$/.test(authRow.signed_copy_sha256));
  const authPdf = await api('/api/authorization?format=pdf');
  check('authorization: the signed copy downloads as a PDF', authPdf.status === 200 && authPdf.bytes?.subarray(0, 5).toString() === '%PDF-');
  const twice = await post('/api/authorization', { name: 'Sample Patient', signature: SIGNATURE });
  check('authorization: signing twice is refused (409)', twice.status === 409);

  const unsigned = await post(`/api/cases/${kase.id}/jobs/${mailJob.job.id}`, { action: 'approve' });
  check('approve: refused while the letter is unsigned (409)', unsigned.status === 409 && /sign the letter/.test(unsigned.json.error));
  const blankLetter = await post(`/api/cases/${kase.id}/letters/${letter.id}/sign`, { name: 'Sample Patient', signature: BLANK });
  check('sign letter: a blank signature is refused (400)', blankLetter.status === 400);
  const sig = await post(`/api/cases/${kase.id}/letters/${letter.id}/sign`, { name: 'Sample Patient', signature: SIGNATURE });
  check('sign letter: signed with a hash', sig.status === 201 && /^[0-9a-f]{64}$/.test(sig.json.sha256));
  const signedPdf = await api(`/api/cases/${kase.id}/letters/${letter.id}/sign`);
  check('sign letter: the signed PDF downloads and matches its stored hash', signedPdf.status === 200 && signedPdf.bytes?.subarray(0, 5).toString() === '%PDF-');
  const frozenRow = (await pgClient.query('select status, content_sha256 from letters where id = $1', [letter.id])).rows[0];
  check('sign letter: the frozen letter itself is unchanged', frozenRow.status === 'frozen' && frozenRow.content_sha256 === (await api(`/api/cases/${kase.id}/letters/${letter.id}`)).json.letter.content_sha256);

  const sent = await post(`/api/cases/${kase.id}/jobs/${mailJob.job.id}`, { action: 'approve' });
  const j = sent.json?.job;
  check('approve: practice certified mail delivered, with confirmation and tracking', sent.status === 200 && j.status === 'delivered' && /^PRACTICE-MAIL-/.test(j.confirmation) && /^PRACTICE-CERT-/.test(j.tracking), JSON.stringify(sent.json).slice(0, 300));
  check('tracker: a billing dispute has no verified reply deadline, so none is set', j.response_due === null);
  const again = await post(`/api/cases/${kase.id}/jobs/${mailJob.job.id}`, { action: 'approve' });
  check('approve: a second tap does not send again (409)', again.status === 409);
  const ev = (await pgClient.query('select kind from send_job_events where job_id = $1 order by at', [mailJob.job.id])).rows.map((r) => r.kind);
  check('events: approved, queued, printed, mailed, in transit, delivered', ev.join() === 'approved,queued,printed,mailed,in_transit,delivered', ev.join());
  let appendOnly = false;
  try {
    await pgClient.query(`update send_job_events set detail = 'x' where job_id = $1`, [mailJob.job.id]);
  } catch {
    appendOnly = true;
  }
  check('events: the trail is append-only in the database', appendOnly);
  const ledger = (await pgClient.query(`select category, action, detail from consent_ledger where user_id = $1 and category in ('agent_authorization', 'agent_action') order by created_at`, [USER])).rows;
  check('consent ledger: the authorization and the approval are recorded', ledger.some((r) => r.category === 'agent_authorization' && r.action === 'opt_in') && ledger.some((r) => r.category === 'agent_action' && r.detail.job_id === mailJob.job.id));
  const ipCols = (await pgClient.query(`select table_name, column_name from information_schema.columns where table_name in ('agent_authorizations','letter_signatures','send_jobs','send_job_events','case_inbound_numbers','replies') and (column_name ~ '(^|_)ip(_|$)' or column_name ilike '%ip_address%' or column_name ilike '%user_agent%' or column_name ilike '%device%')`)).rows;
  const ledgerHasIp = ledger.some((r) => JSON.stringify(r.detail).match(/"ip|user_agent|device/i));
  check('audit trail: no IP address, user agent or device data stored', ipCols.length === 0 && !ledgerHasIp, JSON.stringify(ipCols));

  const faxJob = (await post(`/api/cases/${kase.id}/jobs`, { letterId: letter.id, channel: 'fax', recipientName: 'Billing office', fax: '(555) 555-0142' })).json.job;
  const faxed = (await post(`/api/cases/${kase.id}/jobs/${faxJob.id}`, { action: 'approve' })).json.job;
  check('fax: practice fax delivered with a confirmation', faxed.status === 'delivered' && /^PRACTICE-FAX-/.test(faxed.confirmation));
  const jobs = await api(`/api/cases/${kase.id}/jobs`);
  check('tracker: both sends listed with timelines and a practice return number for the case', jobs.json.jobs.length === 2 && jobs.json.jobs.every((x) => x.events.length >= 3) && /^PRACTICE-[0-9A-F]{6}$/.test(jobs.json.inboundNumber ?? ''), JSON.stringify(jobs.json).slice(0, 200));

  const kinds = { approved: 'record_outcome', denied_again: 'draft_letter', info_requested: 'draft_letter', collections_notice: 'draft_letter', corrected_bill: 'review_new_bill' };
  const replies = {};
  for (const kind of Object.keys(kinds)) {
    const r = await post(`/api/cases/${kase.id}/jobs/${faxJob.id}/replies`, { practice: kind });
    replies[kind] = r.json?.reply;
    check(`reply: a practice ${kind} fax is read as ${kind}, next step ${kinds[kind]}`, r.status === 201 && r.json.reply.classification === kind && r.json.reply.proposal.step === kinds[kind], JSON.stringify(r.json).slice(0, 200));
  }
  const jobsAfter = await api(`/api/cases/${kase.id}/jobs`);
  check('tracker: the job shows as replied, with a reply event', jobsAfter.json.jobs.find((x) => x.id === faxJob.id).status === 'replied' && jobsAfter.json.jobs.find((x) => x.id === faxJob.id).events.some((e) => e.kind === 'reply_received'));
  const jobsBefore = (await pgClient.query('select count(*)::int as n from send_jobs where case_id = $1', [kase.id])).rows[0].n;
  const decided = await post(`/api/cases/${kase.id}/replies/${replies.collections_notice.id}`, { decision: 'approve' });
  check('next step approved: a hold-collections letter is drafted, as a draft', decided.status === 200 && decided.json.letter?.letter_type === 'hold_collections' && decided.json.letter.status === 'draft', JSON.stringify(decided.json).slice(0, 200));
  const jobsAfterDecide = (await pgClient.query('select count(*)::int as n from send_jobs where case_id = $1', [kase.id])).rows[0].n;
  check('next step approved: nothing was sent (no new send)', jobsAfterDecide === jobsBefore);
  const twiceDecided = await post(`/api/cases/${kase.id}/replies/${replies.collections_notice.id}`, { decision: 'approve' });
  check('next step: deciding twice is refused (409)', twiceDecided.status === 409);
  const re = await post(`/api/cases/${kase.id}/replies/${replies.corrected_bill.id}`, { decision: 'reclassify', kind: 'approved' });
  check('reply: the patient can say what it really is, and the step follows', re.status === 200 && re.json.reply.classification === 'approved' && re.json.reply.proposal.step === 'record_outcome');
  const dismissed = await post(`/api/cases/${kase.id}/replies/${replies.info_requested.id}`, { decision: 'dismiss' });
  check('next step dismissed: recorded, nothing drafted', dismissed.status === 200 && dismissed.json.reply.status === 'dismissed' && !dismissed.json.letter);

  const revoke = await api('/api/authorization', { method: 'DELETE' });
  const postRevoke = (await post(`/api/cases/${kase.id}/jobs`, { letterId: letter.id, channel: 'fax', recipientName: 'Billing office', fax: '(555) 555-0142' })).json.job;
  const blocked = await post(`/api/cases/${kase.id}/jobs/${postRevoke.id}`, { action: 'approve' });
  check('authorization taken back: the next send is refused', revoke.json.revoked === true && blocked.status === 409);

  const del = await api('/api/privacy', { method: 'DELETE' });
  const left = (await pgClient.query(
    `select (select count(*) from replies where user_id = $1)::int + (select count(*) from send_jobs where user_id = $1)::int + (select count(*) from send_job_events where case_id = $2)::int + (select count(*) from letter_signatures where user_id = $1)::int + (select count(*) from agent_authorizations where user_id = $1)::int + (select count(*) from case_inbound_numbers where case_id = $2)::int + (select count(*) from letters where user_id = $1)::int + (select count(*) from cases where user_id = $1)::int as n`,
    [USER, kase.id],
  )).rows[0].n;
  check('delete everything: authorization, signatures, sends, events, replies, letters and the case are gone', del.status === 200 && left === 0, `${del.status} ${left} left ${JSON.stringify(del.json).slice(0, 300)}`);
} finally {
  await cleanup();
}
await pgClient.end();
console.log(failures ? `\nAGENT ACTIONS SMOKE: ${failures} FAILURE(S)` : '\nAGENT ACTIONS SMOKE: ALL PASS');
process.exit(failures ? 1 : 0);
