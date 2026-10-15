'use client';

// Last-resort error screen when the root layout itself fails. Plain inline
// styles: globals.css may not have loaded.
export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: 'system-ui, sans-serif', background: '#fafbfc', color: '#22425c' }}>
        <main style={{ maxWidth: 420, margin: '20vh auto', padding: '0 16px', textAlign: 'center' }}>
          <h1 style={{ fontSize: 26 }}>Something hiccuped.</h1>
          <p>It&apos;s not you. Tap to try again.</p>
          <button
            type="button"
            onClick={() => reset()}
            style={{ minHeight: 48, padding: '0 24px', borderRadius: 14, border: 'none', background: '#0b7a74', color: '#fff', fontSize: 17, fontWeight: 600 }}
          >
            Tap to try again
          </button>
        </main>
      </body>
    </html>
  );
}
