// Draft a letter from a confirmed bill (Phase 4) or a confirmed denial
// (Phase 5). Every fact is written by code (lib/letters/templates.ts,
// lib/letters/denialTemplates.ts); a model tone sentence only on bill
// letters when LETTER_MODEL_SENTENCE=true, which then counts against the
// rate limits. Nothing is sent: the letter is a draft until the patient
// freezes it.

import { NextRequest, NextResponse } from 'next/server';
import { apiDeps, forbidden, notFound, requireUser, unauthorized } from '@/lib/apiAuth';
import { rateLimitResponse } from '@/lib/rateLimit';
import { letterModelSentence } from '@/lib/production/billReview';
import { BILL_LETTER_TYPES } from '@/lib/letters/templates';
import { DENIAL_LETTER_TYPES, type DenialLetterType } from '@/lib/rules/denials/types';
import type { ConfirmedBill, LetterType } from '@/lib/production/types';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = await requireUser(req);
  if (!userId) return unauthorized();
  if (apiDeps.isDemoMode()) return forbidden('the demo uses sample letters only');
  const { id: caseId } = await params;
  if (!(await apiDeps.canAccessCase(userId, caseId))) return notFound();
  const body = (await req.json().catch(() => null)) as { documentId?: unknown; type?: unknown; phone?: unknown; name?: unknown } | null;
  const isBill = BILL_LETTER_TYPES.includes(body?.type as LetterType);
  const isDenial = DENIAL_LETTER_TYPES.includes(body?.type as DenialLetterType);
  if (!body || typeof body.documentId !== 'string' || (!isBill && !isDenial)) {
    return NextResponse.json({ error: `documentId and type (${[...BILL_LETTER_TYPES, ...DENIAL_LETTER_TYPES].join(', ')}) are required` }, { status: 400 });
  }
  const phone = typeof body.phone === 'string' && /^[0-9()+\-. ]{7,20}$/.test(body.phone) ? body.phone.trim() : null;
  const doc = await apiDeps.getCaseDocument(caseId, body.documentId);
  if (!doc) return notFound();
  if (isDenial) {
    // A denial letter carries no patient name Arik read, so the patient
    // types it (letters go out in their name).
    const name = typeof body.name === 'string' && /^[\p{L}\p{M}' .-]{2,80}$/u.test(body.name.trim()) ? body.name.trim() : null;
    if (!name) return NextResponse.json({ error: 'your name, as it should appear on the letter, is required' }, { status: 400 });
    const out = await apiDeps.createDenialLetter(userId, caseId, body.documentId, body.type as DenialLetterType, { name, phone });
    if ('error' in out) return NextResponse.json({ error: out.error }, { status: 409 });
    return NextResponse.json({ letter: out }, { status: 201 });
  }
  if (letterModelSentence()) {
    const limit = await apiDeps.consumeRateLimit('documents', userId, req);
    if (!limit.allowed) return rateLimitResponse(limit, req);
  }
  const name = (doc.confirmed_data as ConfirmedBill | null)?.header.patientName ?? 'The patient';
  const out = await apiDeps.createLetter(userId, caseId, body.documentId, body.type as LetterType, { name, phone });
  if ('error' in out) return NextResponse.json({ error: out.error }, { status: 409 });
  return NextResponse.json({ letter: out }, { status: 201 });
}
