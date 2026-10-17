// SYNTHETIC replies, one or more per classification: what a practice
// inbound fax delivers, and what scripts/test_replies.ts reads. Fictional
// plans, people and numbers only.

import type { ReplyKind } from './replies';

const FOOT = 'SAMPLE reply made for testing Arik Health. Fictional member and plan.';

export const SYNTHETIC_REPLIES: Record<Exclude<ReplyKind, 'unknown'>, string[]> = {
  approved: [
    `Bluefin Health Plan\nRe: your appeal\nWe have reviewed your appeal. We have overturned our decision and will cover the MRI of the knee. Your claim will be reprocessed.\n${FOOT}`,
    `Northwind Care Plan\nGood news: your request has been approved. We will pay for this service under your plan.\n${FOOT}`,
    `Pinecrest Valley Hospital\nAfter review we are reversing the denial on your account and will process payment with your plan.\n${FOOT}`,
  ],
  denied_again: [
    `Lantern Mutual Health\nWe reviewed your appeal and upheld our decision. The service is still not covered under your plan.\nYou may ask for an external review.\n${FOOT}`,
    `Meridian Oak Insurance\nAfter a second review, your request is not approved. We affirm our denial.\n${FOOT}`,
  ],
  info_requested: [
    `Bluefin Health Plan\nWe need additional information to decide your appeal. Please send copies of your medical records and a letter of medical necessity from your doctor within 30 days.\n${FOOT}`,
    `Willowmere Regional Hospital\nWe cannot complete your review until we receive a copy of your insurance card. Please provide the following: front and back of your card.\n${FOOT}`,
  ],
  collections_notice: [
    `Ridgeline Recovery Services\nThis is an attempt to collect a debt. Your account from Copper Ridge Community Hospital has been placed with our collection agency.\n${FOOT}`,
    `Harborlight General Hospital\nYour past due balance has been referred to a collection agency.\n${FOOT}`,
  ],
  corrected_bill: [
    `Saint Brigid Sample Medical Center\nCorrected statement\nWe have removed the duplicate charge you asked about. Your new balance is shown below.\n${FOOT}`,
    `Pinecrest Valley Hospital\nWe reviewed your account and adjusted the balance. A revised statement is enclosed.\n${FOOT}`,
  ],
};

export const SYNTHETIC_UNKNOWN = `Bluefin Health Plan\nThank you for contacting us. Our office hours are changing next month.\n${FOOT}`;
