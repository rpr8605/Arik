'use client';

import { useEffect, useState } from 'react';
import { supabaseBrowser } from '@/lib/supabaseBrowser';

// First-class language choice (UNIVERSAL_ACCESS.md): visible at the very
// start on the home screen, changeable any time, never a settings-menu
// hunt. Arik's side of the whole conversation is generated in this
// language directly, not translated after the fact.
//
// Launch scope: English and Spanish only (non-English extraction quality
// is unvalidated - a launch-scope decision, not a technical one).
export function LanguagePreference() {
  const [lang, setLang] = useState<'en' | 'es' | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      // A dropped or cancelled request (flaky phone connection, navigating
      // away mid-load) leaves the default language showing instead of
      // throwing an unhandled error.
      try {
        const {
          data: { session },
        } = await supabaseBrowser().auth.getSession();
        const res = await fetch('/api/preferences', {
          headers: { Authorization: `Bearer ${session?.access_token ?? ''}` },
        });
        if (res.ok) {
          const json = await res.json();
          setLang(json.preferred_language === 'es' ? 'es' : 'en');
        }
      } catch {
        // keep the default
      }
    })();
  }, []);

  async function choose(next: 'en' | 'es') {
    setError(null);
    try {
      const {
        data: { session },
      } = await supabaseBrowser().auth.getSession();
      const res = await fetch('/api/preferences', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session?.access_token ?? ''}` },
        body: JSON.stringify({ preferred_language: next }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? `request failed (${res.status})`);
      setLang(next);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <section aria-label="Language / Idioma" style={{ marginBottom: '1rem' }}>
      <span>Language / Idioma: </span>
      <button type="button" aria-pressed={lang === 'en'} disabled={lang === 'en'} onClick={() => choose('en')}>
        English
      </button>{' '}
      <button type="button" aria-pressed={lang === 'es'} disabled={lang === 'es'} onClick={() => choose('es')}>
        Español
      </button>
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
