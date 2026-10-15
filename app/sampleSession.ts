'use client';

// This tab's sample session id (DEMO_DAY stage 1). It lives in
// sessionStorage only: refreshing and moving between pages keep it, and
// closing the tab ends it, so reopening the demo gives fresh sample copies.
// If storage is blocked (private mode), one id per page load is used.
const KEY = 'arik-sample-session';
let fallback: string | null = null;

export function sampleSessionId(): string {
  try {
    const existing = sessionStorage.getItem(KEY);
    if (existing) return existing;
    const id = crypto.randomUUID();
    sessionStorage.setItem(KEY, id);
    return id;
  } catch {
    fallback ??= crypto.randomUUID();
    return fallback;
  }
}
