'use client';

import { useState } from 'react';

// Demo bar (FIRST_RUN_AND_BRAND.md Part 2): one thin coral-red ticker at
// the very top. Tap or hover pauses it; with reduced motion it is static,
// wrapping text. Screen readers get the sentence once, not the loop.
export const DEMO_NOTICE =
  // Owner wording 2026-10-15, switched in DEMO_DAY stage 1 when the sample
  // reset became real (sessionStorage id + 60-minute idle purge, db/028).
  'Demo, sample data only. Sample patients reset when you close the tab.';

export function DemoTicker() {
  const [paused, setPaused] = useState(false);
  return (
    <div
      role="note"
      aria-label={DEMO_NOTICE}
      className={paused ? 'demo-ticker paused' : 'demo-ticker'}
      onClick={() => setPaused((p) => !p)}
    >
      <div className="demo-ticker-track" aria-hidden="true">
        <span>{DEMO_NOTICE}</span>
        <span>{DEMO_NOTICE}</span>
      </div>
      <span className="demo-ticker-static" aria-hidden="true">
        {DEMO_NOTICE}
      </span>
    </div>
  );
}
