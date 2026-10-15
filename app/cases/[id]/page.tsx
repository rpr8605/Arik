import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { getCase } from '@/lib/cases';
import { hasConfirmedOutcome, shouldPromptOutcomeConfirmation } from '@/lib/outcomes';
import { Thread } from './Thread';
import { DocumentUpload } from './DocumentUpload';
import { OutcomePrompt } from './OutcomePrompt';

export default async function CasePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ first?: string }>;
}) {
  const { id } = await params;
  const { first } = await searchParams;

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

  const kase = await getCase(id);
  if (!kase) return <main><p>Case not found.</p></main>;

  // Outcome-confirmation prompt: exactly when terminal + nothing
  // patient-confirmed yet (pure decision in lib/outcomes.ts).
  const showOutcomePrompt = shouldPromptOutcomeConfirmation(
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
      <h1>{kase.case_type.replaceAll('_', ' ')}</h1>
      <p>
        Status: <strong>{kase.status.replaceAll('_', ' ')}</strong>
        {kase.next_action ? `. Next: ${kase.next_action}` : ''}
      </p>
      {kase.institution_name ? <p>{kase.institution_name}</p> : null}
      {kase.resolved_at ? (
        <p>
          Resolved. Case data auto-deletes on{' '}
          {new Date(new Date(kase.resolved_at).getTime() + 90 * 24 * 3600_000).toLocaleDateString()}{' '}
          (a summary of the outcome is kept).
        </p>
      ) : null}
      {showOutcomePrompt ? <OutcomePrompt caseId={id} /> : null}
      <DocumentUpload caseId={id} />
      {session ? (
        <Thread
          sessionId={session.id}
          initialMessages={(messages ?? []) as { role: string; content: string }[]}
          firstMessage={first ?? null}
        />
      ) : (
        <p>No conversation thread exists for this case yet.</p>
      )}
    </main>
  );
}
