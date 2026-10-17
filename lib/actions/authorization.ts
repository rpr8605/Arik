// The one-time authorization and signed copies (Phase 6). Pure except for
// PDF rendering (pdf-lib) and hashing.
//
// AUTHORIZATION_TEXT IS A PLACEHOLDER. Counsel writes the real form
// language before launch (docs/legal_review_before_launch.md). Its version
// is stored with every signature, so a signature always points at the
// exact words the patient saw.

import { createHash } from 'node:crypto';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { letterPdf } from '../letters/freeze';
import type { DraftLetter } from '../production/types';

export const AUTHORIZATION_VERSION = 'placeholder-2026-10-17';
export const AUTHORIZATION_NEEDS_COUNSEL = true;
export const AUTHORIZATION_TEXT = [
  'PLACEHOLDER TEXT FOR LEGAL REVIEW. NOT FINAL.',
  'I allow Arik Health to prepare letters I approve, send each one only after I approve it, track its delivery, and receive replies about my cases at a return number or address Arik sets up for me.',
  'Arik will not sign for me, pay for me, or say anything about my health that I have not confirmed.',
  'I can take this back at any time in Arik. Taking it back does not undo letters already sent.',
].join('\n\n');

export const sha256 = (data: string | Uint8Array) => createHash('sha256').update(data).digest('hex');
export const authorizationTextHash = () => sha256(`${AUTHORIZATION_VERSION}\n${AUTHORIZATION_TEXT}`);

// ---------- Signatures ----------

const PNG_PREFIX = 'data:image/png;base64,';
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
export const SIGNATURE_MAX_BYTES = 200_000;
export const SIGNATURE_MIN_BYTES = 300;   // a blank pad encodes smaller than any real stroke

export function parseSignature(v: unknown): { png: Uint8Array; dataUrl: string } | { error: string } {
  if (typeof v !== 'string' || !v.startsWith(PNG_PREFIX)) return { error: 'the signature must be a PNG image' };
  const b64 = v.slice(PNG_PREFIX.length);
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(b64)) return { error: 'the signature is not valid' };
  const png = new Uint8Array(Buffer.from(b64, 'base64'));
  if (png.length > SIGNATURE_MAX_BYTES) return { error: 'the signature image is too large' };
  if (png.length < SIGNATURE_MIN_BYTES) return { error: 'the signature looks empty; sign with your finger' };
  if (!PNG_MAGIC.every((b, i) => png[i] === b)) return { error: 'the signature must be a PNG image' };
  return { png, dataUrl: v };
}

// A blank pad still encodes to a valid PNG, so count the inked pixels
// (visible and not near-white). A finger stroke leaves hundreds.
export const SIGNATURE_MIN_INK_PIXELS = 60;
export async function signatureHasInk(png: Uint8Array): Promise<boolean> {
  const sharp = (await import('sharp')).default;
  const { data, info } = await sharp(Buffer.from(png)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let ink = 0;
  for (let i = 0; i < data.length; i += info.channels) {
    const [r, g, b, a] = [data[i], data[i + 1], data[i + 2], data[i + 3]];
    if (a > 64 && r + g + b < 600 && ++ink >= SIGNATURE_MIN_INK_PIXELS) return true;
  }
  return false;
}

const longDate = (iso: string) => new Date(iso).toLocaleString('en-US', { month: 'long', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'UTC', timeZoneName: 'short' });

// The signed authorization: its exact text, the signer's typed name, the
// signature and the time. No IP address or device details.
export async function authorizationPdf(name: string, signedAtIso: string, png: Uint8Array): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle('Authorization for Arik Health');
  doc.setProducer('Arik Health');
  doc.setCreationDate(new Date(signedAtIso));
  doc.setModificationDate(new Date(signedAtIso));
  const page = doc.addPage([612, 792]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  let y = 728;
  page.drawText('Authorization for Arik Health', { x: 64, y, size: 15, font: bold });
  y -= 22;
  page.drawText(`Version ${AUTHORIZATION_VERSION}`, { x: 64, y, size: 9, font, color: rgb(0.4, 0.4, 0.4) });
  y -= 28;
  for (const para of AUTHORIZATION_TEXT.split('\n\n')) {
    let line = '';
    for (const w of para.split(' ')) {
      if (font.widthOfTextAtSize(`${line} ${w}`, 11) > 484) {
        page.drawText(line.trim(), { x: 64, y, size: 11, font });
        y -= 15;
        line = '';
      }
      line += ` ${w}`;
    }
    page.drawText(line.trim(), { x: 64, y, size: 11, font });
    y -= 24;
  }
  const img = await doc.embedPng(png);
  const scale = Math.min(220 / img.width, 70 / img.height, 1);
  page.drawImage(img, { x: 64, y: y - 70, width: img.width * scale, height: img.height * scale });
  y -= 90;
  page.drawText(signedLine(name, signedAtIso), { x: 64, y, size: 10, font });
  return doc.save();
}

// A frozen letter with the patient's signature: the same text (its hash
// still matches the frozen letter), the signature and the signing time,
// drawn right after the sign-off.
export const signedLine = (name: string, signedAtIso: string) => `Signed electronically by ${name} on ${longDate(signedAtIso)}.`;
export function signedLetterPdf(l: Pick<DraftLetter, 'subject' | 'body' | 'footer'>, dateLine: string, name: string, signedAtIso: string, png: Uint8Array): Promise<Uint8Array> {
  return letterPdf(l, dateLine, { png, line: signedLine(name, signedAtIso), at: new Date(signedAtIso) });
}
