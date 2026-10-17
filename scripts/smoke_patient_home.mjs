// Phase 7 P1 smoke: the patient home APIs and pages over HTTP, on rows made
// for a fixture user (fictional). Home (Needs you, Saved so far confirmed
// only, Coming up), Jobs (own and managed patient's, never someone
// else's), Job detail (timeline; another user's job is a 404), Documents
// (a frozen letter downloads byte-identical twice), and the pages render.
// Self-cleaning. Needs a non-demo dev server and db/038 to db/042 applied.
//   node scripts/smoke_patient_home.mjs
import { createHash } from 'node:crypto';
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
if (!/^(127\.0\.0\.1|localhost)$/.test(env.SUPABASE_DB_HOST ?? '')) throw new Error('smoke_patient_home runs against a local database only');

let failures = 0;
function check(name, cond, detail = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ' - ' + detail : ''}`);
  if (!cond) failures++;
}
const timed = (ms) => AbortSignal.timeout(ms);
const pgClient = new pg.Client({ host: env.SUPABASE_DB_HOST, port: Number(env.SUPABASE_DB_PORT ?? 5432), user: 'postgres', password: env.SUPABASE_DB_PASSWORD, database: 'postgres', ssl: false, connectionTimeoutMillis: 10_000 });
await pgClient.connect();
const admin = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const EMAILS = ['home_smoke_a@example.invalid', 'home_smoke_b@example.invalid'];
// Children first, across BOTH users: one user's case can point at the
// other's managed patient.
async function clear(ids) {
  const q = (sql) => pgClient.query(sql, [ids]).catch(() => {});
  const cases = `(select id from cases where user_id = any($1) or managed_patient_id in (select id from managed_patients where caregiver_user_id = any($1)))`;
  await q(`delete from letters where case_id in ${cases}`);
  await q(`delete from case_outcomes where case_id in ${cases}`);
  await q(`delete from deadlines where case_id in ${cases}`);
  await q(`delete from pending_fact_corrections where case_id in ${cases}`);
  await q(`delete from cases where id in ${cases}`);
  await q('delete from managed_patients where caregiver_user_id = any($1)');
  for (const u of ids) await admin.auth.admin.deleteUser(u).catch(() => {});
}
const { data: old } = await admin.auth.admin.listUsers();
await clear((old?.users ?? []).filter((u) => EMAILS.includes(u.email)).map((u) => u.id));
const users = [];
for (const email of EMAILS) {
  const { data, error } = await admin.auth.admin.createUser({ email, password: 'smoke-pass-123', email_confirm: true });
  if (error) throw error;
  users.push(data.user.id);
}
const [A, B] = users;

const cleanup = () => clear(users);

const today = new Date().toISOString().slice(0, 10);
const plus = (d) => new Date(Date.now() + d * 86_400_000).toISOString().slice(0, 10);
const FOOTER = 'Prepared by the patient with help from Arik Health, which uses AI to assist. Not legal advice.';

try {
  const q = (sql, args) => pgClient.query(sql, args).then((r) => r.rows);
  const [mp] = await q(`insert into managed_patients (caregiver_user_id, patient_name, relationship) values ($1, 'Rosa Sample', 'parent') returning id`, [A]);
  const [won] = await q(`insert into cases (user_id, case_type, status, resolved_at) values ($1, 'bill_dispute', 'resolved_won', now()) returning id`, [A]);
  const [open] = await q(`insert into cases (user_id, case_type, estimated_recoverable_usd) values ($1, 'denial_appeal', 1180) returning id`, [A]);
  const [managed] = await q(`insert into cases (user_id, managed_patient_id, case_type) values ($1, $2, 'prescription_savings') returning id`, [B, mp.id]);
  const [stranger] = await q(`insert into cases (user_id, case_type) values ($1, 'bill_dispute') returning id`, [B]);
  await q(`insert into case_outcomes (case_id, original_amount_owed_usd, revised_amount_owed_usd, patient_confirmed) values ($1, 2000, 1588, true)`, [won.id]);
  await q(`insert into case_outcomes (case_id, refund_received_usd, patient_confirmed) values ($1, 999, false)`, [open.id]);
  await q(`insert into deadlines (case_id, filing_deadline, step) values ($1, $2, 'internal_appeal')`, [open.id, plus(10)]);
  await q(`insert into pending_fact_corrections (user_id, case_id, target_table, target_id, field, new_value) values ($1, $2, 'cases', $2, 'institution_name', 'Pinecrest Valley Hospital')`, [A, open.id]);
  const letter = { subject: 'Request for internal appeal, claim CL-12-3456789', body: 'To Bluefin Health Plan,\n\nI am asking for an internal appeal.\n\nSincerely,\nSample Patient', footer: FOOTER };
  const sha = createHash('sha256').update(`${letter.subject}\n\n${letter.body}\n\n${letter.footer}`, 'utf8').digest('hex');
  const [l] = await q(`insert into letters (user_id, case_id, letter_type, subject, body, footer, drafter, status, frozen_at, content_sha256) values ($1, $2, 'insurer_appeal', $3, $4, $5, 'code-templates', 'frozen', now(), $6) returning id`, [A, open.id, letter.subject, letter.body, letter.footer, sha]);

  const tok = await fetch(`${env.SUPABASE_URL}/auth/v1/token?grant_type=password`, { method: 'POST', signal: timed(20_000), headers: { apikey: env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ email: EMAILS[0], password: 'smoke-pass-123' }) }).then((r) => r.json());
  const auth = { Authorization: `Bearer ${tok.access_token}` };
  const api = async (path) => {
    const res = await fetch(`${BASE}${path}`, { signal: timed(60_000), headers: auth });
    const type = res.headers.get('content-type') ?? '';
    return { status: res.status, json: type.includes('json') ? await res.json() : null, bytes: type.includes('pdf') ? Buffer.from(await res.arrayBuffer()) : null, text: type.includes('html') ? await res.text() : null };
  };
  console.log(`smoke target: ${BASE}\n`);
  check('dev server is not in DEMO_MODE', (await api('/api/health')).json?.demo_mode === false);

  const home = await api('/api/home');
  check('home: 200', home.status === 200, String(home.status));
  check('home: Saved so far counts only the confirmed $412, not the unconfirmed $999', home.json.saved.confirmedUsd === 412, JSON.stringify(home.json.saved));
  check('home: the open job\'s estimate is "possible", labeled separately', home.json.saved.possibleUsd === 1180);
  check('home: Needs you has the correction and the deadline in 10 days, soonest first', home.json.needsYou.some((n) => /Confirm your hospital or clinic/.test(n.title)) && home.json.needsYou[0].due === plus(10), JSON.stringify(home.json.needsYou));
  check('home: Coming up lists the deadline', home.json.comingUp.some((c) => c.date === plus(10)));

  const jobs = await api('/api/jobs');
  const ids = jobs.json.jobs.map((j) => j.caseId);
  check('jobs: own jobs and the managed patient\'s job, never another user\'s', ids.includes(won.id) && ids.includes(open.id) && ids.includes(managed.id) && !ids.includes(stranger.id), ids.join());
  check('jobs: chips in words (Won, Needs you), the managed job marked', jobs.json.jobs.find((j) => j.caseId === won.id).chipWords === 'Won' && jobs.json.jobs.find((j) => j.caseId === open.id).chipWords === 'Needs you' && jobs.json.jobs.find((j) => j.caseId === managed.id).forSomeoneElse);

  const job = await api(`/api/jobs/${open.id}`);
  check('job detail: timeline with the letter and the deadline, newest first', job.status === 200 && job.json.timeline.some((t) => t.kind === 'letter') && job.json.timeline.some((t) => t.kind === 'deadline') && job.json.timeline.every((t, i, a) => i === 0 || a[i - 1].at >= t.at));
  check('job detail: money shows confirmed none, unconfirmed not counted', job.json.money.confirmedUsd === 0);
  const other = await api(`/api/jobs/${stranger.id}`);
  check("job detail: another user's job is a 404", other.status === 404);
  const ghost = await api('/api/jobs/00000000-0000-0000-0000-000000000000');
  check('job detail: a missing job is the same 404', ghost.status === 404);

  const docs = await api('/api/documents');
  const d = docs.json.documents.find((x) => x.id === l.id);
  check('documents: the frozen letter, with its fingerprint and a PDF', d?.status === 'Final copy' && d.sha256 === sha && d.pdf === 'letter', JSON.stringify(d));
  const p1 = await api(`/api/cases/${open.id}/letters/${l.id}?format=pdf`);
  await new Promise((r) => setTimeout(r, 1200));
  const p2 = await api(`/api/cases/${open.id}/letters/${l.id}?format=pdf`);
  check('documents: the frozen PDF downloads byte-identical every time', p1.status === 200 && p2.status === 200 && Buffer.compare(p1.bytes, p2.bytes) === 0);

  for (const page of ['/home', '/jobs', `/jobs/${open.id}`, '/docs']) {
    const res = await fetch(`${BASE}${page}`, { signal: timed(60_000) });
    check(`page ${page.replace(open.id, ':id')} renders`, res.status === 200);
  }
} finally {
  await cleanup();
}
await pgClient.end();
console.log(failures ? `\nPATIENT HOME SMOKE: ${failures} FAILURE(S)` : '\nPATIENT HOME SMOKE: ALL PASS');
process.exit(failures ? 1 : 0);
