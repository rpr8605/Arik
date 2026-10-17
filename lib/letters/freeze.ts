// Freezing a letter (Phase 4): the exact text is hashed, and the PDF is
// rendered from that same text, so what downloads is what was frozen.
// The hash and the frozen row live in `letters` (db/038).

import { createHash } from 'node:crypto';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import type { DraftLetter } from '../production/types';

export const frozenText = (l: Pick<DraftLetter, 'subject' | 'body' | 'footer'>) => `${l.subject}\n\n${l.body}\n\n${l.footer}`;
export const letterHash = (l: Pick<DraftLetter, 'subject' | 'body' | 'footer'>) => createHash('sha256').update(frozenText(l), 'utf8').digest('hex');

// The standard PDF fonts cover Western European letters; anything else is
// shown as "?" rather than failing the PDF. The hash is of the real text.
function encodable(font: { encodeText(t: string): unknown }, text: string) {
  let out = '';
  for (const ch of text) {
    try {
      font.encodeText(ch);
      out += ch;
    } catch {
      out += '?';
    }
  }
  return out;
}

// `signature` (Phase 6): the patient's signature image and a "Signed
// electronically" line, drawn right after the letter text. The text, and
// so the frozen hash, is unchanged.
// `at` (the freeze or signing time) pins the PDF's dates: a frozen or
// signed copy downloads byte-identical every time, so its hash holds.
export async function letterPdf(l: Pick<DraftLetter, 'subject' | 'body' | 'footer'>, dateLine: string, signature?: { png: Uint8Array; line: string; at: Date }, at?: Date): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(l.subject);
  doc.setProducer('Arik Health');
  const fixed = signature?.at ?? at;
  if (fixed) {
    doc.setCreationDate(fixed);
    doc.setModificationDate(fixed);
  }
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const W = 612;
  const H = 792;
  const M = 64;
  const size = 11;
  const lead = 15;
  let page = doc.addPage([W, H]);
  let y = H - M;
  const footer = () => {
    const f = encodable(font, l.footer);
    page.drawText(f, { x: M, y: 36, size: 8, font, color: rgb(0.35, 0.35, 0.35), maxWidth: W - 2 * M });
  };
  footer();
  const wrap = (text: string, f: typeof font, s: number) => {
    const lines: string[] = [];
    for (const para of text.split('\n')) {
      let cur = '';
      for (const word of para.split(/\s+/).filter(Boolean)) {
        const next = cur ? `${cur} ${word}` : word;
        if (f.widthOfTextAtSize(encodable(f, next), s) > W - 2 * M && cur) {
          lines.push(cur);
          cur = word;
        } else cur = next;
      }
      lines.push(cur);
    }
    return lines;
  };
  const write = (text: string, f = font, s = size) => {
    for (const line of wrap(text, f, s)) {
      if (y < M + 20) {
        page = doc.addPage([W, H]);
        footer();
        y = H - M;
      }
      page.drawText(encodable(f, line), { x: M, y, size: s, font: f });
      y -= lead;
    }
  };
  write(dateLine);
  y -= lead;
  write(`Re: ${l.subject}`, bold);
  y -= lead;
  for (const para of l.body.split('\n\n')) {
    write(para);
    y -= lead / 2;
  }
  if (signature) {
    const img = await doc.embedPng(signature.png);
    const scale = Math.min(200 / img.width, 60 / img.height, 1);
    const h = img.height * scale;
    if (y - h - lead < M + 20) {
      page = doc.addPage([W, H]);
      footer();
      y = H - M;
    }
    page.drawImage(img, { x: M, y: y - h, width: img.width * scale, height: h });
    y -= h + lead / 2;
    write(signature.line, font, 9);
  }
  return doc.save();
}
