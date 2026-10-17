'use client';

// A finger signature pad (Phase 6). Returns the drawing as a PNG data URL;
// the server checks it has real strokes before accepting it.

import { useEffect, useRef, useState } from 'react';

export function SignaturePad({ label, onChange }: { label: string; onChange: (dataUrl: string | null) => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const [inked, setInked] = useState(false);

  useEffect(() => {
    const c = canvas.current;
    const ctx = c?.getContext('2d');
    if (!c || !ctx) return;
    const ratio = window.devicePixelRatio || 1;
    c.width = c.clientWidth * ratio;
    c.height = c.clientHeight * ratio;
    ctx.scale(ratio, ratio);
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#22425c';
  }, []);

  const point = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const clear = () => {
    const c = canvas.current!;
    c.getContext('2d')!.clearRect(0, 0, c.width, c.height);
    setInked(false);
    onChange(null);
  };

  return (
    <div className="sign">
      <p>{label}</p>
      <canvas
        ref={canvas}
        className="sign-pad"
        style={{ width: '100%', height: 140, touchAction: 'none', border: '1px solid #c9d3dc', borderRadius: 8, background: '#fff' }}
        aria-label="Signature pad: draw your signature with a finger"
        onPointerDown={(e) => {
          drawing.current = true;
          e.currentTarget.setPointerCapture(e.pointerId);
          const ctx = e.currentTarget.getContext('2d')!;
          const p = point(e);
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
        }}
        onPointerMove={(e) => {
          if (!drawing.current) return;
          const ctx = e.currentTarget.getContext('2d')!;
          const p = point(e);
          ctx.lineTo(p.x, p.y);
          ctx.stroke();
          setInked(true);
        }}
        onPointerUp={() => {
          drawing.current = false;
          if (inked || canvas.current) onChange(canvas.current!.toDataURL('image/png'));
        }}
      />
      <button type="button" style={{ minHeight: 44, minWidth: 44 }} onClick={clear}>Clear</button>
    </div>
  );
}
