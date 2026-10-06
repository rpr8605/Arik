// Full-account deletion test (M18-AC5, audit bug fix 2026-10-05): a user
// with a case, chat session + messages, an uploaded document and a
// deadline deletes their account; every owned row must be gone.
// Regression for the FK-order bug (cases deleted before chat_sessions).
// Live: needs the local stack. Run: npx tsx scripts/smoke_privacy_delete.ts
import { readFileSync } from 'node:fs';
import pg from 'pg';

for (const line of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/i);
  if (m && !m[1].startsWith('#')) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
}

let failures = 0;
function check(name: string, cond: boolean, detail = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ' - ' + detail : ''}`);
  if (!cond) failures++;
}

const client = new pg.Client({
  host: process.env.SUPABASE_DB_HOST,
  port: Number(process.env.SUPABASE_DB_PORT ?? 54322),
  user: 'postgres',
  password: process.env.SUPABASE_DB_PASSWORD,
  database: 'postgres',
  ssl: process.env.SUPABASE_DB_SSL === 'off' ? false : { rejectUnauthorized: false },
  connectionTimeoutMillis: 15000,
});

async function count(table: string, where: string, params: unknown[]): Promise<number> {
  const r = await client.query(`select count(*)::int as n from ${table} where ${where}`, params);
  return r.rows[0].n;
}

async function main() {
  await client.connect();
  const { createClient } = await import('@supabase/supabase-js');
  const admin = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const { data: created, error } = await admin.auth.admin.createUser({
    email: 'privacy_smoke@example.invalid', password: 'smoke-pass-123', email_confirm: true,
  });
  if (error) throw error;
  const uid = created.user.id;

  // Fixture: identity, profile, case, session + message, document, deadline.
  await client.query(`insert into user_identity (id) values ($1)`, [uid]);
  await client.query(`insert into user_matching_profile (id) values ($1)`, [uid]);
  const { rows: [kase] } = await client.query(
    `insert into cases (user_id, case_type, status, next_action) values ($1, 'prescription_savings', 'gathering_evidence', 'x') returning id`, [uid]);
  const { rows: [sess] } = await client.query(
    `insert into chat_sessions (user_id, case_id) values ($1, $2) returning id`, [uid, kase.id]);
  await client.query(
    `insert into chat_messages (session_id, role, content) values ($1, 'user', 'test'), ($1, 'assistant', 'test')`, [sess.id]);
  await client.query(
    `insert into uploaded_documents (user_id, case_id, doc_type) values ($1, $2, 'itemized_bill')`, [uid, kase.id]);
  await client.query(
    `insert into deadlines (case_id, filing_deadline) values ($1, '2026-12-31')`, [kase.id]);

  const { deleteAllUserData } = await import('../lib/privacy');
  const deleted = await deleteAllUserData(uid);
  console.log(`deleted: ${JSON.stringify(deleted)}`);

  check('cases gone', (await count('cases', 'user_id = $1', [uid])) === 0);
  check('chat_sessions gone', (await count('chat_sessions', 'user_id = $1', [uid])) === 0);
  check('chat_messages gone', (await count('chat_messages', 'session_id = $1', [sess.id])) === 0);
  check('uploaded_documents gone', (await count('uploaded_documents', 'user_id = $1', [uid])) === 0);
  check('deadlines gone', (await count('deadlines', 'case_id = $1', [kase.id])) === 0);
  check('identity gone', (await count('user_identity', 'id = $1', [uid])) === 0);
  check('profile gone', (await count('user_matching_profile', 'id = $1', [uid])) === 0);

  const { error: delErr } = await admin.auth.admin.deleteUser(uid);
  check('auth user deletes after cascade (no FK 500)', !delErr, delErr?.message ?? '');

  await client.end();
  console.log(failures === 0 ? '\nPRIVACY DELETE: ALL PASS' : `\nPRIVACY DELETE: ${failures} FAILURE(S)`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
