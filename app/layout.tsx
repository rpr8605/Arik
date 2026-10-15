import './globals.css';
import type { Viewport } from 'next';
import { Outfit, Source_Sans_3 } from 'next/font/google';

// Brand fonts (2026-08-13 ticket): Outfit for headings, Source Sans 3
// for body. Self-hosted via next/font — no third-party font requests at
// runtime.
const outfit = Outfit({ subsets: ['latin'], variable: '--font-outfit' });
const sourceSans = Source_Sans_3({ subsets: ['latin'], variable: '--font-source-sans' });

export const metadata = {
  title: 'Arik',
  description: 'Patient-side healthcare cost advocate',
};

// Mobile-ready pass (2026-10-14): draw under the notch and home bar
// (globals.css pads with env(safe-area-inset-*)), and let Android Chrome
// shrink the page when the keyboard opens so the chat box stays visible.
// Pinch-zoom is left on (no maximumScale) for accessibility.
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  interactiveWidget: 'resizes-content',
  themeColor: '#eaf6fb',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${outfit.variable} ${sourceSans.variable}`}>
      <body>
        {/* Fixed glow blobs over the viewport gradient (both stay put
            during scroll); content sits above them via .app-shell. */}
        <div className="glow glow-sky" aria-hidden="true" />
        <div className="glow glow-emerald" aria-hidden="true" />
        {/* Phone frame (2026-10-14 demo ticket): from 600px wide the whole
            app, banner included, renders inside a centered phone-shaped
            frame and scrolls inside it (globals.css .device). On phones
            both wrappers are plain blocks and the app is full screen. */}
        <div className="device app-shell">
          <div className="device-screen">
            <div
              role="note"
              style={{ background: '#fff3cd', padding: '0.5rem 1rem', fontSize: '0.9rem', textAlign: 'center' }}
            >
              Demo build — you&apos;re on a temporary session (no sign-up needed), and anything you
              enter here may be deleted at any time without warning. Don&apos;t rely on coming back to a
              saved case or saved results.
            </div>
            {children}
          </div>
        </div>
      </body>
    </html>
  );
}
