// Step 0 (2026-10-01): per-route proof of the API auth boundary.
// For every route that carried an AUTH NOTE:
//   1. an unauthenticated request (no session) gets 401, and
//   2. a cross-user attempt gets 404 (object routes) or is provably
//      scoped to the session user (collection/write routes - the spy
//      asserts the session id, never the request-supplied id, reaches
//      the data layer).
// Deterministic: handlers run with the apiDeps registry (lib/apiAuth.ts)
// rebound to fakes - no server, database, or auth provider needed.
// Run: npx tsx scripts/test_auth_guards.ts

import { apiDeps } from '../lib/apiAuth';
import { GET as casesGet, POST as casesPost } from '../app/api/cases/route';
import { GET as caseGet, PATCH as casePatch } from '../app/api/cases/[id]/route';
import { GET as deadlinesGet, POST as deadlinesPost } from '../app/api/cases/[id]/deadlines/route';
import { GET as identityGet, PUT as identityPut } from '../app/api/identity/route';
import { GET as outcomesGet, POST as outcomesPost } from '../app/api/outcomes/route';
import { DELETE as privacyDelete, PATCH as privacyPatch } from '../app/api/privacy/route';
import {
  GET as managedGet,
  POST as managedPost,
  PATCH as managedPatch,
} from '../app/api/managed-patients/route';
import { POST as chatPost } from '../app/api/chat/route';
import { POST as documentsPost } from '../app/api/cases/[id]/documents/route';
import { POST as correctionsPost } from '../app/api/corrections/route';
import { GET as preferencesGet, PUT as preferencesPut } from '../app/api/preferences/route';
import { PUT as insuranceTypePut } from '../app/api/profile/insurance-type/route';
import { POST as casesStartPost } from '../app/api/cases/start/route';
import { GET as healthGet } from '../app/api/health/route';
import { POST as purgePost } from '../app/api/jobs/purge-expired-uploads/route';

let failures = 0;
function check(name: string, cond: boolean, detail = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ' - ' + detail : ''}`);
  if (!cond) failures++;
}

const ORIGINAL = { ...apiDeps };
function stub(partial: Partial<typeof apiDeps>) {
  Object.assign(apiDeps, partial);
}
function restore() {
  Object.assign(apiDeps, ORIGINAL);
}

const A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'; // session user
const B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'; // the other user

function fakeReq(opts: { url?: string; body?: unknown; formData?: boolean } = {}): any {
  const url = new URL(opts.url ?? 'http://localhost/api/x');
  return {
    nextUrl: url,
    url: url.toString(),
    headers: new Headers(),
    json: async () => opts.body ?? {},
    formData: async () => new FormData(),
  };
}
const noSession = { getUserId: async () => null };
const asA = { getUserId: async () => A };
const paramsFor = (id: string) => ({ params: Promise.resolve({ id }) });

async function expect401(name: string, call: () => Promise<Response>) {
  stub(noSession);
  const res = await call();
  restore();
  check(name, res.status === 401, `status ${res.status}`);
}

async function main() {

// --- /api/cases ---
await expect401('cases GET: unauthenticated -> 401', () => casesGet(fakeReq()));
{
  let seen: string | null = null;
  stub({ ...asA, listCases: (async (uid: string) => { seen = uid; return []; }) as any });
  const res = await casesGet(fakeReq({ url: `http://localhost/api/cases?userId=${B}` }));
  restore();
  check('cases GET: ?userId=B ignored, queries as session user A', res.status === 200 && seen === A, `queried ${seen}`);
}
await expect401('cases POST: unauthenticated -> 401', () => casesPost(fakeReq({ body: { caseType: 'prescription_savings' } })));
{
  let seen: string | null = null;
  stub({ ...asA, createCase: (async (input: any) => { seen = input.userId; return { id: 'c1' }; }) as any });
  const res = await casesPost(fakeReq({ body: { userId: B, caseType: 'prescription_savings' } }));
  restore();
  check('cases POST: body userId=B ignored, creates as session user A', res.status === 201 && seen === A, `created for ${seen}`);
}
{
  stub({ ...asA, ownsManagedPatient: (async () => false) as any });
  const res = await casesPost(fakeReq({ body: { caseType: 'prescription_savings', managedPatientId: 'mp-1' } }));
  restore();
  check("cases POST: someone else's managedPatientId -> 404", res.status === 404, `status ${res.status}`);
}

// --- /api/cases/[id] ---
await expect401('cases/[id] GET: unauthenticated -> 401', () => caseGet(fakeReq(), paramsFor('c1')));
{
  stub({ ...asA, canAccessCase: (async () => false) as any });
  const res = await caseGet(fakeReq(), paramsFor('c1'));
  restore();
  check("cases/[id] GET: B's case -> 404", res.status === 404, `status ${res.status}`);
}
{
  stub({ ...asA, canAccessCase: (async () => true) as any, getCase: (async () => ({ id: 'c1', user_id: A })) as any });
  const res = await caseGet(fakeReq(), paramsFor('c1'));
  restore();
  check('cases/[id] GET: own case -> 200', res.status === 200, `status ${res.status}`);
}
await expect401('cases/[id] PATCH: unauthenticated -> 401', () => casePatch(fakeReq({ body: { to: 'action_ready' } }), paramsFor('c1')));
{
  stub({ ...asA, canAccessCase: (async () => false) as any });
  const res = await casePatch(fakeReq({ body: { to: 'action_ready' } }), paramsFor('c1'));
  restore();
  check("cases/[id] PATCH: B's case -> 404", res.status === 404, `status ${res.status}`);
}

// --- /api/cases/[id]/deadlines ---
await expect401('deadlines GET: unauthenticated -> 401', () => deadlinesGet(fakeReq(), paramsFor('c1')));
{
  stub({ ...asA, canAccessCase: (async () => false) as any });
  const res = await deadlinesGet(fakeReq(), paramsFor('c1'));
  restore();
  check("deadlines GET: B's case -> 404", res.status === 404, `status ${res.status}`);
}
await expect401('deadlines POST: unauthenticated -> 401', () => deadlinesPost(fakeReq({ body: { noticeDate: '2026-07-01' } }), paramsFor('c1')));
{
  stub({ ...asA, canAccessCase: (async () => false) as any });
  const res = await deadlinesPost(fakeReq({ body: { noticeDate: '2026-07-01' } }), paramsFor('c1'));
  restore();
  check("deadlines POST: B's case -> 404", res.status === 404, `status ${res.status}`);
}

// --- /api/identity ---
await expect401('identity GET: unauthenticated -> 401', () => identityGet(fakeReq()));
{
  let seen: string | null = null;
  stub({ ...asA, readIdentityMasked: (async (uid: string) => { seen = uid; return {}; }) as any });
  const res = await identityGet(fakeReq({ url: `http://localhost/api/identity?userId=${B}` }));
  restore();
  check('identity GET: ?userId=B ignored, reads session user A', res.status === 200 && seen === A, `read ${seen}`);
}
await expect401('identity PUT: unauthenticated -> 401', () => identityPut(fakeReq({ body: { fields: {} } })));
{
  let seen: string | null = null;
  stub({
    ...asA,
    saveIdentity: (async (uid: string) => { seen = uid; }) as any,
    readIdentityMasked: (async () => ({})) as any,
  });
  const res = await identityPut(fakeReq({ body: { userId: B, fields: { full_name: 'X' } } }));
  restore();
  check('identity PUT: body userId=B ignored, writes session user A', res.status === 200 && seen === A, `wrote ${seen}`);
}

// --- /api/outcomes ---
await expect401('outcomes GET: unauthenticated -> 401', () => outcomesGet(fakeReq({ url: 'http://localhost/api/outcomes?caseId=c1' })));
{
  stub({ ...asA, canAccessCase: (async () => false) as any });
  const res = await outcomesGet(fakeReq({ url: 'http://localhost/api/outcomes?caseId=c1' }));
  restore();
  check("outcomes GET: B's case -> 404", res.status === 404, `status ${res.status}`);
}
await expect401('outcomes POST: unauthenticated -> 401', () => outcomesPost(fakeReq({ body: { caseId: 'c1' } })));
{
  stub({ ...asA, canAccessCase: (async () => false) as any });
  const res = await outcomesPost(fakeReq({ body: { caseId: 'c1', fields: {} } }));
  restore();
  check("outcomes POST record: B's case -> 404", res.status === 404, `status ${res.status}`);
}
{
  stub({ ...asA, getOutcomeCaseId: (async () => 'case-b') as any, canAccessCase: (async () => false) as any });
  const res = await outcomesPost(fakeReq({ body: { outcomeId: 'o1', patientConfirmed: true } }));
  restore();
  check("outcomes POST confirm: outcome on B's case -> 404", res.status === 404, `status ${res.status}`);
}
{
  let seen: any = null;
  stub({
    ...asA,
    getOutcomeCaseId: (async () => 'case-a') as any,
    canAccessCase: (async () => true) as any,
    confirmOutcome: (async (id: string, confirmed: boolean) => { seen = { id, confirmed }; return { id, patient_confirmed: confirmed }; }) as any,
  });
  const res = await outcomesPost(fakeReq({ body: { outcomeId: 'o1', patientConfirmed: true } }));
  restore();
  check('outcomes POST confirm: own case -> 200, confirms the right outcome', res.status === 200 && seen?.id === 'o1' && seen?.confirmed === true, `status ${res.status}`);
}

// --- /api/privacy ---
await expect401('privacy DELETE: unauthenticated -> 401', () => privacyDelete(fakeReq()));
{
  let seen: string | null = null;
  stub({ ...asA, deleteAllUserData: (async (uid: string) => { seen = uid; return { cases: 1 }; }) as any });
  const res = await privacyDelete(fakeReq({ url: `http://localhost/api/privacy?userId=${B}` }));
  restore();
  check('privacy DELETE: ?userId=B ignored, deletes session user A only', res.status === 200 && seen === A, `deleted ${seen}`);
}
await expect401('privacy PATCH: unauthenticated -> 401', () => privacyPatch(fakeReq({ body: { category: 'race' } })));
{
  let seen: any = null;
  stub({ ...asA, clearDemographicCategory: (async (uid: string, cat: string) => { seen = { uid, cat }; return { cleared: true }; }) as any });
  const res = await privacyPatch(fakeReq({ body: { userId: B, category: 'race' } }));
  restore();
  check('privacy PATCH: body userId=B ignored, clears for session user A', res.status === 200 && seen?.uid === A && seen?.cat === 'race', `cleared for ${seen?.uid}`);
}

// --- /api/managed-patients ---
await expect401('managed-patients GET: unauthenticated -> 401', () => managedGet(fakeReq()));
{
  let seen: string | null = null;
  stub({ ...asA, listManagedPatients: (async (uid: string) => { seen = uid; return []; }) as any });
  const res = await managedGet(fakeReq({ url: `http://localhost/api/managed-patients?caregiverUserId=${B}` }));
  restore();
  check('managed-patients GET: ?caregiverUserId=B ignored, lists for session user A', res.status === 200 && seen === A, `listed ${seen}`);
}
await expect401('managed-patients POST: unauthenticated -> 401', () => managedPost(fakeReq({ body: { patientName: 'Mom' } })));
{
  let seen: string | null = null;
  stub({ ...asA, createManagedPatient: (async (uid: string) => { seen = uid; return { id: 'mp-1' }; }) as any });
  const res = await managedPost(fakeReq({ body: { caregiverUserId: B, patientName: 'Mom' } }));
  restore();
  check('managed-patients POST: body caregiverUserId=B ignored, creates for session user A', res.status === 201 && seen === A, `created for ${seen}`);
}
await expect401('managed-patients PATCH: unauthenticated -> 401', () => managedPatch(fakeReq({ body: { managedPatientId: 'mp-1', extendedRetention: true } })));
// PATCH cross-user: already guarded before Step 0 (ownership subquery on
// caregiver_user_id -> notFound); exercising it needs a live DB, so it
// stays covered by the ownership check itself + the smoke suite.

// --- /api/chat (M01-AC2 audit fix 2026-10-05: session ownership gate) ---
await expect401('chat POST: unauthenticated -> 401', () => chatPost(fakeReq({ body: { message: 'x', sessionId: 's1' } })));
{
  stub({ ...asA, getOwnedChatSession: (async () => null) as any });
  const res = await chatPost(fakeReq({ body: { message: 'x', sessionId: 'session-b' } }));
  restore();
  check("chat POST: B's session id -> 404 (indistinguishable from missing)", res.status === 404, `status ${res.status}`);
}
{
  let seen: any = null;
  stub({
    ...asA,
    getOwnedChatSession: (async (uid: string, sid: string) => { seen = { uid, sid }; return { id: sid, user_id: uid, case_id: 'c1' }; }) as any,
    // Sentinel: proves the handler got PAST the ownership gate and reached
    // the next data-layer call. Never returns, so no model call can fire.
    getChatProfile: (async () => { throw new Error('sentinel: reached profile load'); }) as any,
  });
  let caught = '';
  try { await chatPost(fakeReq({ body: { message: 'x', sessionId: 's-own' } })); } catch (e) { caught = (e as Error).message; }
  restore();
  check('chat POST: owned session passes the gate (profile load reached as session user A)',
    seen?.uid === A && seen?.sid === 's-own' && caught === 'sentinel: reached profile load',
    `seen=${JSON.stringify(seen)} caught=${caught}`);
}

// --- /api/cases/[id]/documents ---
await expect401('documents POST: unauthenticated -> 401', () => documentsPost(fakeReq(), paramsFor('c1')));
{
  stub({ ...asA, canAccessCase: (async () => false) as any });
  const res = await documentsPost(fakeReq(), paramsFor('c1'));
  restore();
  check("documents POST: B's case -> 404", res.status === 404, `status ${res.status}`);
}
{
  stub({ ...asA, canAccessCase: (async () => true) as any });
  const res = await documentsPost(fakeReq({ formData: true }), paramsFor('c1'));
  restore();
  check('documents POST: own case passes the gate (400 = reached file validation)', res.status === 400, `status ${res.status}`);
}

// --- /api/corrections ---
await expect401('corrections POST: unauthenticated -> 401', () => correctionsPost(fakeReq({ body: { id: 'p1', action: 'dismiss' } })));
{
  stub({ ...asA, getPendingCorrection: (async () => null) as any });
  const res = await correctionsPost(fakeReq({ body: { id: 'missing', action: 'dismiss' } }));
  restore();
  check('corrections POST: unknown id -> 404', res.status === 404, `status ${res.status}`);
}
{
  stub({ ...asA, getPendingCorrection: (async () => ({ id: 'p1', user_id: B, status: 'pending' })) as any });
  const res = await correctionsPost(fakeReq({ body: { id: 'p1', action: 'dismiss' } }));
  restore();
  check("corrections POST: B's correction -> 404 (owner-only route)", res.status === 404, `status ${res.status}`);
}

// --- /api/preferences (self-scoped: every query keys on the session user) ---
await expect401('preferences GET: unauthenticated -> 401', () => preferencesGet(fakeReq()));
await expect401('preferences PUT: unauthenticated -> 401', () => preferencesPut(fakeReq({ body: { preferred_language: 'es' } })));

// --- /api/profile/insurance-type (self-scoped upsert by session user) ---
await expect401('insurance-type PUT: unauthenticated -> 401', () => insuranceTypePut(fakeReq({ body: { planType: 'medicare' } })));

// --- /api/cases/start ---
await expect401('cases/start POST: unauthenticated -> 401', () => casesStartPost(fakeReq({ body: { message: 'a bill' } })));
{
  let seen: string | null = null;
  stub({
    ...asA,
    // Sentinel stop before the chat_sessions insert: proves which user id
    // reached case creation without needing a database.
    createCase: (async (input: any) => { seen = input.userId; throw new Error('sentinel: stop before session insert'); }) as any,
  });
  const res = await casesStartPost(fakeReq({ body: { message: 'a bill', userId: B } }));
  restore();
  check('cases/start POST: body userId=B ignored, creates as session user A', seen === A && res.status === 500, `seen=${seen} status=${res.status}`);
}

// --- Explicit exemptions (the only two routes allowed to answer without a session) ---
{
  const res = await healthGet(fakeReq());
  check('health GET: unauthenticated by design (200 or 503, never 401)', res.status === 200 || res.status === 503, `status ${res.status}`);
}
{
  const res = await purgePost(fakeReq());
  check('purge job POST: service-key bearer only, no header -> 401', res.status === 401, `status ${res.status}`);
}
}

main()
  .then(() => {
    console.log(failures === 0 ? '\nAUTH GUARDS: ALL PASS' : `\nAUTH GUARDS: ${failures} FAILURE(S)`);
    process.exit(failures === 0 ? 0 : 1);
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
