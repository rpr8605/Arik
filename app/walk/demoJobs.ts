'use client';

// What a visitor did in the demo walkthroughs: jobs, receipts and letters
// added to a sample patient's history. sessionStorage only, like the
// sample session id: closing the tab resets it, nothing reaches a server.

export interface DemoReceipt {
  ref: string;
  title: string; // letter or action title
  to: string;
  method: string;
  date: string;
  status: string; // "Demo, not sent" / "Coming soon, not sent"
}

export interface DemoJob {
  id: string;
  patient: string;
  title: string;
  status: string;
  flow: string;
  date: string;
  receipts: DemoReceipt[];
}

const KEY = 'arik-demo-jobs';

function read(): DemoJob[] {
  try {
    return JSON.parse(sessionStorage.getItem(KEY) ?? '[]') as DemoJob[];
  } catch {
    return [];
  }
}
function write(jobs: DemoJob[]) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(jobs));
  } catch {
    // storage blocked: the walkthrough still works, history just isn't kept
  }
}

export function demoJobsFor(patient: string): DemoJob[] {
  return read().filter((j) => j.patient === patient);
}

export function addDemoJob(job: Omit<DemoJob, 'id' | 'date'>): DemoJob {
  const full: DemoJob = { ...job, id: crypto.randomUUID(), date: new Date().toISOString() };
  write([full, ...read()]);
  return full;
}

export function clearDemoJobs() {
  write([]);
}

export function newRef(prefix = 'ARK'): string {
  const n = Math.floor(100000 + Math.random() * 900000);
  return `${prefix}-${n}`;
}
