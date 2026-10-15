'use client';

import { useState } from 'react';
import { LETTER_FOOTER, fillLetter, type DemoLetter } from '@/lib/walkthrough/letters';

// A letter on a paper-style page: Edit (the one scripted field, the phone
// number), Download PDF (pdf-lib, made in the browser, SAMPLE watermark),
// Attach (shows what goes with it), then continue to sending.
export function LetterView({
  letter,
  phone,
  onPhone,
  onContinue,
  done,
}: {
  letter: DemoLetter;
  phone: string;
  onPhone: (p: string) => void;
  onContinue: () => void;
  done: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [showAttach, setShowAttach] = useState(false);
  const [pdfState, setPdfState] = useState<'idle' | 'busy' | 'error'>('idle');

  async function downloadPdf() {
    setPdfState('busy');
    try {
      const { PDFDocument, StandardFonts, rgb, degrees } = await import('pdf-lib');
      const doc = await PDFDocument.create();
      const font = await doc.embedFont(StandardFonts.Helvetica);
      const bold = await doc.embedFont(StandardFonts.HelveticaBold);
      let page = doc.addPage([612, 792]);
      const margin = 60;
      const width = 612 - margin * 2;
      let y = 792 - margin;
      const watermark = () =>
        page.drawText('SAMPLE', { x: 150, y: 300, size: 110, font: bold, color: rgb(0.7, 0.21, 0.18), opacity: 0.08, rotate: degrees(30) });
      watermark();
      const wrap = (text: string, f = font, size = 11) => {
        const words = text.split(/\s+/);
        const lines: string[] = [];
        let line = '';
        for (const w of words) {
          const next = line ? `${line} ${w}` : w;
          if (f.widthOfTextAtSize(next, size) > width) {
            lines.push(line);
            line = w;
          } else line = next;
        }
        if (line) lines.push(line);
        return lines;
      };
      const draw = (text: string, opts: { f?: typeof font; size?: number; gap?: number } = {}) => {
        const size = opts.size ?? 11;
        for (const l of wrap(text, opts.f ?? font, size)) {
          if (y < margin + 40) {
            page = doc.addPage([612, 792]);
            watermark();
            y = 792 - margin;
          }
          page.drawText(l, { x: margin, y, size, font: opts.f ?? font, color: rgb(0.13, 0.26, 0.36) });
          y -= size + 4;
        }
        y -= opts.gap ?? 8;
      };
      draw(fillLetter(letter.from, phone), { gap: 4 });
      draw(letter.date, { gap: 14 });
      draw(`${letter.to.name}, ${letter.to.dept}`, { f: bold, gap: 2 });
      draw(letter.to.address, { gap: 2 });
      draw(`Fax ${letter.to.fax}`, { gap: 14 });
      draw(`Re: ${letter.subject}`, { f: bold, gap: 12 });
      for (const p of letter.paragraphs) draw(fillLetter(p, phone));
      draw('Sincerely,', { gap: 2 });
      draw(letter.signoff, { gap: 18 });
      draw(`Enclosed: ${letter.attachments.join('; ')}`, { size: 9, gap: 10 });
      draw(LETTER_FOOTER, { size: 9, gap: 4 });
      draw('Sample letter from the Arik Health demo. Fictional people and organizations. Not sent.', { size: 9 });
      const bytes = await doc.save();
      const blob = new Blob([bytes as BlobPart], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `arik-sample-${letter.id}.pdf`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      setPdfState('idle');
    } catch {
      setPdfState('error');
    }
  }

  return (
    <div className="letter-wrap">
      <article className="paper" aria-label={letter.title}>
        <span className="tag tag-sample">Sample letter</span>
        <p className="paper-from">{fillLetter(letter.from, phone)}</p>
        <p>{letter.date}</p>
        <p>
          <strong>{letter.to.name}</strong>
          <br />
          {letter.to.dept}
          <br />
          {letter.to.address}
          <br />
          Fax {letter.to.fax}
        </p>
        <p>
          <strong>Re: {letter.subject}</strong>
        </p>
        {letter.paragraphs.map((p) => (
          <p key={p}>{fillLetter(p, phone)}</p>
        ))}
        <p>
          Sincerely,
          <br />
          {letter.signoff}
        </p>
        <p className="paper-footer">{LETTER_FOOTER}</p>
      </article>
      {editing ? (
        <div className="letter-edit">
          <label htmlFor={`phone-${letter.id}`}>Your phone number</label>
          <input
            id={`phone-${letter.id}`}
            type="text"
            inputMode="tel"
            value={phone}
            placeholder="(555) 555-0100"
            onChange={(e) => onPhone(e.target.value)}
          />
          <button type="button" onClick={() => setEditing(false)}>
            Done editing
          </button>
        </div>
      ) : null}
      {showAttach ? (
        <ul className="attach-list">
          {letter.attachments.map((a) => (
            <li key={a}>📎 {a}</li>
          ))}
        </ul>
      ) : null}
      {!done ? (
        <div className="actions">
          <button type="button" onClick={() => setEditing((e) => !e)}>
            Edit
          </button>
          <button type="button" onClick={downloadPdf} disabled={pdfState === 'busy'}>
            {pdfState === 'busy' ? 'Making PDF…' : 'Download PDF'}
          </button>
          <button type="button" onClick={() => setShowAttach((s) => !s)} aria-pressed={showAttach}>
            Attach
          </button>
          <button type="submit" onClick={onContinue}>
            Looks good, send it
          </button>
        </div>
      ) : null}
      {pdfState === 'error' ? <p role="alert">Couldn&apos;t make the PDF. Try again.</p> : null}
    </div>
  );
}
