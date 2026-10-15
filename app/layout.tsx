import './globals.css';
import type { Viewport } from 'next';
import Link from 'next/link';
import { Outfit, Source_Sans_3 } from 'next/font/google';
import { DemoTicker } from './DemoTicker';
import { LanguagePreference } from './LanguagePreference';

// Brand fonts (2026-08-13 ticket): Outfit for headings, Source Sans 3
// for body. Self-hosted via next/font, so no third-party font requests at
// runtime.
const outfit = Outfit({ subsets: ['latin'], variable: '--font-outfit' });
const sourceSans = Source_Sans_3({ subsets: ['latin'], variable: '--font-source-sans' });

export const metadata = {
  title: 'Arik Health',
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
  themeColor: '#b3362f',
};

// Splash (FIRST_RUN_AND_BRAND.md Part 2): once per browser session, never
// with reduced motion. This runs before first paint, so a later page load
// in the same session never flashes the splash. The layout persists across
// client-side navigation, so it can't replay on page changes either.
const SPLASH_GATE = `try{var d=document.documentElement;if(sessionStorage.getItem('arik-splash')||matchMedia('(prefers-reduced-motion: reduce)').matches){d.setAttribute('data-splash','off')}else{sessionStorage.setItem('arik-splash','1')}}catch(e){document.documentElement.setAttribute('data-splash','off')}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${outfit.variable} ${sourceSans.variable}`} suppressHydrationWarning>
      <body>
        <script dangerouslySetInnerHTML={{ __html: SPLASH_GATE }} />
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
            <div className="splash" aria-hidden="true">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/brand/arik-logo-h300.webp" alt="" width={235} height={100} />
            </div>
            <DemoTicker />
            <header className="app-header">
              <Link href="/" className="app-logo" aria-label="Arik Health, home">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/brand/arik-logo-h84.webp" alt="Arik Health" width={66} height={28} />
              </Link>
              <div className="header-tools">
                <LanguagePreference />
                <Link href="/settings" className="gear" aria-label="Settings">
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <circle cx="12" cy="12" r="3" />
                    <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
                  </svg>
                </Link>
              </div>
            </header>
            {children}
          </div>
        </div>
      </body>
    </html>
  );
}
