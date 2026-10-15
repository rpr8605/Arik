'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { availableSampleDocs, cameraDoc, type SampleDoc } from '@/lib/demo/sampleDocs';
import { DocumentUpload } from './DocumentUpload';

// The "+" sheet next to the reply box (owner request 2026-10-15; replaces
// the "Add a document" card). Outside DEMO_MODE it holds the real upload,
// unchanged. In DEMO_MODE it looks like a phone photo library titled
// "Sample documents" and only offers the fictional sample documents: the
// real file picker and camera are never opened, nothing is uploaded and
// nothing is stored. "Take a photo" shows a fake camera view whose shutter
// picks the sample bill in frame.
export function AttachSheet({
  caseId,
  demoMode,
  onClose,
  only,
  onPick,
}: {
  caseId: string | null;
  demoMode: boolean;
  onClose: () => void;
  // Walkthrough "pick" steps: limit to these documents and hand the pick
  // back instead of navigating.
  only?: string[];
  onPick?: (doc: SampleDoc) => void;
}) {
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-label={demoMode ? 'Sample documents' : 'Add a document'}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sheet-grip" aria-hidden="true" />
        {demoMode || !caseId ? (
          <DemoLibrary onClose={onClose} only={only} onPick={onPick} />
        ) : (
          <RealUpload caseId={caseId} onClose={onClose} />
        )}
      </div>
    </div>
  );
}

function RealUpload({ caseId, onClose }: { caseId: string; onClose: () => void }) {
  return (
    <>
      <div className="sheet-head">
        <h2>Add a document</h2>
        <button type="button" onClick={onClose}>Done</button>
      </div>
      <DocumentUpload caseId={caseId} />
    </>
  );
}

function DemoLibrary({ onClose, only, onPick }: { onClose: () => void; only?: string[]; onPick?: (doc: SampleDoc) => void }) {
  const [camera, setCamera] = useState(false);
  const [scanning, setScanning] = useState<SampleDoc | null>(null);
  const router = useRouter();
  const docs = availableSampleDocs().filter((d) => !only || only.includes(d.id));
  const inFrame = cameraDoc(docs) ?? docs[0] ?? null;

  function pick(doc: SampleDoc) {
    if (onPick) {
      onPick(doc);
      onClose();
      return;
    }
    // Scanning animation, then into the right walkthrough. No upload.
    setScanning(doc);
    setTimeout(() => {
      if (doc.flow) router.push(doc.flow);
      onClose();
    }, 1600);
  }

  if (scanning) {
    return (
      <div className="scan" role="status" aria-live="polite">
        <div className="scan-doc">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {scanning.image ? <img src={scanning.image} alt="" /> : null}
          <div className="scan-line" aria-hidden="true" />
        </div>
        <p>Reading {scanning.title}…</p>
      </div>
    );
  }

  if (camera) {
    return (
      <div className="fake-camera">
        <div className="sheet-head">
          <h2>Take a photo</h2>
          <button type="button" onClick={() => setCamera(false)}>Back</button>
        </div>
        <div className="viewfinder" aria-label={inFrame ? `Camera view showing ${inFrame.title}` : 'Camera view'}>
          {inFrame?.image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={inFrame.image} alt="" />
          ) : (
            <p>Point the camera at your document.</p>
          )}
          <div className="viewfinder-frame" aria-hidden="true" />
        </div>
        <button
          type="button"
          className="shutter"
          aria-label="Take the photo"
          disabled={!inFrame}
          onClick={() => inFrame && pick(inFrame)}
        />
      </div>
    );
  }

  return (
    <>
      <div className="sheet-head">
        <h2>Sample documents</h2>
        <button type="button" onClick={onClose}>Done</button>
      </div>
      <button type="button" className="camera-row" onClick={() => setCamera(true)}>
        Take a photo
      </button>
      {docs.length > 0 ? (
        <div className="doc-grid">
          {docs.map((d) => (
            <button key={d.id} type="button" className="doc-thumb" onClick={() => pick(d)}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={d.image!} alt="" />
              <span className="tag">SAMPLE</span>
              <span className="doc-title">{d.title}</span>
            </button>
          ))}
        </div>
      ) : (
        <p className="lede">
          No sample documents here.
        </p>
      )}
      <p className="sheet-note">This is a demo: only made-up sample documents are shown, and nothing is uploaded.</p>
    </>
  );
}
