// Feature D smoke: data retention automation. Covers: resolved_at set on
// terminal transitions (and only there), extended-retention opt-in/out +
// consent ledger + cross-user isolation, demographic-clear ledgering,
// the raw-upload purge job (storage object gone, row + extracted_data
// kept, 401 on wrong key), the pg_cron case purge (expired case +
// children deleted, summary snapshot survives; recent and
// extended-retention cases untouched), and the cron schedule itself.
// Usage: node scripts/smoke_retention.mjs (dev server must be running).
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

const pgClient = new pg.Client({
  host: env.SUPABASE_DB_HOST, port: 5432, user: 'postgres',
  password: env.SUPABASE_DB_PASSWORD, database: 'postgres',
  ssl: { rejectUnauthorized: false },
});

let failures = 0;
function check(name, cond, detail = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ' - ' + detail : ''}`);
  if (!cond) failures++;
}

async function signIn(email, password) {
  const res = await fetch(`${env.SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const json = await res.json();
  if (!json.access_token) throw new Error(`sign-in failed: ${JSON.stringify(json)}`);
  return json.access_token;
}

await pgClient.connect();
const admin = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const mkUser = async (email) => {
  const { data, error } = await admin.auth.admin.createUser({
    email, password: 'smoke-pass-123', email_confirm: true,
  });
  if (error) throw error;
  return data.user.id;
};
const USER = await mkUser('retention_smoke@example.invalid');
const USER2 = await mkUser('retention_smoke2@example.invalid');
const token = await signIn('retention_smoke@example.invalid', 'smoke-pass-123');
const token2 = await signIn('retention_smoke2@example.invalid', 'smoke-pass-123');

const { rows: [kase] } = await pgClient.query(
  `insert into cases (user_id, case_type) values ($1, 'bill_dispute') returning id`, [USER],
);

async function transition(id, to) {
  const res = await fetch(`${BASE}/api/cases/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ to }),
  });
  return { status: res.status, json: await res.json() };
}

console.log(`smoke target: ${BASE}\n`);

// 1. resolved_at follows terminal transitions only.
await transition(kase.id, 'action_ready');
let { rows: [c] } = await pgClient.query(`select resolved_at from cases where id = $1`, [kase.id]);
check('non-terminal transition leaves resolved_at null', c.resolved_at === null);
await transition(kase.id, 'submitted');
await transition(kase.id, 'awaiting_response');
const won = await transition(kase.id, 'resolved_won');
check('resolved_won returns 200', won.status === 200, JSON.stringify(won.json).slice(0, 120));
({ rows: [c] } = await pgClient.query(`select resolved_at from cases where id = $1`, [kase.id]));
check('terminal transition sets resolved_at', c.resolved_at !== null, String(c.resolved_at));

// 2. Extended-retention opt-in/out, ledgered; cross-user isolation.
const { rows: [mp] } = await pgClient.query(
  `insert into managed_patients (caregiver_user_id, patient_name) values ($1, 'Dad') returning id`, [USER],
);
async function patchRetention(mpid, value, tk = token) {
  const res = await fetch(`${BASE}/api/managed-patients`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tk}` },
    body: JSON.stringify({ managedPatientId: mpid, extendedRetention: value }),
  });
  return { status: res.status, json: await res.json() };
}
const optIn = await patchRetention(mp.id, true);
check('opt-in returns 200', optIn.status === 200 && optIn.json?.extended_retention === true, JSON.stringify(optIn.json));
const optOut = await patchRetention(mp.id, false);
check('opt-out returns 200', optOut.status === 200 && optOut.json?.extended_retention === false);
const crossUser = await patchRetention(mp.id, true, token2);
check('other user cannot flip the flag (404)', crossUser.status === 404, `got ${crossUser.status}`);
const { rows: retentionLedger } = await pgClient.query(
  `select action from consent_ledger where user_id = $1 and category = 'extended_retention' order by created_at`, [USER],
);
check('both retention choices ledgered (append-only)',
  retentionLedger.length === 2 && retentionLedger[0].action === 'opt_in' && retentionLedger[1].action === 'opt_out',
  JSON.stringify(retentionLedger));

// 3. Demographic clear is ledgered.
await pgClient.query(
  `insert into user_matching_profile (id, demographic_eligibility_flags) values ($1, $2)
   on conflict (id) do update set demographic_eligibility_flags = $2`,
  [USER, JSON.stringify({ race: 'test-value' })],
);
const clear = await fetch(`${BASE}/api/privacy`, {
  method: 'PATCH',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ userId: USER, category: 'race' }),
});
check('demographic clear returns 200', clear.status === 200);
const { rows: demoLedger } = await pgClient.query(
  `select action, detail from consent_ledger where user_id = $1 and category = 'demographic_eligibility'`, [USER],
);
check('demographic clear ledgered with category',
  demoLedger.length === 1 && demoLedger[0].action === 'clear' && demoLedger[0].detail?.demographic_category === 'race',
  JSON.stringify(demoLedger));

// 4. Raw-upload purge job.
const docId = crypto.randomUUID();
const storagePath = `${USER}/${kase.id}/${docId}-old-bill.pdf`;
await admin.storage.from('raw-uploads').upload(storagePath, Buffer.from('stale raw file'));
await pgClient.query(
  `insert into uploaded_documents (id, user_id, case_id, doc_type, source_format, storage_path, raw_upload_expires_at, extraction_status, extracted_data)
   values ($1, $2, $3, 'itemized_bill', 'pdf_native', $4, now() - interval '1 hour', 'extracted', $5)`,
  [docId, USER, kase.id, storagePath, JSON.stringify({ doc_type: 'itemized_bill', institution_name: 'Test Hospital' })],
);
const wrongKey = await fetch(`${BASE}/api/jobs/purge-expired-uploads`, {
  method: 'POST', headers: { Authorization: 'Bearer wrong-key' },
});
check('purge job rejects wrong key (401)', wrongKey.status === 401, `got ${wrongKey.status}`);
const purge = await fetch(`${BASE}/api/jobs/purge-expired-uploads`, {
  method: 'POST', headers: { Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` },
});
const purgeJson = await purge.json();
check('purge job purges the expired upload', purge.status === 200 && purgeJson.purged >= 1, JSON.stringify(purgeJson));
const { data: gone } = await admin.storage.from('raw-uploads').list(`${USER}/${kase.id}`);
check('storage object is gone', (gone ?? []).length === 0, `${(gone ?? []).length} left`);
const { rows: [docRow] } = await pgClient.query(`select storage_path, extracted_data from uploaded_documents where id = $1`, [docId]);
check('row kept, storage_path nulled, extracted_data intact',
  docRow.storage_path === null && docRow.extracted_data?.institution_name === 'Test Hospital');
const purgeAgain = await (await fetch(`${BASE}/api/jobs/purge-expired-uploads`, {
  method: 'POST', headers: { Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` },
})).json();
check('second run is a no-op (purged 0)', purgeAgain.purged === 0, JSON.stringify(purgeAgain));

// 5. pg_cron case purge: expired case + children deleted, summary survives.
await pgClient.query(`delete from uploaded_documents where id = $1`, [docId]);
const mkExpiredCase = async (opts = {}) => {
  const { rows: [kc] } = await pgClient.query(
    `insert into cases (user_id, managed_patient_id, case_type, status, institution_name, resolved_at)
     values ($1, $2, 'bill_dispute', 'resolved_won', 'General Hospital', now() - interval '91 days') returning id`,
    [USER, opts.managedPatientId ?? null],
  );
  return kc.id;
};
const expiredId = await mkExpiredCase();
await pgClient.query(`insert into deadlines (case_id, filing_deadline) values ($1, '2026-01-01')`, [expiredId]);
await pgClient.query(
  `insert into case_outcomes (case_id, original_amount_owed_usd, revised_amount_owed_usd, refund_received_usd, patient_confirmed)
   values ($1, 4000, 1200, 300, true)`, [expiredId],
);
const { rows: [sess] } = await pgClient.query(
  `insert into chat_sessions (user_id, case_id) values ($1, $2) returning id`, [USER, expiredId],
);
await pgClient.query(`insert into chat_messages (session_id, role, content) values ($1, 'user', 'hi')`, [sess.id]);
await pgClient.query(
  `insert into pending_fact_corrections (user_id, case_id, target_table, target_id, field, new_value) values ($1, $2, 'cases', $2, 'institution_name', 'X')`,
  [USER, expiredId],
);
const recentId = await mkExpiredCase();
await pgClient.query(`update cases set resolved_at = now() - interval '89 days' where id = $1`, [recentId]);
await pgClient.query(`update managed_patients set extended_retention = true where id = $1`, [mp.id]);
const keptId = await mkExpiredCase({ managedPatientId: mp.id });

const { rows: [purgeCount] } = await pgClient.query(`select purge_expired_cases() as n`);
check('purge function reports the expired case', purgeCount.n === 1, `n=${purgeCount.n}`);
const { rows: gone2 } = await pgClient.query(
  `select (select count(*) from cases where id = $1)
        + (select count(*) from deadlines where case_id = $1)
        + (select count(*) from case_outcomes where case_id = $1)
        + (select count(*) from chat_sessions where case_id = $1)
        + (select count(*) from pending_fact_corrections where case_id = $1) as total`, [expiredId],
);
check('expired case and all children are gone', gone2[0].total === '0', `total=${gone2[0].total}`);
const { rows: [summary] } = await pgClient.query(`select * from case_summaries where user_id = $1`, [USER]);
check('summary survives with status + amounts + institution',
  summary?.final_status === 'resolved_won'
  && Number(summary?.original_amount_owed_usd) === 4000
  && Number(summary?.refund_received_usd) === 300
  && summary?.institution_name === 'General Hospital',
  JSON.stringify({ status: summary?.final_status, orig: summary?.original_amount_owed_usd, inst: summary?.institution_name }));
const { rows: [recentAlive] } = await pgClient.query(`select count(*)::int as n from cases where id = $1`, [recentId]);
check('case resolved 89 days ago is NOT purged', recentAlive.n === 1);
const { rows: [keptAlive] } = await pgClient.query(`select count(*)::int as n from cases where id = $1`, [keptId]);
check('extended-retention case is NOT purged', keptAlive.n === 1);
const { rows: summaryCount } = await pgClient.query(`select count(*)::int as n from case_summaries where user_id = $1`, [USER]);
check('exactly one summary (no summary for kept cases)', summaryCount[0].n === 1);

// 6. The schedule itself exists.
const { rows: jobs } = await pgClient.query(`select jobname, schedule from cron.job where jobname = 'purge-expired-cases'`);
check('pg_cron job is scheduled', jobs.length === 1 && jobs[0].schedule === '15 4 * * *', JSON.stringify(jobs[0]));

// Cleanup
await pgClient.query(`delete from pending_fact_corrections where user_id = $1`, [USER]);
await pgClient.query(`delete from pending_case_facts where user_id = $1`, [USER]);
await pgClient.query(`delete from consent_ledger where user_id in ($1, $2)`, [USER, USER2]);
await pgClient.query(`delete from case_summaries where user_id = $1`, [USER]);
await pgClient.query(`delete from chat_messages where session_id in (select id from chat_sessions where user_id = $1)`, [USER]);
await pgClient.query(`delete from chat_sessions where user_id = $1`, [USER]);
await pgClient.query(`delete from deadlines where case_id in (select id from cases where user_id = $1)`, [USER]);
await pgClient.query(`delete from case_outcomes where case_id in (select id from cases where user_id = $1)`, [USER]);
await pgClient.query(`delete from uploaded_documents where user_id = $1`, [USER]);
await pgClient.query(`delete from cases where user_id = $1`, [USER]);
await pgClient.query(`delete from managed_patients where caregiver_user_id = $1`, [USER]);
await pgClient.query(`delete from user_matching_profile where id in ($1, $2)`, [USER, USER2]);
await admin.auth.admin.deleteUser(USER);
await admin.auth.admin.deleteUser(USER2);
await pgClient.end();

console.log(failures === 0 ? '\nRETENTION SMOKE: ALL PASS' : `\nRETENTION SMOKE: ${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
