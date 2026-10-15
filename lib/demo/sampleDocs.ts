// Demo document picker contents (DEMO_DAY.md, added 2026-10-15). In
// DEMO_MODE, "+" in the chat opens a "Sample documents" sheet that only
// ever shows these fictional documents; the real file picker and camera
// are never opened, nothing is uploaded and nothing is written to storage.
//
// A document shows only once its image exists (image !== null). The
// images and their flows are added in stage 3 (Luis's bills) and stage 4
// (Tasha's denial); until then they stay hidden, never broken.
// Pure; tested by scripts/test_demo_samples.ts.

export interface SampleDoc {
  id: string;
  title: string;
  owner: 'luis' | 'tasha' | 'any';
  kind: 'hospital_bill' | 'doctor_bill' | 'denial_letter' | 'eob' | 'pharmacy_receipt' | 'insurance_card';
  // Path under /public, or null until the document is made.
  image: string | null;
  // Where picking it leads (the bill review or denial walkthrough).
  flow: string | null;
}

export const SAMPLE_DOCS: SampleDoc[] = [
  { id: 'luis-hospital-bill', title: 'Luis: hospital bill', owner: 'luis', kind: 'hospital_bill', image: null, flow: null },
  { id: 'luis-doctor-bill', title: 'Luis: doctor bill', owner: 'luis', kind: 'doctor_bill', image: null, flow: null },
  { id: 'tasha-denial-letter', title: 'Tasha: denial letter', owner: 'tasha', kind: 'denial_letter', image: null, flow: null },
  { id: 'tasha-eob', title: 'Tasha: explanation of benefits', owner: 'tasha', kind: 'eob', image: null, flow: null },
  { id: 'sample-pharmacy-receipt', title: 'Pharmacy receipt', owner: 'any', kind: 'pharmacy_receipt', image: null, flow: null },
  { id: 'sample-insurance-card', title: 'Insurance card', owner: 'any', kind: 'insurance_card', image: null, flow: null },
];

// Only documents that exist and lead somewhere are shown.
export function availableSampleDocs(docs: SampleDoc[] = SAMPLE_DOCS): SampleDoc[] {
  return docs.filter((d) => d.image !== null && d.flow !== null);
}

// The document the fake camera "sees": the first available bill.
export function cameraDoc(docs: SampleDoc[] = SAMPLE_DOCS): SampleDoc | null {
  return availableSampleDocs(docs).find((d) => d.kind === 'hospital_bill' || d.kind === 'doctor_bill') ?? null;
}

export const DEMO_UPLOAD_REFUSAL = 'Uploads are off in the demo. Tap + and pick a sample document instead.';
