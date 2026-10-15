import Link from 'next/link';

// Friendly "not here" screen instead of the framework default.
export default function NotFound() {
  return (
    <main className="hiccup">
      <h1>That page isn&apos;t here.</h1>
      <p>It may have reset, or the link is old.</p>
      <div className="actions">
        <Link href="/" className="pill-link">
          Go to the home screen
        </Link>
      </div>
    </main>
  );
}
