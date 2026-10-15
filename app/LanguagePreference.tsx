'use client';

import { useEffect, useState } from 'react';
import { supabaseBrowser } from '@/lib/supabaseBrowser';

// Language choice (UNIVERSAL_ACCESS.md): always visible, changeable any
// time, never a settings-menu hunt. Since FIRST_RUN_AND_BRAND.md it is a
// small "EN | ES" pill in the header; English is the default. A change
// still goes through /api/preferences, which writes the consent ledger.
//
// Launch scope: English and Spanish only (non-English extraction quality
// is unvalidated, a launch-scope decision, not a technical one).
export function LanguagePreference() {
  const [lang, setLang] = useState<'en' | 'es'>('en');
  const [error, setError] = useState(false);

  useEffect(() => {
    (async () => {
      // A dropped or cancelled request (flaky phone connection, navigating
      // away mid-load) leaves the default language showing instead of
      // throwing an unhandled error.
      try {
        const {
          data: { session },
        } = await supabaseBrowser().auth.getSession();
        if (!session) return;
        const res = await fetch('/api/preferences', {
          headers: { Authorization: `Bearer ${session.access_token}` },
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
    if (next === lang) return;
    setError(false);
    try {
      const {
        data: { session },
      } = await supabaseBrowser().auth.getSession();
      const res = await fetch('/api/preferences', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session?.access_token ?? ''}`,
        },
        body: JSON.stringify({ preferred_language: next }),
      });
      if (!res.ok) throw new Error(`request failed (${res.status})`);
      setLang(next);
    } catch {
      setError(true);
    }
  }

  return (
    <div className="lang-pill" role="group" aria-label="Language / Idioma">
      <button type="button" lang="en" aria-label="English" aria-pressed={lang === 'en'} onClick={() => choose('en')}>
        EN
      </button>
      <span aria-hidden="true">|</span>
      <button type="button" lang="es" aria-label="Español" aria-pressed={lang === 'es'} onClick={() => choose('es')}>
        ES
      </button>
      {error && (
        <span role="alert" className="sr-only">
          Couldn&apos;t change the language. Try again.
        </span>
      )}
    </div>
  );
}
