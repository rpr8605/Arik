'use client';

import { useRef, useState } from 'react';
import { supabaseBrowser } from '@/lib/supabaseBrowser';

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
  const cameraRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function upload(file: File) {
    setBusy(true);
    setError(null);
    setResult(null);
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
      if (!res.ok) throw new Error(json.error ?? `upload failed (${res.status})`);
      const parts = [
        `Read as ${json.document.doc_type.replaceAll('_', ' ')}`,
        json.extraction?.institution_name ? `from ${json.extraction.institution_name}` : null,
        json.extraction?.total_amount_usd != null
          ? `patient amount $${json.extraction.total_amount_usd}`
          : null,
        (json.corrections ?? []).length > 0 ? 'correction pending in the thread above' : null,
      ].filter(Boolean);
      setResult(parts.join('. '));
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
    </section>
  );
}
