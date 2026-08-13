import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { listCases } from '@/lib/cases';
import { NewCaseForm } from './NewCaseForm';
import { LanguagePreference } from './LanguagePreference';
import { PlanTypeSelector } from './PlanTypeSelector';
import { ExplanationPreference } from './ExplanationPreference';

// Home = case list, not a profile wall (UI_UX.md, CRISIS_AWARE_DESIGN.md).
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
    <main>
      <LanguagePreference />
      <PlanTypeSelector current={profile?.insurance_type ?? null} />
      <ExplanationPreference current={profile?.explanation_style ?? null} />
      <h1>What&apos;s going on?</h1>
      <NewCaseForm />

      <h2>Your cases</h2>
      {cases.length === 0 ? (
        <p>No cases yet. Tell me what happened above and I&apos;ll take it from there.</p>
      ) : (
        <ul>
          {cases.map((c) => (
            <li key={c.id}>
              <Link href={`/cases/${c.id}`}>
                <strong>{c.case_type.replaceAll('_', ' ')}</strong> — {c.status.replaceAll('_', ' ')}
                {c.next_action ? ` — next: ${c.next_action}` : ''}
                {c.next_action_due ? ` (due ${c.next_action_due})` : ''}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
