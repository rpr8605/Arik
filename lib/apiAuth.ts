// The API auth boundary (Step 0, 2026-10-01, audit follow-up).
//
// Every guarded route resolves the caller and touches data ONLY through
// this registry. Two reasons:
//
// 1. The service-role client (lib/supabaseAdmin) BYPASSES RLS, so every
//    route must enforce session + ownership in code. Centralizing the
//    call sites makes that reviewable in one place.
// 2. It is the single, documented test seam: scripts/test_auth_guards.ts
//    rebinds these functions with fakes to prove each route answers 401
//    unauthenticated and 404/403 cross-user, without needing a running
//    server or auth provider. App code must NEVER reassign these
//    properties; rebinding outside the auth-guard test is a bug.
//
// Default implementations are the real lib functions, so production
// behavior is unchanged - the registry is indirection, not new logic.

import { getUserId } from './session';
import {
  canAccessCase,
  createCase,
  getCase,
  listCases,
  transitionCase,
} from './cases';
import { computeAndStoreDeadline, listDeadlines } from './deadlines';
import { readIdentityMasked, saveIdentity } from './identityCrypto';
import {
  confirmOutcome,
  getOutcomeCaseId,
  hasConfirmedOutcome,
  listOutcomes,
  recordOutcome,
} from './outcomes';
import { clearDemographicCategory, deleteAllUserData } from './privacy';
import {
  createManagedPatient,
  listManagedPatients,
  ownsManagedPatient,
} from './caregivers';
import { getCaseManagedPatient, getChatProfile, getOwnedChatSession, userHasEarlierConversation } from './chatSession';
import { deleteStylePrefs, getStylePrefs, saveStylePrefs } from './stylePrefs';
import { getPendingCorrection } from './extractedFacts';
import { supabaseAdmin } from './supabaseAdmin';
import { consumeRateLimit } from './rateLimit';
import { getCaseSample, listSampleCases, openSampleCase, resetSampleSession, touchSampleCase } from './demo/sampleCases';
import { isDemoMode } from './demo/samples';
import { loadRxOptions } from './demo/rxOptions';
import { confirmAndReview, createLetter, editLetter, freezeLetter, getCaseDocument, getLetter } from './production/billReview';

export const apiDeps = {
  getUserId,
  canAccessCase,
  listCases,
  createCase,
  getCase,
  transitionCase,
  listDeadlines,
  computeAndStoreDeadline,
  readIdentityMasked,
  saveIdentity,
  listOutcomes,
  recordOutcome,
  confirmOutcome,
  getOutcomeCaseId,
  hasConfirmedOutcome,
  deleteAllUserData,
  clearDemographicCategory,
  listManagedPatients,
  createManagedPatient,
  ownsManagedPatient,
  getOwnedChatSession,
  getChatProfile,
  getCaseManagedPatient,
  userHasEarlierConversation,
  // Saved style preferences (persona, db/027).
  getStylePrefs,
  saveStylePrefs,
  deleteStylePrefs,
  // The corrections route's single-row read; the service client is passed
  // by the default wrapper so tests stub one plain function.
  getPendingCorrection: (id: string) => getPendingCorrection(supabaseAdmin(), id),
  // Rate limits + demo model budget (lib/rateLimit.ts, db/026). Called
  // right after requireUser on chat, documents and cases/start.
  consumeRateLimit,
  // Demo sample patients (DEMO_DAY stage 1, db/028). isDemoMode reads
  // DEMO_MODE; it is in the registry so tests can switch it.
  isDemoMode: () => isDemoMode(),
  getCaseSample,
  touchSampleCase,
  listSampleCases,
  openSampleCase,
  resetSampleSession,
  // Demo walkthrough Flow 1: real prices for a sample patient (read-only).
  loadRxOptions,
  // The real bill path (Phases 2 to 4, lib/production/billReview.ts):
  // case-scoped reads and writes, called after canAccessCase.
  getCaseDocument,
  confirmAndReview,
  createLetter,
  getLetter,
  editLetter,
  freezeLetter,
};

export function unauthorized() {
  return Response.json({ error: 'unauthorized' }, { status: 401 });
}

// Cross-user access and genuinely-missing rows get the SAME 404: a
// stranger must not be able to tell "exists but not yours" from "does
// not exist".
export function notFound() {
  return Response.json({ error: 'not found' }, { status: 404 });
}

export function forbidden(message = 'forbidden') {
  return Response.json({ error: message }, { status: 403 });
}

// Resolves the session user via the registry. Null means unauthenticated
// and the caller answers 401 - no route derives a user id from request
// parameters anymore.
export async function requireUser(req: Request): Promise<string | null> {
  return apiDeps.getUserId(req);
}
