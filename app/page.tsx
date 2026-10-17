import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { listCases } from '@/lib/cases';
import { NewCaseForm } from './NewCaseForm';
import { INTRO } from '@/lib/persona/arik';
import { isDemoMode } from '@/lib/demo/samples';
import { loadCaseCards } from '@/lib/caseCards';

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
  const cards = await loadCaseCards(cases);
  const { data: profile } = await supabaseAdmin()
    .from('user_matching_profile')
    .select('insurance_type, explanation_style')
    .eq('id', user.id)
    .maybeSingle();

  return (
    <main className="home">
      <h1 className="sr-only">Arik Health</h1>
      <NewCaseForm currentPlanType={profile?.insurance_type ?? null} intro={INTRO.en.full} demoMode={isDemoMode()}>
        {cases.length > 0 && (
          <>
            <h2>What you're working on</h2>
            {!isDemoMode() && (
              <p>
                <Link href="/home">Your home: what needs you, what you saved, your documents</Link>
              </p>
            )}
            <ul className="case-list">
              {cases.map((c) => (
                <li key={c.id}>
                  <Link href={`/cases/${c.id}`} className={cards[c.id]?.needsYou ? 'needs-you' : undefined}>
                    <strong>{cards[c.id]?.title}</strong>
                    <span>{cards[c.id]?.happening}</span>
                    <span className="case-tap">{cards[c.id]?.tap}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </>
        )}
      </NewCaseForm>
    </main>
  );
}
