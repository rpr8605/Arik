// Feature C smoke: document intake pipeline end-to-end. Covers: native
// text PDF (text-first path + institution merge into the case), scanned
// PDF (vision fallback), image upload, HEIC failure handling (first-class
// 'failed' row, not a crash), 413/415/401 screening, storage persistence,
// and the 48h raw-upload expiry field. Usage:
//   node scripts/smoke_documents.mjs   (dev server must be running)
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
  host: env.SUPABASE_DB_HOST, port: Number(env.SUPABASE_DB_PORT ?? 5432), user: 'postgres',
  password: env.SUPABASE_DB_PASSWORD, database: 'postgres',
  ssl: env.SUPABASE_DB_SSL === 'off' ? false : { rejectUnauthorized: false },
});

let failures = 0;
function check(name, cond, detail = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ' - ' + detail : ''}`);
  if (!cond) failures++;
}

// Minimal valid one-page PDF with an embedded text layer (xref offsets
// computed). Lines=[] produces an image-only PDF for the scanned path.
function makePdf(lines) {
  const esc = (s) => s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
  const content = lines.length
    ? 'BT /F1 14 Tf 14 TL 72 740 Td ' + lines.map((l, i) => `${i ? 'T* ' : ''}(${esc(l)}) Tj`).join(' ') + ' ET'
    : '';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [];
  objects.forEach((body, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xrefStart = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) pdf += `${String(off).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;
  return Buffer.from(pdf, 'binary');
}

const BILL_PDF = makePdf([
  'ITEMIZED STATEMENT',
  "St. David's Medical Center",
  'Patient: JOHN DOE    Account: 123456',
  'Date of service: 01/15/2026',
  'Procedure: ER VISIT LEVEL 3',
  'Total charges: $4,200.00',
  'Insurance adjustments: -$2,950.00',
  'PATIENT RESPONSIBILITY: $1,250.00',
  'Please pay within 30 days. Billing questions: 512-555-0100',
]);
const SCANNED_PDF = makePdf([]);
// 1x1 PNG (a single red pixel - the model sees a dot, returns 'other').
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

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
const { data: created, error: createErr } = await admin.auth.admin.createUser({
  email: 'docs_smoke@example.invalid', password: 'smoke-pass-123', email_confirm: true,
});
if (createErr) throw createErr;
const USER = created.user.id;
const { rows: [kase] } = await pgClient.query(
  `insert into cases (user_id, case_type) values ($1, 'bill_dispute') returning id`, [USER],
);
const token = await signIn('docs_smoke@example.invalid', 'smoke-pass-123');

async function upload(buf, filename, mime, tk = token) {
  const form = new FormData();
  form.append('file', new Blob([buf], { type: mime }), filename);
  const res = await fetch(`${BASE}/api/cases/${kase.id}/documents`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tk}` },
    body: form,
  });
  const raw = await res.text();
  let json;
  try {
    json = JSON.parse(raw);
  } catch {
    json = { _raw: raw.slice(0, 300) };
  }
  return { status: res.status, json };
}
const docRow = async (id) =>
  (await pgClient.query(`select * from uploaded_documents where id = $1`, [id])).rows[0];

console.log(`smoke target: ${BASE}\n`);

// 1. Screening: 401 / 415 / 413.
const noAuth = await upload(BILL_PDF, 'bill.pdf', 'application/pdf', '');
check('unauthenticated upload returns 401', noAuth.status === 401, `got ${noAuth.status}`);
const txt = await upload(Buffer.from('hello'), 'notes.txt', 'text/plain');
check('text file rejected 415', txt.status === 415, `got ${txt.status}`);
const big = await upload(Buffer.alloc(25 * 1024 * 1024 + 1), 'big.pdf', 'application/pdf');
check('oversize file rejected 413', big.status === 413, `got ${big.status}`);

// 2. Native text PDF: text-first path, extraction, institution merge.
const native = await upload(BILL_PDF, 'bill.pdf', 'application/pdf');
check('native pdf returns 201', native.status === 201, JSON.stringify(native.json).slice(0, 200));
check('native pdf source_format is pdf_native', native.json?.document?.source_format === 'pdf_native');
check('native pdf extraction succeeded', native.json?.document?.extraction_status === 'extracted');
console.log(`   model read: doc_type=${native.json?.extraction?.doc_type} amount=${native.json?.extraction?.total_amount_usd} institution=${native.json?.extraction?.institution_name}`);
check('native pdf doc_type is a known value', ['itemized_bill', 'eob', 'other'].includes(native.json?.extraction?.doc_type));
check('native pdf found a positive patient amount', typeof native.json?.extraction?.total_amount_usd === 'number' && native.json.extraction.total_amount_usd > 0, String(native.json?.extraction?.total_amount_usd));
const nativeRow = await docRow(native.json?.document?.id);
check('row carries storage_path + expiry', !!nativeRow?.storage_path && !!nativeRow?.raw_upload_expires_at);
const ttlH = nativeRow ? (new Date(nativeRow.raw_upload_expires_at) - new Date(nativeRow.created_at)) / 3600_000 : 0;
check('expiry is ~48h after upload (working default, pending review)', ttlH > 47.9 && ttlH < 48.1, `${ttlH.toFixed(2)}h`);
const { rows: [kaseAfter] } = await pgClient.query(`select institution_name from cases where id = $1`, [kase.id]);
check('institution merged from document into the case', (kaseAfter?.institution_name ?? '').toLowerCase().includes('david'), kaseAfter?.institution_name);

// 3. Storage object really exists.
const { data: stored } = await admin.storage.from('raw-uploads').list(`${USER}/${kase.id}`);
check('raw file exists in raw-uploads bucket', (stored ?? []).length >= 1, `${(stored ?? []).length} object(s)`);

// 4. Scanned PDF: no text layer -> vision fallback.
const scanned = await upload(SCANNED_PDF, 'scan.pdf', 'application/pdf');
check('scanned pdf returns 201', scanned.status === 201, JSON.stringify(scanned.json).slice(0, 200));
check('scanned pdf source_format is pdf_scanned', scanned.json?.document?.source_format === 'pdf_scanned');
check('scanned pdf extraction succeeded', scanned.json?.document?.extraction_status === 'extracted');

// 5. Image upload (screenshot path).
const img = await upload(PNG, 'screenshot.png', 'image/png');
check('png upload returns 201', img.status === 201, JSON.stringify(img.json).slice(0, 200));
check('png source_format is image_upload', img.json?.document?.source_format === 'image_upload');

// 6. HEIC routing: an invalid HEIC must fail LOUD as a first-class
//    'failed' row (502), never crash or silently store junk.
const heic = await upload(Buffer.from('this is not a real heic file'), 'photo.heic', 'image/heic');
check('invalid heic returns 502 (clean failure)', heic.status === 502, `got ${heic.status}`);
const heicRow = await docRow(heic.json?.document_id);
check('failed extraction kept as first-class row with error', heicRow?.extraction_status === 'failed' && !!heicRow?.extraction_error, heicRow?.extraction_error?.slice(0, 80));
check('failed row still has purge deadline (raw PHI never lingers)', !!heicRow?.raw_upload_expires_at);

// Cleanup: storage objects first, then rows, then the user.
const { data: objects } = await admin.storage.from('raw-uploads').list(`${USER}/${kase.id}`);
if ((objects ?? []).length > 0) {
  await admin.storage.from('raw-uploads').remove(objects.map((o) => `${USER}/${kase.id}/${o.name}`));
}
await pgClient.query(`delete from pending_fact_corrections where user_id = $1`, [USER]);
await pgClient.query(`delete from pending_case_facts where user_id = $1`, [USER]);
await pgClient.query(`delete from uploaded_documents where user_id = $1`, [USER]);
await pgClient.query(`delete from cases where user_id = $1`, [USER]);
await pgClient.query(`delete from user_matching_profile where id = $1`, [USER]);
await admin.auth.admin.deleteUser(USER);
await pgClient.end();

console.log(failures === 0 ? '\nDOCUMENTS SMOKE: ALL PASS' : `\nDOCUMENTS SMOKE: ${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
