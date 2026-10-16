// Phases 2 to 4 smoke: the real bill path over HTTP, on a SYNTHETIC bill.
// upload (on-server reader) -> GET the reading -> "Looks right" -> findings
// stored -> dispute letter -> edit -> freeze -> edit refused -> PDF ->
// account-deletion order holds with a frozen letter. Self-cleaning.
// Needs: a non-demo dev server (DEMO_MODE=false), db/038 + db/039 applied,
// `npm run ingest -- bill_refs` on the same database, and the synthetic
// library (`npx tsx scripts/synth_docs/generate.ts`).
//   node scripts/smoke_bill_review.mjs
import { readFileSync } from 'node:fs';
import pg from 'pg';
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
if (!/^(127\.0\.0\.1|localhost)$/.test(env.SUPABASE_DB_HOST ?? '')) throw new Error('smoke_bill_review runs against a local database only');

let failures = 0;
function check(name, cond, detail = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ' - ' + detail : ''}`);
  if (!cond) failures++;
}
const timed = (ms) => AbortSignal.timeout(ms);

const pgClient = new pg.Client({ host: env.SUPABASE_DB_HOST, port: Number(env.SUPABASE_DB_PORT ?? 5432), user: 'postgres', password: env.SUPABASE_DB_PASSWORD, database: 'postgres', ssl: false, connectionTimeoutMillis: 10_000 });
await pgClient.connect();
const admin = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const EMAIL = 'bill_review_smoke@example.invalid';
const { data: old } = await admin.auth.admin.listUsers();
for (const u of old?.users ?? []) if (u.email === EMAIL) await admin.auth.admin.deleteUser(u.id);
const { data: created, error: createErr } = await admin.auth.admin.createUser({ email: EMAIL, password: 'smoke-pass-123', email_confirm: true });
if (createErr) throw createErr;
const USER = created.user.id;

async function cleanup() {
  await pgClient.query('delete from letters where user_id = $1', [USER]);
  await pgClient.query('delete from bill_audit_findings where user_id = $1', [USER]);
  await pgClient.query('delete from uploaded_documents where user_id = $1', [USER]);
  await pgClient.query('delete from cases where user_id = $1', [USER]).catch(() => {});
  await admin.auth.admin.deleteUser(USER).catch(() => {});
}

try {
  const { rows: [kase] } = await pgClient.query(`insert into cases (user_id, case_type) values ($1, 'bill_dispute') returning id`, [USER]);
  const tok = await fetch(`${env.SUPABASE_URL}/auth/v1/token?grant_type=password`, { method: 'POST', signal: timed(20_000), headers: { apikey: env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ email: EMAIL, password: 'smoke-pass-123' }) }).then((r) => r.json());
  const auth = { Authorization: `Bearer ${tok.access_token}` };
  const api = async (path, init = {}) => {
    const res = await fetch(`${BASE}${path}`, { ...init, signal: timed(120_000), headers: { ...auth, ...(init.body && typeof init.body === 'string' ? { 'content-type': 'application/json' } : {}) } });
    const type = res.headers.get('content-type') ?? '';
    return { status: res.status, type, json: type.includes('json') ? await res.json() : null, bytes: type.includes('pdf') ? Buffer.from(await res.arrayBuffer()) : null };
  };
  console.log(`smoke target: ${BASE}\n`);
  const health = await api('/api/health');
  check('dev server is not in DEMO_MODE', health.json?.demo_mode === false, JSON.stringify(health.json));

  // A clean synthetic bill with a planted duplicate (bill-3 is a clean PDF).
  const truth = JSON.parse(readFileSync(new URL('../.data/synth/bill-3.json', import.meta.url), 'utf8'));
  const form = new FormData();
  form.append('file', new Blob([readFileSync(new URL(`../.data/synth/${truth.file}`, import.meta.url))], { type: 'application/pdf' }), truth.file);
  const up = await fetch(`${BASE}/api/cases/${kase.id}/documents`, { method: 'POST', body: form, headers: auth, signal: timed(120_000) }).then(async (r) => ({ status: r.status, json: await r.json() }));
  check('upload: 201, read on the server', up.status === 201 && up.json.extraction?.reader?.startsWith('on-server'), `${up.status} ${up.json.extraction?.reader}`);
  check('upload: a bill from the right hospital, owing the right amount', up.json.extraction?.doc_type === 'itemized_bill' && up.json.extraction?.institution_name === truth.provider && up.json.extraction?.total_amount_usd === truth.amountDueUsd, `${up.json.extraction?.institution_name} ${up.json.extraction?.total_amount_usd}`);
  const docId = up.json.document.id;
  const row = (await pgClient.query('select extracted_data, confirmed_data from uploaded_documents where id = $1', [docId])).rows[0];
  check('upload: the line-by-line reading is stored, nothing confirmed yet', row.extracted_data?.layout?.lines?.length === truth.lines.length && row.confirmed_data === null);

  const reading = await api(`/api/cases/${kase.id}/documents/${docId}/confirm`);
  check('reading: returned as a draft to check', reading.status === 200 && reading.json.draft.lines.length === truth.lines.length);
  const bad = await api(`/api/cases/${kase.id}/documents/${docId}/confirm`, { method: 'POST', body: JSON.stringify({ header: {}, lines: [{ chargeUsd: -1 }] }) });
  check('confirm: a malformed confirmation is refused', bad.status === 400);
  const noLetter = await api(`/api/cases/${kase.id}/letters`, { method: 'POST', body: JSON.stringify({ documentId: docId, type: 'billing_dispute' }) });
  check('letter: refused before the patient confirms', noLetter.status === 409, String(noLetter.status));
  const conf = await api(`/api/cases/${kase.id}/documents/${docId}/confirm`, { method: 'POST', body: JSON.stringify(reading.json.draft) });
  const planted = truth.planted.map((p) => p.kind);
  check('confirm: findings returned', conf.status === 200 && Array.isArray(conf.json.findings), String(conf.status));
  const kinds = { duplicate: 'duplicate_charge', unbundled_panel: 'ncci_ptp', room_days: 'room_days', unlisted_supplies: 'ask_about' };
  const want = planted.filter((k) => k !== 'unbundled_panel');
  check(`confirm: every planted problem with public data found (${want.join(', ') || 'none'})`, want.every((k) => conf.json.findings.some((f) => f.ruleId === kinds[k])), conf.json.findings.map((f) => f.ruleId).join(','));
  const stored = (await pgClient.query('select count(*)::int as n, bool_and(tone is not null and data_version is not null and line_indexes is not null) as ok from bill_audit_findings where bill_document_id = $1', [docId])).rows[0];
  check('confirm: findings stored with tone, lines and data version', stored.n === conf.json.findings.length && (stored.n === 0 || stored.ok));
  await api(`/api/cases/${kase.id}/documents/${docId}/confirm`, { method: 'POST', body: JSON.stringify(reading.json.draft) });
  const again = (await pgClient.query('select count(*)::int as n from bill_audit_findings where bill_document_id = $1', [docId])).rows[0];
  check('confirm again: findings replaced, not doubled', again.n === stored.n);

  const type = conf.json.findings.length ? 'billing_dispute' : 'itemized_bill_request';
  const made = await api(`/api/cases/${kase.id}/letters`, { method: 'POST', body: JSON.stringify({ documentId: docId, type, phone: '(555) 555-0100' }) });
  const letter = made.json?.letter;
  check(`letter: ${type} drafted (version 1, code templates)`, made.status === 201 && letter?.version === 1 && letter?.status === 'draft' && letter?.drafter === 'code-templates', `${made.status} ${JSON.stringify(made.json).slice(0, 160)}`);
  check('letter: names the account and the patient', letter.subject.includes(truth.accountNumber) && letter.body.includes(truth.patientName));
  const edited = await api(`/api/cases/${kase.id}/letters/${letter.id}`, { method: 'PATCH', body: JSON.stringify({ subject: letter.subject, body: `${letter.body}\n\nP.S. Please reply by mail.` }) });
  check('letter: a draft can be edited', edited.status === 200 && edited.json.letter.body.endsWith('Please reply by mail.'));
  const early = await api(`/api/cases/${kase.id}/letters/${letter.id}?format=pdf`);
  check('pdf: refused before freezing', early.status === 409);
  const frozen = await api(`/api/cases/${kase.id}/letters/${letter.id}`, { method: 'PATCH', body: JSON.stringify({ action: 'freeze' }) });
  check('freeze: frozen with a hash', frozen.status === 200 && frozen.json.letter.status === 'frozen' && /^[0-9a-f]{64}$/.test(frozen.json.letter.content_sha256));
  const late = await api(`/api/cases/${kase.id}/letters/${letter.id}`, { method: 'PATCH', body: JSON.stringify({ subject: 'x', body: 'y' }) });
  check('freeze: a frozen letter refuses edits (409)', late.status === 409);
  let dbRefused = false;
  try {
    await pgClient.query('update letters set body = $2 where id = $1', [letter.id, 'tampered']);
  } catch {
    dbRefused = true;
  }
  check('freeze: the database refuses a direct edit too', dbRefused);
  const pdf = await api(`/api/cases/${kase.id}/letters/${letter.id}?format=pdf`);
  check('pdf: downloads as a PDF', pdf.status === 200 && pdf.bytes?.subarray(0, 5).toString() === '%PDF-', `${pdf.status} ${pdf.type}`);
  const second = await api(`/api/cases/${kase.id}/letters`, { method: 'POST', body: JSON.stringify({ documentId: docId, type }) });
  check('letter: writing again makes version 2', second.status === 201 && second.json.letter.version === 2);
  const ghost = await api(`/api/cases/${kase.id}/letters/00000000-0000-0000-0000-000000000000`);
  check('letter: a letter that is not in this case is a 404', ghost.status === 404);

  // "Delete everything" still works with a frozen letter in place.
  const del = await api('/api/privacy', { method: 'DELETE' });
  const left = (await pgClient.query(
    `select (select count(*) from letters where user_id = $1)::int + (select count(*) from bill_audit_findings where user_id = $1)::int + (select count(*) from uploaded_documents where user_id = $1)::int + (select count(*) from cases where user_id = $1)::int as n`,
    [USER],
  )).rows[0].n;
  check('delete everything: letters (one frozen), findings, documents and the case are gone', del.status === 200 && left === 0, `${del.status} ${left} left ${JSON.stringify(del.json).slice(0, 300)}`);
} finally {
  await cleanup();
}
await pgClient.end();
console.log(failures ? `\nBILL REVIEW SMOKE: ${failures} FAILURE(S)` : '\nBILL REVIEW SMOKE: ALL PASS');
process.exit(failures ? 1 : 0);
