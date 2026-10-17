import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { canAccessCase, getCase } from '@/lib/cases';
import { isDemoMode, sampleByKey } from '@/lib/demo/samples';
import { touchSampleCase } from '@/lib/demo/sampleCases';
import { SamplePanel } from './SamplePanel';
import { loadCaseCards } from '@/lib/caseCards';
import { hasConfirmedOutcome, shouldPromptOutcomeConfirmation } from '@/lib/outcomes';
import { Thread } from './Thread';
import { OutcomePrompt } from './OutcomePrompt';
import { Tracker } from './Tracker';

export default async function CasePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ first?: string; from?: string }>;
}) {
  const { id } = await params;
  const { first, from } = await searchParams;

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

  // Same rule as the API (Step 0): a stranger's case and a missing case
  // look identical. The page used to render any case by id.
  const kase = (await canAccessCase(user.id, id)) ? await getCase(id) : null;
  if (!kase) return <main><p>Case not found.</p></main>;

  // Demo sample patient (DEMO_DAY stage 1, db/028): the fictional person's
  // card and past jobs, no uploads and no outcome prompt (samples never
  // count). With DEMO_MODE off a sample case is treated as missing.
  const isSample = (kase as { is_sample?: boolean }).is_sample === true;
  const sample = isSample ? sampleByKey((kase as { sample_key?: string }).sample_key) : null;
  if (isSample && (!sample || !isDemoMode())) return <main><p>Case not found.</p></main>;
  if (isSample) await touchSampleCase(id);

  // Outcome-confirmation prompt: exactly when terminal + nothing
  // patient-confirmed yet (pure decision in lib/outcomes.ts).
  const card = (await loadCaseCards([kase]))[id];
  const showOutcomePrompt = !isSample && shouldPromptOutcomeConfirmation(
    kase.status,
    await hasConfirmedOutcome(id),
  );

  const { data: session } = await supabaseAdmin()
    .from('chat_sessions')
    .select('id')
    .eq('case_id', id)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  const { data: messages } = session
    ? await supabaseAdmin()
        .from('chat_messages')
        .select('role, content, created_at')
        .eq('session_id', session.id)
        .order('created_at', { ascending: true })
    : { data: [] };

  return (
    <main>
      {sample ? <SamplePanel sample={sample} /> : null}
      <h1 className={sample ? 'case-type-sub' : undefined}>{card.title}</h1>
      <p>{card.happening}</p>
      {kase.institution_name ? <p>{kase.institution_name}</p> : null}
      {kase.resolved_at ? (
        <p>
          This is finished. Arik deletes the details on{' '}
          {new Date(new Date(kase.resolved_at).getTime() + 90 * 24 * 3600_000).toLocaleDateString()} and keeps
          only a short summary of how it turned out.
        </p>
      ) : null}
      {showOutcomePrompt ? <OutcomePrompt caseId={id} /> : null}
      {!sample && !isDemoMode() ? <Tracker caseId={id} /> : null}
      {session ? (
        <Thread
          sessionId={session.id}
          initialMessages={(messages ?? []) as { role: string; content: string }[]}
          firstMessage={first ?? null}
          introShown={from === 'welcome'}
          suggestedFirst={sample?.starterMessage ?? null}
          caseId={id}
          demoMode={isDemoMode()}
        />
      ) : (
        <p>No conversation thread exists for this case yet.</p>
      )}
    </main>
  );
}
