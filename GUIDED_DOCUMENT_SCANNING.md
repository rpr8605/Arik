# Arik: Guided Document Scanning

Extends UI_UX.md's "camera-first document capture" principle into a full
build spec. This is the guided walkthrough for turning a bill, EOB, or
denial letter sitting on a table into something the extraction pipeline
can actually use.

## The key simplification: no separate OCR/scanning service needed

The extraction tier (Claude Haiku 4.5, per HANDOFF.md's locked model
routing) accepts images as direct input. A captured photo goes straight
to the same Task 1 extraction call already built for document processing
- no OCR SaaS, no separate computer-vision document API, no added
per-scan licensing cost. The thing worth building is entirely on the
capture side: making sure the photo that reaches the model is actually
usable, since a bad photo produces bad extraction no matter how good the
model is.

## The guided flow

1. Patient taps "Add a document" from within a case
2. Brief instruction before the camera opens: "lay it flat, good light,
   fit the whole page in the frame" - one line, not a tutorial
3. Camera view opens with an on-screen guide rectangle showing where the
   document should sit
4. **Live quality check runs before the capture is accepted** (see
   below) - if it fails, specific feedback, not a generic error:
   "too blurry, hold steady" / "glare on the page, tilt away from the
   light" / "top edge is cut off, back up a little"
5. Patient confirms once quality passes
6. "Add another page?" prompt for multi-page bills, before finalizing
7. Upload to the case's `uploaded_documents`, `case_id` attached, queued
   for extraction

## Quality checks - all doable client-side, free, no paid CV library

- **Blur detection**: variance-of-Laplacian on a downsampled grayscale
  version of the frame - a classic, lightweight technique, computable in
  plain JavaScript/Canvas without any external library. Low variance =
  blurry, prompt a retake.
- **Glare/exposure check**: histogram analysis on the captured frame -
  a cluster of blown-out (near-white) pixels concentrated in one region
  flags glare; an overall very dark histogram flags poor lighting.
  Same Canvas-based approach, no library needed.
- **Framing check**: rather than real edge-detection computer vision
  (heavier, needs a real CV library like OpenCV.js), use the on-screen
  guide rectangle itself as the framing mechanism - the patient aligns
  the document to the guide, which is simpler to build and matches the
  "doesn't need to be perfect" tolerance already set for voice input in
  ACCESSIBILITY.md. Revisit true edge-detection later only if guide-based
  framing proves insufficient in practice.

None of these checks need to be perfect - they need to catch the clearly
bad captures (unreadable blur, blown-out glare, obviously cut off) before
a failed extraction wastes a model call and the patient's time.

## Capture mechanics

- **Cheapest starting point**: `<input type="file" accept="image/*" capture="environment">` triggers the phone's native camera app directly -
  zero custom camera code, but no live quality feedback since it's the
  OS's own camera UI, not a controlled view.
- **The guided version** (what steps 3-4 above require) needs a custom
  camera view via `getUserMedia` + a `<canvas>` for frame analysis -
  more building, but enables the live guide rectangle and real-time
  quality feedback described above. This is the version worth building
  for the actual guided-walkthrough experience being asked for here,
  not the plain file-input fallback.
- Multi-page documents get captured as separate images tied to the same
  logical upload, not stitched into one image - simpler and matches how
  `uploaded_documents` already models one row per file.

## What this means for the build

- No schema changes needed - `uploaded_documents` already supports this
  exactly as built
- New frontend component: a guided capture view (camera + canvas overlay
  + quality-check logic), separate from the existing chat UI components
- Ties into UI_UX.md's existing camera-first requirement - this doc is
  the detailed implementation spec for that principle, not a new
  requirement
- Genuinely buildable in the document-upload/bill-auditor track (Phase
  1.5) alongside the rest of that work, not a separate phase
