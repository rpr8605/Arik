'use client';

import { useRef, useState } from 'react';
import { supabaseBrowser } from '@/lib/supabaseBrowser';
import type { ExtractedDocument } from '@/lib/production/types';
import { BillReview } from './BillReview';

// Document types in plain words (never the internal type name).
const DOC_WORDS: Record<string, string> = {
  itemized_bill: 'an itemized bill',
  eob: 'an explanation of benefits',
  denial_letter: 'a denial letter',
  insurance_card: 'an insurance card',
  spd: 'a plan document',
  other: 'a document',
};

// Both intake paths from one entry point (MULTI_FORMAT_UPLOAD.md):
// "Take a photo" (the cheapest camera path - the OS camera app via the
// capture attribute; the guided live-quality camera overlay from
// GUIDED_DOCUMENT_SCANNING.md is a later frontend increment on this same
// endpoint) and "Choose a file" (PDF/PNG/JPEG/HEIC, 25MB max). Both post
// to the same pipeline; the patient never has to know which kind of PDF
// they have or convert HEIC themselves.
export function DocumentUpload({ caseId }: { caseId: string }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // A bill read line by line on the server: the patient checks it next.
  const [review, setReview] = useState<{ documentId: string; reading: ExtractedDocument } | null>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function upload(file: File) {
    setBusy(true);
    setError(null);
    setResult(null);
    setReview(null);
    try {
      const {
        data: { session },
      } = await supabaseBrowser().auth.getSession();
      const form = new FormData();
      form.append('file', file);
      const res = await fetch(`/api/cases/${caseId}/documents`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${session?.access_token ?? ''}` },
        body: form,
      });
      const json = await res.json();
      if (!res.ok) {
        throw new Error(
          res.status === 413
            ? 'That file is too big. The limit is 25MB.'
            : res.status === 415
              ? 'Arik can read PDFs and photos. Try one of those.'
              : (res.status === 429 || res.status === 503) && json.error
                ? json.error
                : "Arik couldn't read that file. Try again or try a clearer photo.",
        );
      }
      const parts = [
        `Arik read this as ${DOC_WORDS[json.document.doc_type] ?? 'a document'}`,
        json.extraction?.institution_name ? `from ${json.extraction.institution_name}` : null,
        json.extraction?.total_amount_usd != null
          ? `showing $${json.extraction.total_amount_usd} for you to pay`
          : null,
        (json.corrections ?? []).length > 0 ? 'Arik has a question for you in the chat' : null,
      ].filter(Boolean);
      setResult(parts.join('. '));
      const layout = json.extraction?.layout as ExtractedDocument | undefined;
      if (layout && json.document.doc_type === 'itemized_bill' && layout.lines.length) setReview({ documentId: json.document.id, reading: layout });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      if (cameraRef.current) cameraRef.current.value = '';
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  return (
    <section aria-label="Add a document" style={{ marginBottom: '1rem' }}>
      <strong>Add a document:</strong>{' '}
      <label htmlFor="camera-capture" style={{ textDecoration: 'underline', cursor: 'pointer' }}>
        Take a photo
      </label>
      <input
        id="camera-capture"
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        style={{ display: 'none' }}
        disabled={busy}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) upload(f);
        }}
      />{' '}
      or{' '}
      <label htmlFor="file-upload" style={{ textDecoration: 'underline', cursor: 'pointer' }}>
        choose a file
      </label>
      <input
        id="file-upload"
        ref={fileRef}
        type="file"
        accept=".pdf,.png,.jpg,.jpeg,.heic,.heif"
        style={{ display: 'none' }}
        disabled={busy}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) upload(f);
        }}
      />
      <span> (PDF, photo, or screenshot, up to 25MB)</span>
      {busy && <p>Reading your document…</p>}
      {result && (
        <p role="status">
          {result}. The original file auto-deletes within 48 hours; what Arik read from it stays
          with the case.
        </p>
      )}
      {error && <p role="alert">{error}</p>}
      {review && <BillReview caseId={caseId} documentId={review.documentId} reading={review.reading} />}
    </section>
  );
}
