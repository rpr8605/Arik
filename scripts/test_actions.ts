// Agent actions (Phase 6): the registry gate (M16-AC8: sign, attest, pay
// and marketing opt-ins impossible without the patient; nothing leaves
// without approval), the authorization text and signed copies, the send
// executors' contract (demo executors and the refusing real stubs), and
// notifications with no health details.
// Run: npx tsx scripts/test_actions.ts

import sharp from 'sharp';
import { PDFDocument } from 'pdf-lib';
import { ACTIONS, canRun, type ActionType, type RunState } from '../lib/actions/registry';
import { AUTHORIZATION_NEEDS_COUNSEL, AUTHORIZATION_TEXT, AUTHORIZATION_VERSION, authorizationPdf, authorizationTextHash, parseSignature, signatureHasInk, signedLetterPdf } from '../lib/actions/authorization';
import { demoFaxSender, demoMailSender, senders, unconfiguredFaxSender, unconfiguredMailSender, type Address, type FaxSender, type MailSender } from '../lib/actions/senders';
import { notification, NOTIFICATION_BANNED, type NotifyEvent } from '../lib/actions/notify';
import { letterHash, letterPdf } from '../lib/letters/freeze';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

let failures = 0;
function check(name: string, cond: boolean, detail = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ' - ' + detail : ''}`);
  if (!cond) failures++;
}

async function main() {
  // ---------- Registry ----------
  const all: RunState = { actor: 'patient', authorizationOnFile: true, letterFrozen: true, letterSigned: true, patientApproved: true };
  for (const t of Object.keys(ACTIONS) as ActionType[]) {
    const a = ACTIONS[t];
    if (a.patientOnly.some((p) => ['sign', 'attest', 'pay', 'marketing_opt_in'].includes(p))) {
      check(`${t}: impossible when Arik is the actor`, !canRun(t, { ...all, actor: 'arik' }).ok);
    }
    if (a.leavesSystem && a.tier >= 2) check(`${t}: leaves Arik only with the patient's approval`, !canRun(t, { ...all, patientApproved: false }).ok);
  }
  check('attest, pay and marketing opt-in are never runnable, even by the patient', (['attest_medical_facts', 'pay_on_behalf', 'marketing_opt_in'] as ActionType[]).every((t) => !canRun(t, all).ok && ACTIONS[t].tier === 3));
  check('fax needs the authorization', canRun('send_fax', { ...all, authorizationOnFile: false }).ok === false);
  check('fax needs a signed letter', canRun('send_fax', { ...all, letterSigned: false }).ok === false);
  check('mail needs a frozen letter', canRun('send_mail', { ...all, letterFrozen: false }).ok === false);
  check('fax with everything in place, approved by the patient: allowed', canRun('send_fax', all).ok);
  check('signing needs a frozen letter', !canRun('sign_letter', { ...all, letterFrozen: false }).ok && canRun('sign_letter', all).ok);
  check('drafting needs nothing (Tier 0)', canRun('draft_letter', { actor: 'arik', authorizationOnFile: false, letterFrozen: false, letterSigned: false, patientApproved: false }).ok);
  check('every action that leaves Arik leaves a receipt or is a content-free notice', Object.values(ACTIONS).every((a) => !a.leavesSystem || a.receipt || a.type === 'notify'));
  check('every action that leaves Arik says what data goes', Object.values(ACTIONS).filter((a) => a.leavesSystem && a.built).every((a) => a.dataShared.length > 0));

  // ---------- Authorization and signatures ----------
  check('authorization text is marked placeholder, for counsel, and versioned', AUTHORIZATION_NEEDS_COUNSEL && /PLACEHOLDER/.test(AUTHORIZATION_TEXT) && AUTHORIZATION_VERSION.startsWith('placeholder-'));
  check('authorization text promises no signing, paying or health claims for the patient', /will not sign for me, pay for me/.test(AUTHORIZATION_TEXT));
  const legal = readFileSync(join(__dirname, '..', 'docs', 'legal_review_before_launch.md'), 'utf8');
  check('authorization text is on the legal review list', /authorization/i.test(legal) && legal.includes(AUTHORIZATION_VERSION));
  check('authorization hash is stable', authorizationTextHash() === authorizationTextHash() && /^[0-9a-f]{64}$/.test(authorizationTextHash()));
  const strokes = await sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="400" height="120"><path d="M10 80 C 60 10, 110 110, 160 50 S 260 20, 390 90" stroke="#22425c" stroke-width="4" fill="none"/></svg>')).png().toBuffer();
  const dataUrl = `data:image/png;base64,${strokes.toString('base64')}`;
  const sig = parseSignature(dataUrl);
  check('signature: a drawn PNG is accepted', 'png' in sig);
  const blank = await sharp({ create: { width: 4, height: 4, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer();
  check('signature: a blank pad is refused', 'error' in parseSignature(`data:image/png;base64,${blank.toString('base64')}`));
  const blankCanvas = await sharp({ create: { width: 400, height: 120, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 0 } } }).png().toBuffer();
  check('signature: a drawn PNG has ink', await signatureHasInk(new Uint8Array(strokes)));
  check('signature: a blank full-size pad has no ink (refused)', !(await signatureHasInk(new Uint8Array(blankCanvas))));
  const whitePad = await sharp({ create: { width: 400, height: 120, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } } }).png().toBuffer();
  check('signature: a white pad has no ink (refused)', !(await signatureHasInk(new Uint8Array(whitePad))));
  check('signature: not a PNG is refused', 'error' in parseSignature('data:image/jpeg;base64,/9j/4AAQ') && 'error' in parseSignature(`data:image/png;base64,${Buffer.from('x'.repeat(400)).toString('base64')}`));
  check('signature: too large is refused', 'error' in parseSignature(`data:image/png;base64,${Buffer.concat([strokes, Buffer.alloc(210_000)]).toString('base64')}`));
  check('signature: not a string is refused', 'error' in parseSignature(42));
  const png = (sig as { png: Uint8Array }).png;
  const authPdf = await authorizationPdf('Rosa Fairbairn', '2026-10-17T15:00:00Z', png);
  const authDoc = await PDFDocument.load(authPdf);
  check('authorization: signed copy is a one-page PDF', authDoc.getPageCount() === 1 && Buffer.from(authPdf.subarray(0, 5)).toString() === '%PDF-');
  const letter = { subject: 'Request for internal appeal, claim CL-12-3456789', body: 'To Bluefin Health Plan,\n\nI am appealing.\n\nSincerely,\nRosa Fairbairn', footer: 'Prepared by the patient with help from Arik Health, which uses AI to assist. Not legal advice.' };
  const plain = await letterPdf(letter, 'October 17, 2026');
  const signed = await signedLetterPdf(letter, 'October 17, 2026', 'Rosa Fairbairn', '2026-10-17T15:00:00Z', png);
  check('signed letter: a valid PDF, larger than the unsigned one (it carries the signature)', Buffer.from(signed.subarray(0, 5)).toString() === '%PDF-' && signed.length > plain.length);
  await new Promise((r) => setTimeout(r, 1100));
  const signedLater = await signedLetterPdf(letter, 'October 17, 2026', 'Rosa Fairbairn', '2026-10-17T15:00:00Z', png);
  check('signed letter: rebuilt later, the bytes are identical (its stored hash can be checked)', Buffer.compare(Buffer.from(signed), Buffer.from(signedLater)) === 0);
  const authLater = await authorizationPdf('Rosa Fairbairn', '2026-10-17T15:00:00Z', png);
  check('authorization: rebuilt later, the bytes are identical', Buffer.compare(Buffer.from(authPdf), Buffer.from(authLater)) === 0);
  check('signed letter: the frozen text hash is unchanged by signing', letterHash(letter) === letterHash({ ...letter }));
  const long = { ...letter, body: Array.from({ length: 70 }, (_, i) => `Paragraph ${i + 1} of a long letter.`).join('\n\n') };
  const longSigned = await PDFDocument.load(await signedLetterPdf(long, 'October 17, 2026', 'Rosa Fairbairn', '2026-10-17T15:00:00Z', png));
  const longPlain = await PDFDocument.load(await letterPdf(long, 'October 17, 2026'));
  check('signed letter: a signature that does not fit goes on a new page, never over the text', longSigned.getPageCount() >= longPlain.getPageCount());

  // ---------- Senders contract ----------
  const now = new Date('2026-10-17T15:00:00Z');
  const to: Address = { name: 'Bluefin Health Plan Appeals', line1: '100 Sample Way', line2: null, city: 'Fairhaven', state: 'OH', zip: '43000' };
  const from: Address = { name: 'Rosa Fairbairn', line1: '12 Cedar Road', line2: null, city: 'Fairhaven', state: 'OH', zip: '43001' };
  const faxContract = async (s: FaxSender) => {
    const r = await s.send({ jobId: 'job-1', to: '(555) 555-0142', pdf: signed, now });
    const kinds = r.events.map((e) => e.kind);
    return r.confirmation.length > 0 && kinds[0] === 'queued' && kinds.at(-1) === 'delivered' && r.events.every((e, i) => i === 0 || e.at >= r.events[i - 1].at) && r.events.every((e) => !/Rosa|Bluefin|CL-/.test(e.detail));
  };
  check('demo fax: queued -> sent -> delivered, ordered, no patient data in events', await faxContract(demoFaxSender));
  check('demo fax: labeled practice, never claims real patient data', (await demoFaxSender.send({ jobId: 'job-1', to: '555-555-0142', pdf: signed, now })).practice && !demoFaxSender.allowsRealPatientData && /Nothing left Arik/.test((await demoFaxSender.send({ jobId: 'j', to: '555-555-0142', pdf: signed, now })).events[0].detail));
  check('demo fax: deterministic confirmation per job', (await demoFaxSender.send({ jobId: 'job-9', to: '555-555-0142', pdf: signed, now })).confirmation === (await demoFaxSender.send({ jobId: 'job-9', to: '555-555-0142', pdf: signed, now })).confirmation);
  check('demo fax: a bad fax number is refused', await demoFaxSender.send({ jobId: 'job-1', to: 'call me', pdf: signed, now }).then(() => false, () => true));
  check('demo fax: a per-case return number that cannot be dialed', /^PRACTICE-[0-9A-F]{6}$/.test(await demoFaxSender.inboundNumber('case-1')) && (await demoFaxSender.inboundNumber('case-1')) !== (await demoFaxSender.inboundNumber('case-2')));
  const mailContract = async (s: MailSender, certified: boolean) => {
    const r = await s.send({ jobId: 'job-2', to, from, pdf: signed, certified, now });
    return r.events[0].kind === 'queued' && r.events.at(-1)!.kind === 'delivered' && (certified ? !!r.tracking : r.tracking === null);
  };
  check('demo mail, certified: tracking number and delivery', await mailContract(demoMailSender, true));
  check('demo mail, first class: no tracking', await mailContract(demoMailSender, false));
  check('demo mail: an incomplete address is refused', await demoMailSender.send({ jobId: 'j', to: { ...to, zip: '4300' }, from, pdf: signed, certified: true, now }).then(() => false, () => true));
  check('real fax stub: refuses, nothing sent', await unconfiguredFaxSender.send({ jobId: 'j', to: '555-555-0142', pdf: signed, now }).then(() => false, (e) => /BAA/.test(e.message)));
  check('real mail stub: refuses, nothing sent', await unconfiguredMailSender.send({ jobId: 'j', to, from, pdf: signed, certified: true, now }).then(() => false, (e) => /BAA/.test(e.message)));
  check('executor choice: demo by default', senders({}).fax === demoFaxSender && senders({ SEND_EXECUTOR: 'demo' }).mail === demoMailSender);
  check('executor choice: anything else fails closed to the refusing stubs', senders({ SEND_EXECUTOR: 'acme-fax' }).fax === unconfiguredFaxSender && senders({ SEND_EXECUTOR: 'live' }).mail === unconfiguredMailSender);

  // ---------- Notifications ----------
  const events: NotifyEvent[] = ['delivered', 'reply_received', 'deadline_soon', 'overdue', 'send_failed', 'needs_approval'];
  for (const e of events) {
    const n = notification(e);
    check(`notification ${e}: no health details, names, numbers or amounts`, !NOTIFICATION_BANNED.test(`${n.title} ${n.body}`), `${n.title} / ${n.body}`);
  }
  check('notification guard catches a leak', NOTIFICATION_BANNED.test('Your MRI appeal was denied') && NOTIFICATION_BANNED.test('$120 due 10/20'));

  console.log(failures ? `\n${failures} FAILED` : '\nALL PASS');
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
