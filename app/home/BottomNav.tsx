'use client';

// Bottom navigation for the patient home (Phase 7 P1): Home, Jobs, Arik
// (the chat front door), Docs, Me. Words plus position, 56px tall, safe
// area padding. Only on the real-path home screens; the demo keeps its own.

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const TABS = [
  { href: '/home', label: 'Home' },
  { href: '/jobs', label: 'Jobs' },
  { href: '/', label: 'Arik' },
  { href: '/docs', label: 'Docs' },
  { href: '/settings', label: 'Me' },
];

export function BottomNav() {
  const path = usePathname();
  return (
    <nav aria-label="Main" style={{ position: 'fixed', left: 0, right: 0, bottom: 0, display: 'flex', justifyContent: 'space-around', background: '#fff', borderTop: '1px solid #dde4ea', paddingBottom: 'env(safe-area-inset-bottom)', zIndex: 20 }}>
      {TABS.map((t) => {
        const on = t.href === '/' ? path === '/' : path.startsWith(t.href);
        return (
          <Link key={t.href} href={t.href} aria-current={on ? 'page' : undefined} style={{ flex: 1, minHeight: 56, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: on ? 700 : 500, color: on ? '#109890' : '#325773', textDecoration: 'none' }}>
            {t.label === 'Arik' ? <span style={{ padding: '6px 14px', borderRadius: 20, background: '#325773', color: '#fff' }}>Arik</span> : t.label}
          </Link>
        );
      })}
    </nav>
  );
}
