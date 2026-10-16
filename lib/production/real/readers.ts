// Real document readers (Phase 2), behind the Extractor interface:
// - textLayerExtractor: words with positions from a PDF's text layer (pdfjs).
// - ocrExtractor: on-server OCR (tesseract.js, English data shipped in
//   node_modules, nothing leaves this server). Handles images and
//   image-only PDFs (rendered with pdf-to-img first).
// - onServerExtractor: the DEFAULT: text layer when the PDF has one,
//   otherwise OCR.
// - visionExtractor: an AI vision model via OpenRouter. allowsRealPatientData
//   is false: no BAA covers it, so it only ever sees SYNTHETIC documents
//   (the benchmark). It returns no page positions.
// The words all go through the same pure parser (lib/production/layout.ts).

import { join } from 'node:path';
import { callModel, type ModelUsage } from '../../callModel';
import { deskew, parseDate, parseDocument, type Word } from '../layout';
import type { DocType, ExtractedDocument, Extractor, Field, SourceDocument } from '../types';

const STANDARD_FONTS = join(process.cwd(), 'node_modules', 'pdfjs-dist', 'standard_fonts').split('\\').join('/') + '/';
const TEXT_LAYER_MIN_CHARS = 120;
const OCR_MAX_PAGES = 10;

export async function pdfTextWords(bytes: Uint8Array): Promise<Word[]> {
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = getDocument({ data: new Uint8Array(bytes), standardFontDataUrl: STANDARD_FONTS });
  const doc = await task.promise;
  const words: Word[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const vp = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    for (const item of content.items as any[]) {
      const str: string = item.str ?? '';
      if (!str.trim()) continue;
      const [, , , , e, f] = item.transform as number[];
      const h = item.height || Math.abs(item.transform[3]) || 10;
      // Split multi-word items into words, spreading the width evenly by
      // character count (positions only need to be close).
      const parts = str.split(/(\s+)/);
      let offset = 0;
      for (const part of parts) {
        const w = (part.length / str.length) * item.width;
        if (part.trim()) {
          words.push({ text: part, page: p, x: ((e + offset) / vp.width) * 100, y: ((vp.height - f - h) / vp.height) * 100, w: (w / vp.width) * 100, h: (h / vp.height) * 100, conf: 1 });
        }
        offset += w;
      }
    }
  }
  await task.destroy();
  return words;
}

export async function pdfToPngs(bytes: Uint8Array): Promise<Buffer[]> {
  const { pdf } = await import('pdf-to-img');
  const out: Buffer[] = [];
  for await (const img of await pdf(Buffer.from(bytes), { scale: 2, docInitParams: { standardFontDataUrl: STANDARD_FONTS } })) out.push(Buffer.from(img));
  return out;
}

// OCR never hangs a request: starting the worker and reading each page are
// capped, and a worker that times out is thrown away (the upload then
// fails cleanly as a 'failed' row, per the intake rules).
const OCR_START_MS = 30_000;
const OCR_PAGE_MS = 60_000;
export function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([
    p.finally(() => clearTimeout(timer)),
    new Promise<T>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${what} timed out after ${ms / 1000}s`)), ms);
    }),
  ]);
}

let workerPromise: Promise<any> | null = null;
async function ocrWorker() {
  if (!workerPromise) {
    workerPromise = withTimeout(
      (async () => {
        const { createWorker, OEM } = await import('tesseract.js');
        return createWorker('eng', OEM.LSTM_ONLY, {
          // Explicit paths: bundlers rewrite the package's own lookup.
          workerPath: join(process.cwd(), 'node_modules', 'tesseract.js', 'src', 'worker-script', 'node', 'index.js'),
          langPath: join(process.cwd(), 'node_modules', '@tesseract.js-data', 'eng', '4.0.0_best_int'),
          gzip: true,
          cacheMethod: 'none',
          errorHandler: () => {},
        });
      })(),
      OCR_START_MS,
      'starting OCR',
    ).catch((e) => {
      workerPromise = null;
      throw e;
    });
  }
  return workerPromise;
}

async function dropWorker() {
  const w = workerPromise;
  workerPromise = null;
  if (w) await w.then((x) => x.terminate()).catch(() => {});
}

export async function terminateOcr() {
  if (workerPromise) {
    const w = await workerPromise;
    workerPromise = null;
    await w.terminate();
  }
}

// OCR one page image -> words in page percent, deskewed by the median
// angle of the long text lines OCR found.
export async function ocrWords(image: Buffer, page = 1): Promise<Word[]> {
  const sharp = (await import('sharp')).default;
  const meta = await sharp(image).metadata();
  const W = meta.width ?? 1;
  const H = meta.height ?? 1;
  const worker = await ocrWorker();
  let data: any;
  try {
    ({ data } = (await withTimeout(worker.recognize(image, {}, { blocks: true }), OCR_PAGE_MS, 'reading the page')) as any);
  } catch (e) {
    await dropWorker();
    throw e;
  }
  const words: Word[] = [];
  const angles: number[] = [];
  for (const b of data.blocks ?? []) {
    for (const p of b.paragraphs ?? []) {
      for (const l of p.lines ?? []) {
        const bl = l.baseline;
        if (bl && bl.x1 - bl.x0 > W * 0.25) angles.push((Math.atan2(bl.y1 - bl.y0, bl.x1 - bl.x0) * 180) / Math.PI);
        for (const w of l.words ?? []) {
          const bb = w.bbox;
          words.push({ text: w.text, page, x: (bb.x0 / W) * 100, y: (bb.y0 / H) * 100, w: ((bb.x1 - bb.x0) / W) * 100, h: ((bb.y1 - bb.y0) / H) * 100, conf: Math.max(0, Math.min(1, (w.confidence ?? 0) / 100)) });
        }
      }
    }
  }
  angles.sort((a, b) => a - b);
  const angle = angles.length ? angles[Math.floor(angles.length / 2)] : 0;
  // The image aspect isn't square: rotate in pixel space, not percent.
  const px = words.map((w) => ({ ...w, x: (w.x / 100) * W, y: (w.y / 100) * H, w: (w.w / 100) * W, h: (w.h / 100) * H }));
  const centred = deskew(px.map((w) => ({ ...w, x: w.x - W / 2 + 50, y: w.y - H / 2 + 50 })), angle);
  return centred.map((w) => ({ ...w, x: ((w.x + W / 2 - 50) / W) * 100, y: ((w.y + H / 2 - 50) / H) * 100, w: (w.w / W) * 100, h: (w.h / H) * 100 }));
}

export const textLayerExtractor: Extractor = {
  name: 'pdf-text-layer',
  allowsRealPatientData: true,
  async extract(doc: SourceDocument) {
    if (doc.mime !== 'application/pdf') throw new Error('text layer needs a PDF');
    return parseDocument(await pdfTextWords(doc.bytes), 'pdf-text-layer');
  },
};

export const ocrExtractor: Extractor = {
  name: 'ocr-tesseract',
  allowsRealPatientData: true,
  async extract(doc: SourceDocument) {
    // Same page cap as the intake's rasterization guard.
    const images = (doc.mime === 'application/pdf' ? await pdfToPngs(doc.bytes) : [Buffer.from(doc.bytes)]).slice(0, OCR_MAX_PAGES);
    const words: Word[] = [];
    for (let i = 0; i < images.length; i++) words.push(...(await ocrWords(images[i], i + 1)));
    return parseDocument(words, 'ocr-tesseract');
  },
};

// The default reader: the PDF's own text when it has enough of it,
// otherwise OCR. Everything stays on this server.
export const onServerExtractor: Extractor = {
  name: 'on-server',
  allowsRealPatientData: true,
  async extract(doc: SourceDocument) {
    if (doc.mime === 'application/pdf') {
      const words = await pdfTextWords(doc.bytes);
      if (words.reduce((t, w) => t + w.text.length, 0) >= TEXT_LAYER_MIN_CHARS) return parseDocument(words, 'on-server:text-layer');
    }
    const out = await ocrExtractor.extract(doc);
    return { ...out, reader: 'on-server:ocr' };
  },
};

// ---------- Vision model (synthetic documents only) ----------

const VISION_PROMPT = `Read this medical document image and return ONLY JSON, no prose:
{"docType":"itemized_bill|eob|denial_letter|unknown","patientName":string|null,"provider":string|null,"accountNumber":string|null,
"statementDate":"YYYY-MM-DD"|null,"serviceFrom":"YYYY-MM-DD"|null,"serviceTo":"YYYY-MM-DD"|null,"totalCharges":number|null,"amountDue":number|null,
"lines":[{"date":"YYYY-MM-DD"|null,"code":string|null,"description":string|null,"units":number|null,"charge":number|null}]}
For an EOB, accountNumber is the claim number, patientName is the member, and charge is the billed amount. For a denial letter, statementDate is the letter date and lines is [].
Copy values exactly as printed. Use null when a value is not on the page.`;

export function visionExtractor(onUsage?: (u: ModelUsage) => void): Extractor {
  return {
    name: 'vision-model',
    allowsRealPatientData: false,
    async extract(doc: SourceDocument) {
      if (doc.origin !== 'synthetic') throw new Error('the vision reader only reads synthetic documents (no BAA)');
      const pngs = doc.mime === 'application/pdf' ? await pdfToPngs(doc.bytes) : [Buffer.from(doc.bytes)];
      const sharp = (await import('sharp')).default;
      const images = await Promise.all(
        pngs.slice(0, 2).map(async (b) => ({ mediaType: 'image/jpeg' as const, base64: (await sharp(b).resize({ width: 1400, withoutEnlargement: true }).jpeg({ quality: 80 }).toBuffer()).toString('base64') })),
      );
      const raw = await callModel({ tier: 'extraction', prompt: VISION_PROMPT, images, maxTokens: 1800, timeoutMs: 90_000, onUsage });
      const json = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1));
      const f = <T>(v: T | null | undefined): Field<T> => ({ value: v ?? null, confidence: v == null ? 0 : 0.9, box: null });
      const iso = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : typeof v === 'string' ? parseDate(v) : null);
      const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
      const out: ExtractedDocument = {
        docType: (['itemized_bill', 'eob', 'denial_letter'].includes(json.docType) ? json.docType : 'unknown') as DocType,
        header: {
          patientName: f(json.patientName),
          provider: f(json.provider),
          accountNumber: f(json.accountNumber),
          statementDate: f(iso(json.statementDate)),
          serviceFrom: f(iso(json.serviceFrom)),
          serviceTo: f(iso(json.serviceTo)),
          totalChargesUsd: f(num(json.totalCharges)),
          amountDueUsd: f(num(json.amountDue)),
        },
        lines: (Array.isArray(json.lines) ? json.lines : []).map((l: any) => ({
          date: f(iso(l.date)),
          code: f(typeof l.code === 'string' ? l.code : null),
          description: f(typeof l.description === 'string' ? l.description : null),
          units: f(num(l.units)),
          chargeUsd: f(num(l.charge)),
          box: null,
        })),
        reader: 'vision-model',
        textChars: raw.length,
      };
      return out;
    },
  };
}
