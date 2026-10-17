// Phase 5 smoke: the real denial path over HTTP, on a SYNTHETIC denial
// letter. upload (on-server reader) -> GET the draft -> letter refused
// before "Looks right" -> malformed confirm refused -> confirm -> denial
// row, check results and the deadline row stored -> re-confirm replaces,
// not doubles -> letter that fits -> a letter that does not fit refused ->
// freeze -> PDF -> "Delete everything" removes denials, deadlines and the
// frozen letter. Self-cleaning.
// Needs: a non-demo dev server (DEMO_MODE=false), db/041 applied, and the
// synthetic library (`npx tsx scripts/synth_docs/generate.ts`).
//   node scripts/smoke_denial_review.mjs
import { readFileSync, readdirSync } from 'node:fs';
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
if (!/^(127\.0\.0\.1|localhost)$/.test(env.SUPABASE_DB_HOST ?? '')) throw new Error('smoke_denial_review runs against a local database only');

let failures = 0;
function check(name, cond, detail = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ' - ' + detail : ''}`);
  if (!cond) failures++;
}
const timed = (ms) => AbortSignal.timeout(ms);

const pgClient = new pg.Client({ host: env.SUPABASE_DB_HOST, port: Number(env.SUPABASE_DB_PORT ?? 5432), user: 'postgres', password: env.SUPABASE_DB_PASSWORD, database: 'postgres', ssl: false, connectionTimeoutMillis: 10_000 });
await pgClient.connect();
const admin = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const EMAIL = 'denial_review_smoke@example.invalid';
const { data: old } = await admin.auth.admin.listUsers();
for (const u of old?.users ?? []) if (u.email === EMAIL) await admin.auth.admin.deleteUser(u.id);
const { data: created, error: createErr } = await admin.auth.admin.createUser({ email: EMAIL, password: 'smoke-pass-123', email_confirm: true });
if (createErr) throw createErr;
const USER = created.user.id;

async function cleanup() {
  await pgClient.query('delete from letters where user_id = $1', [USER]);
  await pgClient.query('delete from denials where user_id = $1', [USER]);
  await pgClient.query('delete from uploaded_documents where user_id = $1', [USER]);
  await pgClient.query('delete from cases where user_id = $1', [USER]).catch(() => {});
  await admin.auth.admin.deleteUser(USER).catch(() => {});
}

// A clean synthetic denial that gives a reason and a code.
const SYNTH = new URL('../.data/synth/', import.meta.url);
const truth = readdirSync(SYNTH)
  .filter((f) => /^denial-\d+\.json$/.test(f))
  .map((f) => JSON.parse(readFileSync(new URL(f, SYNTH), 'utf8')))
  .find((t) => t.quality === 'clean' && t.carc && t.reason);
if (!truth) throw new Error('no clean synthetic denial with a code; run scripts/synth_docs/generate.ts');

try {
  const { rows: [kase] } = await pgClient.query(`insert into cases (user_id, case_type) values ($1, 'denial_appeal') returning id`, [USER]);
  const tok = await fetch(`${env.SUPABASE_URL}/auth/v1/token?grant_type=password`, { method: 'POST', signal: timed(20_000), headers: { apikey: env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ email: EMAIL, password: 'smoke-pass-123' }) }).then((r) => r.json());
  const auth = { Authorization: `Bearer ${tok.access_token}` };
  const api = async (path, init = {}) => {
    const res = await fetch(`${BASE}${path}`, { ...init, signal: timed(120_000), headers: { ...auth, ...(init.body && typeof init.body === 'string' ? { 'content-type': 'application/json' } : {}) } });
    const type = res.headers.get('content-type') ?? '';
    return { status: res.status, type, json: type.includes('json') ? await res.json() : null, bytes: type.includes('pdf') ? Buffer.from(await res.arrayBuffer()) : null };
  };
  console.log(`smoke target: ${BASE} (${truth.id}, ${truth.category}, ${truth.planFunding})\n`);
  const health = await api('/api/health');
  check('dev server is not in DEMO_MODE', health.json?.demo_mode === false, JSON.stringify(health.json));

  const form = new FormData();
  form.append('file', new Blob([readFileSync(new URL(truth.file, SYNTH))], { type: 'application/pdf' }), truth.file);
  const up = await fetch(`${BASE}/api/cases/${kase.id}/documents`, { method: 'POST', body: form, headers: auth, signal: timed(120_000) }).then(async (r) => ({ status: r.status, json: await r.json() }));
  check('upload: 201, read on the server as a denial letter', up.status === 201 && up.json.document?.doc_type === 'denial_letter' && typeof up.json.extraction?.layout?.text === 'string', `${up.status} ${up.json.document?.doc_type}`);
  const docId = up.json.document.id;

  const draft = await api(`/api/cases/${kase.id}/documents/${docId}/denial`);
  const d = draft.json?.draft;
  check('draft: the letter date, claim, code and category as printed', draft.status === 200 && d.noticeDate === truth.letterDate && d.claimNumber === truth.claimNumber && d.carcCodes.join() === truth.carc && d.category === truth.category && d.planFunding === truth.planFunding, JSON.stringify(d).slice(0, 300));
  check('draft: nothing reviewed yet', draft.json?.review === null);
  const early = await api(`/api/cases/${kase.id}/letters`, { method: 'POST', body: JSON.stringify({ documentId: docId, type: 'insurer_appeal', name: 'Sample Patient' }) });
  check('letter: refused before the patient confirms (409)', early.status === 409, String(early.status));
  const bad = await api(`/api/cases/${kase.id}/documents/${docId}/denial`, { method: 'POST', body: JSON.stringify({ ...d, noticeDate: 'yesterday' }) });
  check('confirm: a malformed confirmation is refused (400)', bad.status === 400);
  const noRow = (await pgClient.query('select count(*)::int as n from denials where document_id = $1', [docId])).rows[0].n;
  check('confirm: nothing stored from the refused confirmation', noRow === 0);

  const conf = await api(`/api/cases/${kase.id}/documents/${docId}/denial`, { method: 'POST', body: JSON.stringify(d) });
  const review = conf.json?.review;
  check('confirm: the review comes back with a deadline, flags and letters', conf.status === 200 && review.flags.some((f) => f.id === 'patient_deadline') && review.letterOptions.length > 0, `${conf.status} ${JSON.stringify(conf.json).slice(0, 200)}`);
  const row = (await pgClient.query('select id, check_results, rules_version, plan_funding, carc_codes from denials where document_id = $1', [docId])).rows[0];
  check('confirm: the denial is stored with its check results and rules version', !!row && Array.isArray(row.check_results) && row.rules_version === 'ecfr-2026-10-15' && row.carc_codes.join() === truth.carc);
  const due = review.flags.find((f) => f.id === 'patient_deadline')?.deadline?.due ?? null;
  const dls = (await pgClient.query('select filing_deadline::text as due, rule_id from deadlines where denial_id = $1', [row.id])).rows;
  check('confirm: the patient deadline is stored as a deadlines row with its rule', due ? dls.length === 1 && dls[0].due === due && !!dls[0].rule_id : dls.length === 0, JSON.stringify(dls));
  await api(`/api/cases/${kase.id}/documents/${docId}/denial`, { method: 'POST', body: JSON.stringify(d) });
  const again = (await pgClient.query('select (select count(*) from denials where document_id = $1)::int as d, (select count(*) from deadlines where denial_id = $2)::int as k', [docId, row.id])).rows[0];
  check('confirm again: the denial and its deadline are replaced, not doubled', again.d === 1 && again.k === dls.length);
  const view = await api(`/api/cases/${kase.id}/documents/${docId}/denial`);
  check('GET after confirm: the stored review comes back', view.json?.review?.denialId === row.id);
  check('codes: shown as numbers with the x12 link; no unapproved wording', view.json.review.codes.every((c) => c.url === 'https://x12.org/codes' && c.explanation === null));

  const type = review.letterOptions[0];
  const made = await api(`/api/cases/${kase.id}/letters`, { method: 'POST', body: JSON.stringify({ documentId: docId, type, name: 'Sample Patient', phone: '(555) 555-0100' }) });
  const letter = made.json?.letter;
  check(`letter: ${type} drafted from the denial`, made.status === 201 && letter?.letter_type === type && letter?.drafter === 'code-templates', `${made.status} ${JSON.stringify(made.json).slice(0, 200)}`);
  const lrow = (await pgClient.query('select denial_id from letters where id = $1', [letter.id])).rows[0];
  check('letter: linked to its denial', lrow.denial_id === row.id);
  check('letter: names the claim and ends with the required notice', (letter.subject + letter.body).includes(truth.claimNumber) && letter.footer === 'Prepared by the patient with help from Arik Health, which uses AI to assist. Not legal advice.');
  const misfit = review.letterOptions.includes('part_d_exception') ? null : await api(`/api/cases/${kase.id}/letters`, { method: 'POST', body: JSON.stringify({ documentId: docId, type: 'part_d_exception', name: 'Sample Patient' }) });
  check('letter: a letter that does not fit this denial is refused (409)', misfit === null || misfit.status === 409);
  const frozen = await api(`/api/cases/${kase.id}/letters/${letter.id}`, { method: 'PATCH', body: JSON.stringify({ action: 'freeze' }) });
  check('freeze: frozen with a hash', frozen.status === 200 && /^[0-9a-f]{64}$/.test(frozen.json.letter.content_sha256));
  const pdf = await api(`/api/cases/${kase.id}/letters/${letter.id}?format=pdf`);
  check('pdf: downloads as a PDF', pdf.status === 200 && pdf.bytes?.subarray(0, 5).toString() === '%PDF-');

  const del = await api('/api/privacy', { method: 'DELETE' });
  const left = (await pgClient.query(
    `select (select count(*) from letters where user_id = $1)::int + (select count(*) from denials where user_id = $1)::int + (select count(*) from deadlines where denial_id = $2)::int + (select count(*) from uploaded_documents where user_id = $1)::int + (select count(*) from cases where user_id = $1)::int as n`,
    [USER, row.id],
  )).rows[0].n;
  check('delete everything: the frozen letter, the denial, its deadline, the document and the case are gone', del.status === 200 && left === 0, `${del.status} ${left} left ${JSON.stringify(del.json).slice(0, 300)}`);
} finally {
  await cleanup();
}
await pgClient.end();
console.log(failures ? `\nDENIAL REVIEW SMOKE: ${failures} FAILURE(S)` : '\nDENIAL REVIEW SMOKE: ALL PASS');
process.exit(failures ? 1 : 0);
