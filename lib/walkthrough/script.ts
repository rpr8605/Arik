// Demo walkthroughs (docs/kimi/DEMO_WALKTHROUGHS.md): every starter plays
// a fixed script, end to end. No model calls, nothing uploaded, nothing
// sent. Each flow is data (lib/walkthrough/flows/*); app/walk plays it.
// Pure; tested by scripts/test_walkthroughs.ts.

import type { SampleKey } from '../demo/samples';

// Coral = looks wrong, amber = worth asking about.
export type Tone = 'wrong' | 'ask';

// Percentages of the document image, so boxes scale with it.
export interface Highlight {
  n: number;
  x: number;
  y: number;
  w: number;
  h: number;
  tone: Tone;
}

export interface Chip {
  label: string;
  go: string; // sequence id
}

export type Step =
  | { kind: 'arik'; text: string }
  | { kind: 'chips'; options: Chip[] }
  // Asks for a document: the sample picker (or fake camera), limited to these.
  | { kind: 'pick'; text: string; docs: string[]; go: string }
  | { kind: 'reading'; docId: string | null; lines: string[] }
  | { kind: 'doc'; docId: string; highlights: Highlight[] }
  // "Here's what I read", then a one-tap confirm.
  | { kind: 'summary'; rows: [string, string][]; confirm: string; go: string }
  | { kind: 'finding'; n: number; text: string; amountUsd: number | null; tone: Tone }
  // "{total}" is replaced by the sum of this sequence's findings.
  | { kind: 'total'; text: string }
  | { kind: 'letter'; letterId: string }
  | { kind: 'send'; letterId: string }
  | { kind: 'deadline'; label: string; date: string }
  | { kind: 'job'; title: string; status: string; flow: FlowId }
  // Flow 1: real sourced prices from the database, then the call card.
  | { kind: 'rx_results'; drug: string }
  | { kind: 'call_card'; drug: string }
  | { kind: 'end' };

export type FlowId = 'bill' | 'denial' | 'rx';

export interface Script {
  id: FlowId;
  patient: SampleKey;
  title: string;
  start: string;
  sequences: Record<string, Step[]>;
}

export const END_NOTE = "This is a demo walkthrough with sample documents. Here's how Arik will handle yours.";
export const TYPED_REPLY =
  'In this walkthrough, tap one of the options below. For a real conversation, start a chat from the home screen.';

export function formatUsd(n: number): string {
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 })}`;
}

// The findings total always equals the sum of the findings shown.
export function findingsTotal(steps: Step[]): number {
  return steps.reduce((sum, s) => (s.kind === 'finding' && s.amountUsd ? sum + s.amountUsd : sum), 0);
}

export function renderTotal(text: string, steps: Step[]): string {
  return text.replace('{total}', formatUsd(findingsTotal(steps)));
}

// Structural checks every script must pass: every jump lands on a real
// sequence, every highlight has its finding, boxes stay on the page.
export function validateScript(s: Script): string[] {
  const problems: string[] = [];
  if (!s.sequences[s.start]) problems.push(`start "${s.start}" missing`);
  for (const [id, steps] of Object.entries(s.sequences)) {
    for (const step of steps) {
      const targets =
        step.kind === 'chips' ? step.options.map((o) => o.go) : step.kind === 'pick' || step.kind === 'summary' ? [step.go] : [];
      for (const t of targets) if (!s.sequences[t]) problems.push(`${id}: jump to missing "${t}"`);
      if (step.kind === 'doc') {
        for (const h of step.highlights) {
          if (h.x < 0 || h.y < 0 || h.x + h.w > 100 || h.y + h.h > 100) problems.push(`${id}: box ${h.n} off the page`);
        }
      }
    }
    const boxes = steps.flatMap((st) => (st.kind === 'doc' ? st.highlights.map((h) => h.n) : []));
    const found = steps.flatMap((st) => (st.kind === 'finding' ? [st.n] : []));
    for (const n of boxes) if (!found.includes(n)) problems.push(`${id}: box ${n} has no finding`);
  }
  return problems;
}
