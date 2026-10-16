// Multi-format document intake (MULTI_FORMAT_UPLOAD.md): a preprocessing
// layer in front of the SAME extraction tier everything else uses - no
// model change, no OCR service. The paths:
//
//   PDF with a text layer  -> extract text directly (cheaper + more
//                             accurate than vision; 'pdf_native')
//   PDF without one        -> rasterize pages, vision extraction
//                             ('pdf_scanned') - detection is automatic,
//                             the patient never has to know the difference
//   PNG/JPEG (screenshots) -> vision extraction directly ('image_upload')
//   HEIC (iPhone default)  -> server-side JPEG conversion first (more
//   ('image_upload')         reliable across devices than client-side)
//
// Reader (2026-10-16, owner decision): the DEFAULT reader is on-server
// (pdfjs text layer, else tesseract OCR; lib/production/real/readers.ts):
// nothing leaves this server, and it returns line items with page
// positions for the bill checks. The model reader below is used only when
// DOCUMENT_READER=model is set, which needs a BAA-covered model first.
//
// Screening is file-type + size ONLY. Malware scanning is a known gap,
// explicitly deferred - do not close it accidentally; track separately.

import { join } from 'node:path';
import { callModel, type ModelImage } from './callModel';
import type { ExtractedDocument } from './production/types';

// pdfjs needs its bundled standard fonts even for text-only extraction
// (it warns/falls back otherwise). Resolved from process.cwd() (the
// project root in dev and self-hosted start) because Turbopack's
// require.resolve returns a virtual "[externals]" path, not a real one.
// pdfjs insists on a trailing FORWARD slash, even on Windows.
const STANDARD_FONTS = join(process.cwd(), 'node_modules', 'pdfjs-dist', 'standard_fonts') + '/';

export const MAX_FILE_BYTES = 25 * 1024 * 1024; // 25MB upload cap
const NATIVE_TEXT_MIN_CHARS = 200; // below this a PDF is treated as image-only
const PDF_MAX_PAGES = 10; // cost guard on rasterization
const PDF_TEXT_MAX_CHARS = 20_000; // prompt-size guard on native text
const EXTRACTION_MAX_TOKENS = 1200; // document JSON is bigger than chat extraction's 200-token default

export type IntakeKind = 'pdf' | 'image' | 'heic';
export type SourceFormat = 'camera_capture' | 'pdf_native' | 'pdf_scanned' | 'image_upload';

// Basic type screening: extension + MIME, both patient-controlled, so
// both are treated as hints and the content handlers below fail loud on
// anything that isn't really what it claims (a fake .pdf dies in the
// PDF parser, a fake .heic dies in conversion, etc).
export function detectKind(filename: string, mime: string): IntakeKind | null {
  const ext = (filename.split('.').pop() ?? '').toLowerCase();
  if (mime === 'application/pdf' || ext === 'pdf') return 'pdf';
  if (['image/png', 'image/jpeg'].includes(mime) || ['png', 'jpg', 'jpeg'].includes(ext)) return 'image';
  if (['image/heic', 'image/heif'].includes(mime) || ['heic', 'heif'].includes(ext)) return 'heic';
  return null;
}

// --- PDF: text first (MULTI_FORMAT_UPLOAD.md's cheaper, more accurate path) ---
export async function extractPdfText(buf: Buffer): Promise<string> {
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = getDocument({ data: new Uint8Array(buf), standardFontDataUrl: STANDARD_FONTS });
  const doc = await task.promise;
  const parts: string[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    parts.push(content.items.map((item: any) => ('str' in item ? item.str : '')).join(' '));
  }
  await task.destroy();
  return parts.join('\n').trim();
}

// --- PDF fallback: rasterize pages for the vision path ---
export async function rasterizePdf(buf: Buffer): Promise<ModelImage[]> {
  const { pdf } = await import('pdf-to-img');
  const images: ModelImage[] = [];
  for await (const page of await pdf(buf, { scale: 2 })) {
    images.push({ mediaType: 'image/png', base64: Buffer.from(page).toString('base64') });
    if (images.length >= PDF_MAX_PAGES) break;
  }
  if (images.length === 0) throw new Error('PDF produced no pages to rasterize');
  return images;
}

// --- HEIC -> JPEG, server-side ---
export async function convertHeic(buf: Buffer): Promise<ModelImage> {
  const { default: convert } = await import('heic-convert');
  const out = await convert({ buffer: buf, format: 'JPEG', quality: 0.9 });
  return { mediaType: 'image/jpeg', base64: Buffer.from(out).toString('base64') };
}

// --- The extraction call itself ---
export interface DocumentExtraction {
  doc_type: 'itemized_bill' | 'eob' | 'denial_letter' | 'insurance_card' | 'spd' | 'other';
  institution_name: string | null;
  payer_name: string | null;
  total_amount_usd: number | null;
  denial_reason: string | null;
  summary: string | null;
  // On-server reader only: what it read, line by line, with positions.
  reader?: string;
  layout?: ExtractedDocument;
}

const DOC_TYPES = ['itemized_bill', 'eob', 'denial_letter', 'insurance_card', 'spd', 'other'] as const;

const EXTRACTION_PROMPT = `Extract structured data from this healthcare
cost document (a bill, explanation of benefits, denial letter, insurance
card, or plan document). Return ONLY JSON, no prose. Only what is
explicitly in the document; null otherwise. total_amount_usd is the
patient-facing amount (patient responsibility / amount due), not charges
or plan-paid amounts, when those differ.

Schema:
{
  "doc_type": "itemized_bill" | "eob" | "denial_letter" | "insurance_card" | "spd" | "other",
  "institution_name": string | null,
  "payer_name": string | null,
  "total_amount_usd": number | null,
  "denial_reason": string | null,
  "summary": string | null
}`;

function cleanStr(v: any, max = 300): string | null {
  return typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null;
}

export function normalizeExtraction(raw: any): DocumentExtraction {
  const obj = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  return {
    doc_type: (DOC_TYPES as readonly string[]).includes(obj.doc_type) ? obj.doc_type : 'other',
    institution_name: cleanStr(obj.institution_name),
    payer_name: cleanStr(obj.payer_name),
    total_amount_usd:
      typeof obj.total_amount_usd === 'number' && Number.isFinite(obj.total_amount_usd)
        ? obj.total_amount_usd
        : null,
    denial_reason: cleanStr(obj.denial_reason, 1000),
    summary: cleanStr(obj.summary, 1000),
  };
}

// Model output is untrusted: tolerate markdown fences AND stray prose
// around the JSON object; throw (a first-class 'failed' row) only when
// no parseable object exists at all.
function parseModelJson(res: string): any {
  const cleaned = res.replace(/^```(?:json)?\s*|\s*```$/g, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    // fall through to brace extraction
  }
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start >= 0 && end > start) {
    return JSON.parse(cleaned.slice(start, end + 1));
  }
  throw new Error('extraction model returned no parseable JSON object');
}

export async function extractDocumentData(input: {
  text?: string;
  images?: ModelImage[];
}): Promise<DocumentExtraction> {
  const prompt = input.text
    ? `${EXTRACTION_PROMPT}\n\nDocument text:\n${input.text.slice(0, PDF_TEXT_MAX_CHARS)}`
    : EXTRACTION_PROMPT;
  const res = await callModel({
    tier: 'extraction',
    prompt,
    images: input.images,
    maxTokens: EXTRACTION_MAX_TOKENS,
  });
  return normalizeExtraction(parseModelJson(res));
}

// Content sniffing, because the extension and MIME are both
// patient-controlled: PNG/JPEG magic bytes decide the real format.
function sniffImageMime(buf: Buffer): 'image/png' | 'image/jpeg' {
  if (buf.length > 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
    return 'image/png';
  }
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return 'image/jpeg';
  }
  throw new Error('file claims to be an image but has no PNG/JPEG signature');
}

// The on-server reading in the shape the route and the upload screen
// already use. Pure. Header fields only; no summary, no denial reason (the
// on-server parser doesn't write prose).
export function layoutToExtraction(doc: ExtractedDocument): DocumentExtraction {
  const h = doc.header;
  const bill = doc.docType === 'itemized_bill' || doc.docType === 'summary_bill';
  return {
    doc_type: bill ? 'itemized_bill' : doc.docType === 'eob' || doc.docType === 'denial_letter' || doc.docType === 'insurance_card' ? doc.docType : 'other',
    institution_name: bill ? h.provider.value : null,
    payer_name: doc.docType === 'eob' || doc.docType === 'denial_letter' ? h.provider.value : null,
    total_amount_usd: bill ? h.amountDueUsd.value : null,
    denial_reason: null,
    summary: null,
    reader: doc.reader,
    layout: doc,
  };
}

export const documentReader = () => (process.env.DOCUMENT_READER?.trim().toLowerCase() === 'model' ? 'model' : 'on-server');

// One call per upload: decides native-vs-scanned for PDFs, converts HEIC,
// and returns everything the route needs to persist the row.
export async function processUpload(
  kind: IntakeKind,
  buf: Buffer,
): Promise<{ sourceFormat: SourceFormat; extraction: DocumentExtraction }> {
  if (documentReader() === 'on-server') {
    const { onServerExtractor } = await import('./production/real/readers');
    const bytes = kind === 'heic' ? Buffer.from((await convertHeic(buf)).base64, 'base64') : buf;
    const mime = kind === 'pdf' ? 'application/pdf' : kind === 'heic' ? 'image/jpeg' : sniffImageMime(buf);
    const doc = await onServerExtractor.extract({ bytes: new Uint8Array(bytes), mime, filename: 'upload', origin: 'upload' });
    const sourceFormat: SourceFormat = kind !== 'pdf' ? 'image_upload' : doc.reader.endsWith('text-layer') ? 'pdf_native' : 'pdf_scanned';
    return { sourceFormat, extraction: layoutToExtraction(doc) };
  }
  if (kind === 'pdf') {
    const text = await extractPdfText(buf);
    if (text.length >= NATIVE_TEXT_MIN_CHARS) {
      return { sourceFormat: 'pdf_native', extraction: await extractDocumentData({ text }) };
    }
    // Image-only PDF: same vision path as a photographed page.
    const images = await rasterizePdf(buf);
    return { sourceFormat: 'pdf_scanned', extraction: await extractDocumentData({ images }) };
  }
  const image = kind === 'heic'
    ? await convertHeic(buf)
    : { mediaType: sniffImageMime(buf), base64: buf.toString('base64') };
  return { sourceFormat: 'image_upload', extraction: await extractDocumentData({ images: [image] }) };
}
