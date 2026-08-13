import './globals.css';

export const metadata = {
  title: 'Arik',
  description: 'Patient-side healthcare cost advocate',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div
          role="note"
          style={{ background: '#fff3cd', padding: '0.5rem 1rem', fontSize: '0.9rem', textAlign: 'center' }}
        >
          Demo build — anything you enter here may be deleted at any time without warning. Don&apos;t
          rely on coming back to a saved case or saved results.
        </div>
        {children}
      </body>
    </html>
  );
}
