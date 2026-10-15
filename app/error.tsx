'use client';

// Friendly error screen (share-ready demo): never a raw error. "Tap to try
// again" re-renders the page; the home link is the way out.
export default function ErrorScreen({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="hiccup">
      <h1>Something hiccuped.</h1>
      <p>It&apos;s not you. Tap to try again.</p>
      <div className="actions">
        <button type="submit" onClick={() => reset()}>
          Tap to try again
        </button>
        <a href="/" className="pill-link">
          Go to the home screen
        </a>
      </div>
    </main>
  );
}
