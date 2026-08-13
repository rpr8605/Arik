// Language preference (UNIVERSAL_ACCESS.md): a first-class choice, set at
// the start and changeable any time - never locked in once chosen. Every
// change is written to the consent ledger (category 'language').
//
// Launch scope: English and Spanish ONLY. UNIVERSAL_ACCESS.md itself
// cautions that non-English extraction quality is unvalidated - this is a
// launch-scope decision, not a technical limitation, so unsupported codes
// are rejected with an explicit 400 rather than silently accepted.

import { NextRequest, NextResponse } from 'next/server';
import { getUserId } from '@/lib/session';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { recordConsent } from '@/lib/consent';

const SUPPORTED_LANGUAGES = ['en', 'es'] as const;
type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];
const EXPLANATION_STYLES = ['standard', 'simple'] as const;

export async function GET(req: NextRequest) {
  const userId = await getUserId(req);
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { data: profile } = await supabaseAdmin()
    .from('user_matching_profile')
    .select('preferred_language, explanation_style')
    .eq('id', userId)
    .maybeSingle();
  return NextResponse.json({
    preferred_language: profile?.preferred_language ?? 'en',
    explanation_style: profile?.explanation_style ?? 'standard',
  });
}

export async function PUT(req: NextRequest) {
  const userId = await getUserId(req);
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const body = await req.json();
  const sb = supabaseAdmin();

  // Explanation-style toggle (explicit choice only; 'standard' default,
  // 'simple' never inferred). Ledgered like language changes.
  if (body.explanation_style !== undefined) {
    if (!EXPLANATION_STYLES.includes(body.explanation_style)) {
      return NextResponse.json(
        { error: `explanation_style must be one of: ${EXPLANATION_STYLES.join(' | ')}` },
        { status: 400 },
      );
    }
    const { error } = await sb
      .from('user_matching_profile')
      .upsert({
        id: userId,
        explanation_style: body.explanation_style,
        updated_at: new Date().toISOString(),
      });
    if (error) throw error;
    await recordConsent(sb, userId, 'explanation_style', 'set', { explanation_style: body.explanation_style });
    return NextResponse.json({ explanation_style: body.explanation_style });
  }

  const lang = body.preferred_language;
  if (!SUPPORTED_LANGUAGES.includes(lang)) {
    return NextResponse.json(
      {
        error:
          `unsupported language: ${JSON.stringify(lang)}. Arik launches in English and ` +
          'Spanish only - a launch-scope decision (extraction quality in other languages ' +
          'is not yet validated), not a technical limit.',
      },
      { status: 400 },
    );
  }

  const { error } = await sb
    .from('user_matching_profile')
    .upsert({
      id: userId,
      preferred_language: lang as SupportedLanguage,
      updated_at: new Date().toISOString(),
    });
  if (error) throw error;

  await recordConsent(sb, userId, 'language', 'set', { language: lang });

  return NextResponse.json({ preferred_language: lang });
}
