// Notification words (Phase 6). Pure. A notification can be seen on a
// lock screen or in a shared inbox, so it carries no health details: no
// names, amounts, dates, plan or provider names, drugs, services or case
// details. Just that something changed and where to look. No delivery
// channel is wired yet (an email or SMS vendor is a later decision).

export type NotifyEvent = 'delivered' | 'reply_received' | 'deadline_soon' | 'overdue' | 'send_failed' | 'needs_approval';

const TEXT: Record<NotifyEvent, { title: string; body: string }> = {
  delivered: { title: 'Update from Arik', body: 'Something you sent was delivered. Open Arik for details.' },
  reply_received: { title: 'Update from Arik', body: 'A reply arrived on one of your cases. Open Arik to see it.' },
  deadline_soon: { title: 'Reminder from Arik', body: 'Something in Arik needs your attention soon. Open Arik for details.' },
  overdue: { title: 'Reminder from Arik', body: 'Something Arik is watching for has not arrived yet. Open Arik for details.' },
  send_failed: { title: 'Update from Arik', body: 'Something you sent did not go through. Open Arik to try again.' },
  needs_approval: { title: 'Arik needs you', body: 'A next step is ready for your approval. Open Arik to review it.' },
};

export function notification(event: NotifyEvent): { title: string; body: string } {
  return TEXT[event];
}

// What a notification may never contain (the test runs every event through it).
export const NOTIFICATION_BANNED = /\d|\$|%|@|\b(?:medicare|medicaid|insurance|plan|hospital|doctor|clinic|pharmacy|drug|prescription|diagnos\w*|treatment|surgery|therapy|cancer|diabetes|pregnan\w*|mental|hiv|denied|denial|appeal|bill(?:ed|ing)?|collections?|debt|mri|ct|scan|lab)\b/i;
