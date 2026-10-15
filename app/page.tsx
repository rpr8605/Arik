import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { listCases } from '@/lib/cases';
import { NewCaseForm } from './NewCaseForm';
import { INTRO } from '@/lib/persona/arik';
import { PlanTypeSelector } from './PlanTypeSelector';
import { ExplanationPreference } from './ExplanationPreference';

// Home = the welcome screen (FIRST_RUN_AND_BRAND.md): Arik's greeting,
// starters and the chat box; cases and settings below. Not a profile wall
// (UI_UX.md, CRISIS_AWARE_DESIGN.md).
export default async function Home() {
  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: () => {},
      },
    },
  );
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const cases = await listCases(user.id);
  const { data: profile } = await supabaseAdmin()
    .from('user_matching_profile')
    .select('insurance_type, explanation_style')
    .eq('id', user.id)
    .maybeSingle();

  return (
    <main className="home">
      <h1 className="sr-only">Arik Health</h1>
      <NewCaseForm currentPlanType={profile?.insurance_type ?? null} intro={INTRO.en.full}>
        {cases.length > 0 && (
          <>
            <h2>Your cases</h2>
            <ul className="case-list">
              {cases.map((c) => (
                <li key={c.id}>
                  <Link href={`/cases/${c.id}`}>
                    <strong>{c.case_type.replaceAll('_', ' ')}</strong>
                    <span>
                      {c.status.replaceAll('_', ' ')}
                      {c.next_action ? `. Next: ${c.next_action}` : ''}
                      {c.next_action_due ? ` (due ${c.next_action_due})` : ''}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </>
        )}
        <details className="settings">
          <summary>Your settings</summary>
          <PlanTypeSelector current={profile?.insurance_type ?? null} />
          <ExplanationPreference current={profile?.explanation_style ?? null} />
        </details>
      </NewCaseForm>
    </main>
  );
}
