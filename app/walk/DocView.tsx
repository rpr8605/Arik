'use client';

import type { Highlight } from '@/lib/walkthrough/script';

// A sample document with numbered highlight boxes (percent coordinates so
// they scale). Coral = looks wrong, amber = worth asking about. Tapping a
// box scrolls to its finding; a finding pulses its box (Player.tsx).
export function DocView({
  src,
  title,
  highlights,
  onBox,
  pulse,
}: {
  src: string;
  title: string;
  highlights: Highlight[];
  onBox: (n: number) => void;
  pulse: number | null;
}) {
  return (
    <figure className="docview">
      <div className="docview-inner">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt={title} />
        {highlights.map((h) => (
          <button
            key={h.n}
            type="button"
            data-box={h.n}
            className={`hl hl-${h.tone}${pulse === h.n ? ' pulse' : ''}`}
            style={{ left: `${h.x}%`, top: `${h.y}%`, width: `${h.w}%`, height: `${h.h}%` }}
            aria-label={`Finding ${h.n}`}
            onClick={() => onBox(h.n)}
          >
            <span className="hl-badge">{h.n}</span>
          </button>
        ))}
      </div>
      <figcaption>
        <span className="tag tag-sample">Sample case</span> {title}. Pinch to zoom.
      </figcaption>
    </figure>
  );
}
