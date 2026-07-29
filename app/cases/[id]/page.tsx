import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { getCase } from '@/lib/cases';
import { Thread } from './Thread';
import { DocumentUpload } from './DocumentUpload';

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
        {kase.next_action ? ` — next: ${kase.next_action}` : ''}
      </p>
      {kase.institution_name ? <p>{kase.institution_name}</p> : null}
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
