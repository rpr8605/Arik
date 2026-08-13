// scripts/load_state_corroboration.mjs
// One-time loader for the state-law reconciliation (plan B3): fills
// corroboration_count + source_pass_ids on state_accumulator_ban_laws rows
// from docs/research/state-law-reconciliation.json. Only touches
// 'secondary_aggregated' rows — owner-verified rows (IA/ND/CA) and the
// flagged NV row are never overwritten. Re-runnable.
import { readFileSync } from 'node:fs';
import pg from 'pg';

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
const recon = JSON.parse(readFileSync(new URL('../docs/research/state-law-reconciliation.json', import.meta.url), 'utf8'));

const client = new pg.Client({
  host: env.SUPABASE_DB_HOST, port: 5432, user: 'postgres',
  password: env.SUPABASE_DB_PASSWORD, database: 'postgres',
  ssl: { rejectUnauthorized: false },
});
await client.connect();
let updated = 0, skipped = 0;
for (const r of recon.records) {
  const votes = [r.p1?.has_law, r.p2?.has_law, r.p3?.has_law].filter((v) => v === 'Y' || v === 'N');
  const yVotes = votes.filter((v) => v === 'Y').length;
  const nVotes = votes.filter((v) => v === 'N').length;
  const corroboration = Math.max(yVotes, nVotes);
  const passIds = {
    p1: { has_law: r.p1?.has_law ?? null, citation: r.p1?.citation ?? null, implied: r.p1?.implied ?? false },
    p2: { has_law: r.p2?.has_law ?? null, citation: r.p2?.citation ?? null },
    p3: { has_law: r.p3?.has_law ?? null, citation: r.p3?.citation ?? null },
  };
  const res = await client.query(
    `update state_accumulator_ban_laws
       set corroboration_count = $1, source_pass_ids = $2, updated_at = now()
     where state_code = $3 and verification_status = 'secondary_aggregated'`,
    [corroboration, JSON.stringify(passIds), r.code],
  );
  if (res.rowCount > 0) updated += res.rowCount; else skipped++;
}
console.log(`corroboration loaded on ${updated} secondary row(s); skipped ${skipped} (verified/flagged rows untouched)`);
await client.end();
