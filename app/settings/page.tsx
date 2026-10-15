import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { PlanTypeSelector } from '../PlanTypeSelector';
import { ExplanationPreference } from '../ExplanationPreference';

// Settings, behind the gear in the header (owner request 2026-10-15): the
// coverage type and "How Arik talks to me" (explanation style plus what
// Arik was asked to remember). Moved off the home screen.
export default async function SettingsPage() {
  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    { cookies: { getAll: () => cookieStore.getAll(), setAll: () => {} } },
  );
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: profile } = await supabaseAdmin()
    .from('user_matching_profile')
    .select('insurance_type, explanation_style')
    .eq('id', user.id)
    .maybeSingle();

  return (
    <main>
      <h1>Settings</h1>
      <PlanTypeSelector current={profile?.insurance_type ?? null} />
      <ExplanationPreference current={profile?.explanation_style ?? null} />
      <div className="actions">
        <Link href="/" className="pill-link">
          Back to home
        </Link>
      </div>
    </main>
  );
}
