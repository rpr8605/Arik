// Render the synthetic document library (docs/kimi/PLAN_PHASES_2_4.md
// step 2) from lib/synth/model.ts: 20 itemized bills, 20 EOBs and 20
// denial letters, each in one of three qualities (seed % 3):
//   clean - a PDF with a text layer
//   scan  - an image-only PDF (rendered, grayscale, soft, speckled)
//   photo - a JPEG like a phone photo (tilted, shadowed, soft)
// Each document gets <id>.json with the ground truth. Output: .data/synth/
// (gitignored; the library is reproducible from the seeds).
//
//   npx tsx scripts/synth_docs/generate.ts [--count 20]

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import { pdf as pdfToImages } from 'pdf-to-img';
import sharp from 'sharp';
import { formatDate, makeBill, makeDenial, makeEob, rng, usd, type SynthBill, type SynthDenial, type SynthEob } from '../../lib/synth/model';

const OUT = join(__dirname, '..', '..', '.data', 'synth');
mkdirSync(OUT, { recursive: true });
const W = 612;
const H = 792;
type Quality = 'clean' | 'scan' | 'photo';
const QUALITIES: Quality[] = ['clean', 'scan', 'photo'];

// Row boxes recorded while drawing, in page percent (ground truth for highlights).
interface Drawn {
  rows: { x: number; y: number; w: number; h: number }[];
}

async function fonts(doc: PDFDocument, f: SynthBill['style']['font']) {
  const map = { Helvetica: [StandardFonts.Helvetica, StandardFonts.HelveticaBold], TimesRoman: [StandardFonts.TimesRoman, StandardFonts.TimesRomanBold], Courier: [StandardFonts.Courier, StandardFonts.CourierBold] } as const;
  return { reg: await doc.embedFont(map[f][0]), bold: await doc.embedFont(map[f][1]) };
}

function text(page: PDFPage, s: string, x: number, yTop: number, font: PDFFont, size = 10) {
  page.drawText(s, { x, y: H - yTop, size, font, color: rgb(0.1, 0.1, 0.12) });
}
const right = (page: PDFPage, s: string, xRight: number, yTop: number, font: PDFFont, size = 10) => text(page, s, xRight - font.widthOfTextAtSize(s, size), yTop, font, size);

const LABELS = [
  { patient: 'Patient', account: 'Account', stmt: 'Statement date', visit: 'Dates of service', total: 'Total charges', paid: 'Insurance paid', due: 'Amount due' },
  { patient: 'Patient name', account: 'Account #', stmt: 'Statement Date', visit: 'Service dates', total: 'TOTAL CHARGES', paid: 'Payments/adjustments', due: 'PLEASE PAY' },
  { patient: 'Guarantor/Patient', account: 'Acct No.', stmt: 'Date', visit: 'Admit - Discharge', total: 'Total', paid: 'Plan paid', due: 'Balance due' },
];

async function renderBill(b: SynthBill): Promise<{ bytes: Uint8Array; drawn: Drawn }> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([W, H]);
  const { reg, bold } = await fonts(doc, b.style.font);
  const L = LABELS[b.style.labels];
  const df = (d: string) => formatDate(d, b.style.dateFormat);
  text(page, b.provider, 40, 50, bold, 15);
  text(page, b.providerAddress, 40, 68, reg, 9);
  text(page, `Billing office: ${b.billingPhone}`, 40, 82, reg, 9);
  text(page, 'ITEMIZED STATEMENT', 40, 112, bold, 12);
  const hdr: [string, string][] = [
    [L.patient, b.patientName],
    [L.account, b.accountNumber],
    [L.stmt, df(b.statementDate)],
    [L.visit, `${df(b.serviceFrom)} to ${df(b.serviceTo)}`],
  ];
  hdr.forEach(([k, v], i) => {
    text(page, `${k}:`, 40, 136 + i * 16, bold, 10);
    text(page, v, 175, 136 + i * 16, reg, 10);
  });
  const y0 = 225;
  const rowH = 20;
  const cols = b.style.columns === 'date-code-desc-qty-amt'
    ? { date: 40, code: 110, desc: 170, qty: 470, amt: 572 }
    : { code: 40, date: 100, desc: 170, amt: 470, qty: 560 };
  const head = (k: keyof typeof cols, s: string) => (k === 'amt' && b.style.columns === 'date-code-desc-qty-amt' ? right(page, s, cols.amt, y0, bold) : text(page, s, cols[k], y0, bold));
  head('date', 'Date');
  head('code', 'Code');
  head('desc', 'Description');
  head('qty', 'Qty');
  head('amt', 'Amount');
  page.drawLine({ start: { x: 36, y: H - y0 - 6 }, end: { x: 576, y: H - y0 - 6 }, thickness: 0.7, color: rgb(0.5, 0.5, 0.5) });
  const drawn: Drawn = { rows: [] };
  b.lines.forEach((l, i) => {
    const y = y0 + 22 + i * rowH;
    text(page, df(l.date), cols.date, y, reg);
    if (l.code) text(page, l.code, cols.code, y, reg);
    text(page, l.description, cols.desc, y, reg);
    text(page, String(l.units), cols.qty, y, reg);
    if (b.style.columns === 'date-code-desc-qty-amt') right(page, usd(l.chargeUsd), cols.amt, y, reg);
    else text(page, usd(l.chargeUsd), cols.amt, y, reg);
    drawn.rows.push({ x: (36 / W) * 100, y: ((y - 13) / H) * 100, w: (540 / W) * 100, h: (rowH / H) * 100 });
  });
  const yt = y0 + 22 + b.lines.length * rowH + 24;
  const tot: [string, string][] = [
    [L.total, usd(b.totalChargesUsd)],
    [L.paid, `-${usd(b.insurancePaidUsd)}`],
    [L.due, usd(b.amountDueUsd)],
  ];
  tot.forEach(([k, v], i) => {
    text(page, k, 380, yt + i * 18, bold, 10);
    right(page, v, 572, yt + i * 18, i === 2 ? bold : reg, 10);
  });
  text(page, 'SAMPLE document made for testing Arik Health. Fictional patient, hospital and amounts.', 40, 770, reg, 7);
  return { bytes: await doc.save(), drawn };
}

async function renderEob(e: SynthEob, fontName: SynthBill['style']['font']): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([W, H]);
  const { reg, bold } = await fonts(doc, fontName);
  text(page, e.insurer, 40, 50, bold, 15);
  text(page, 'EXPLANATION OF BENEFITS  -  THIS IS NOT A BILL', 40, 74, bold, 11);
  const hdr: [string, string][] = [['Member', e.memberName], ['Claim number', e.claimNumber], ['Provider', e.provider], ['Date of service', formatDate(e.serviceDate, 'MM/DD/YYYY')]];
  hdr.forEach(([k, v], i) => {
    text(page, `${k}:`, 40, 104 + i * 16, bold, 10);
    text(page, v, 160, 104 + i * 16, reg, 10);
  });
  const y0 = 185;
  const heads: [string, number][] = [['Code', 40], ['Service', 92], ['Billed', 330], ['Allowed', 400], ['Plan paid', 470], ['You owe', 545]];
  heads.forEach(([h, x]) => text(page, h, x, y0, bold, 9));
  e.lines.forEach((l, i) => {
    const y = y0 + 20 + i * 18;
    text(page, l.code, 40, y, reg, 9);
    text(page, l.description.slice(0, 38), 92, y, reg, 9);
    [l.billedUsd, l.allowedUsd, l.planPaidUsd, l.youOweUsd].forEach((v, j) => right(page, usd(v), [380, 450, 520, 590][j] - 10, y, reg, 9));
  });
  const yt = y0 + 20 + e.lines.length * 18 + 22;
  text(page, 'Total you owe the provider:', 330, yt, bold, 10);
  right(page, usd(e.totalYouOweUsd), 580, yt, bold, 10);
  text(page, 'SAMPLE document made for testing Arik Health. Fictional member, plan and amounts.', 40, 770, reg, 7);
  return doc.save();
}

async function renderDenial(d: SynthDenial, fontName: SynthBill['style']['font']): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([W, H]);
  const { reg, bold } = await fonts(doc, fontName);
  text(page, d.insurer, 40, 50, bold, 15);
  text(page, formatDate(d.letterDate, 'MM/DD/YYYY'), 40, 90, reg, 10);
  text(page, `Dear ${d.memberName},`, 40, 120, reg, 11);
  const body = [
    `Claim number: ${d.claimNumber}    Date of service: ${formatDate(d.serviceDate, 'MM/DD/YYYY')}`,
    `We reviewed the request for: ${d.service} (code ${d.code}).`,
    'Our decision: we are not able to approve this request.',
    ...(d.reason ? [`Reason: ${d.reason}`] : []),
    ...(d.carc ? [`Reason code: CO-${d.carc}`] : []),
    d.planLine,
    `You have the right to appeal. Your appeal must reach us within ${d.appealDays} days of the date of this letter.`,
    'If we uphold our decision, you may ask for an independent external review.',
  ];
  let y = 150;
  for (const para of body) {
    const words = para.split(' ');
    let line = '';
    for (const w of words) {
      if (reg.widthOfTextAtSize(`${line} ${w}`, 11) > 520) {
        text(page, line.trim(), 40, y, reg, 11);
        y += 16;
        line = '';
      }
      line += ` ${w}`;
    }
    text(page, line.trim(), 40, y, reg, 11);
    y += 26;
  }
  text(page, 'SAMPLE document made for testing Arik Health. Fictional member and plan.', 40, 770, reg, 7);
  return doc.save();
}

async function toPng(pdfBytes: Uint8Array): Promise<Buffer> {
  // pdfjs needs a real path (trailing slash) to its standard fonts, as in
  // lib/documentIntake.ts; without it Courier/Times render as a fallback.
  const standardFontDataUrl = join(process.cwd(), 'node_modules', 'pdfjs-dist', 'standard_fonts').split('\\').join('/') + '/';
  for await (const img of await pdfToImages(Buffer.from(pdfBytes), { scale: 2, docInitParams: { standardFontDataUrl } })) return Buffer.from(img);
  throw new Error('no page rendered');
}

// Scan: grayscale, slightly soft, light speckle; back into an image-only PDF.
async function degradeScan(png: Buffer, seed: number): Promise<Uint8Array> {
  const r = rng(seed);
  const { data, info } = await sharp(png).grayscale().blur(0.6).raw().toBuffer({ resolveWithObject: true });
  for (let i = 0; i < data.length; i += 1) if (r.next() < 0.004) data[i] = r.chance(0.5) ? 0 : 255;
  const img = await sharp(data, { raw: info }).png().toBuffer();
  const doc = await PDFDocument.create();
  const page = doc.addPage([W, H]);
  const embedded = await doc.embedPng(img);
  page.drawImage(embedded, { x: 0, y: 0, width: W, height: H });
  return doc.save();
}

// Photo: tilted on a table, uneven light, soft focus, JPEG.
async function degradePhoto(png: Buffer, seed: number): Promise<Buffer> {
  const r = rng(seed);
  const angle = (r.chance(0.5) ? 1 : -1) * (1 + r.next() * 2.5);
  const meta = await sharp(png).metadata();
  const shadow = Buffer.from(
    `<svg width="${meta.width}" height="${meta.height}"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="${(0.12 + r.next() * 0.18).toFixed(2)}"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/></svg>`,
  );
  return sharp(png)
    .composite([{ input: shadow }])
    .rotate(angle, { background: { r: 120, g: 104, b: 88 } })
    .blur(0.8)
    .modulate({ brightness: 0.92 + r.next() * 0.1 })
    .jpeg({ quality: 72 })
    .toBuffer();
}

async function main() {
  const countArg = process.argv.indexOf('--count');
  const count = countArg > 0 ? Number(process.argv[countArg + 1]) : 20;
  let written = 0;
  for (let seed = 1; seed <= count; seed++) {
    const quality = QUALITIES[seed % 3];
    const bill = makeBill(seed);
    const eob = makeEob(seed);
    const denial = makeDenial(seed);
    const { bytes: billPdf, drawn } = await renderBill(bill);
    const docs: [string, Uint8Array, unknown][] = [
      [bill.id, billPdf, { ...bill, quality, rowBoxes: drawn.rows }],
      [eob.id, await renderEob(eob, bill.style.font), { ...eob, quality }],
      [denial.id, await renderDenial(denial, bill.style.font), { ...denial, quality }],
    ];
    for (const [id, pdfBytes, truth] of docs) {
      let file: string;
      if (quality === 'clean') {
        file = `${id}.clean.pdf`;
        writeFileSync(join(OUT, file), pdfBytes);
      } else if (quality === 'scan') {
        file = `${id}.scan.pdf`;
        writeFileSync(join(OUT, file), await degradeScan(await toPng(pdfBytes), seed));
      } else {
        file = `${id}.photo.jpg`;
        writeFileSync(join(OUT, file), await degradePhoto(await toPng(pdfBytes), seed));
      }
      writeFileSync(join(OUT, `${id}.json`), JSON.stringify({ file, ...(truth as object) }, null, 2));
      written++;
    }
  }
  console.log(`synthetic documents: ${written} written to .data/synth`);
}

main().catch((e) => {
  console.error(`FAIL: ${(e as Error).message}`);
  process.exit(1);
});
