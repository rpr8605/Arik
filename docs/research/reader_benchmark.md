# Document reader benchmark (2026-10-16)

Synthetic documents only (`.data/synth`, made by `scripts/synth_docs/generate.ts`,
seeds 1 to 20 of each type). No real patient data was read by either reader.
Rerun: `npx tsx --env-file=.env.local scripts/synth_docs/benchmark.ts --reader on-server|vision`.

60 documents: 20 itemized bills, 20 EOBs, 20 denial letters. Quality by seed:
18 clean PDFs, 21 scanned image PDFs (tilt, blur, speckle), 21 phone photos (JPEG).

| Field | On-server (default) | Vision model |
|---|---|---|
| Document type | 100% | 100% |
| Patient / member name | 90% (36/40) | 98% (39/40) |
| Account / claim number | 100% | 100% |
| Statement / letter date | 100% | 100% |
| Service dates (bills) | 95% (19/20) | 100% |
| Total charges, amount due | 100% | 100% |
| Line count right | 98% | 100% |
| Line found, charge | 100% | 100% |
| Line code | 98% | 100% |
| Line date | 98% | 100% |
| Line units (bills only; EOBs print none) | 96% | 100% |

By quality, on-server: clean PDFs 100% on every field. Scans: name 71%,
service dates 86%, codes 96%. Photos: line count 93%, units 87%.
The vision model's only miss was one scanned name ("Quilifeather").

Remaining on-server misses are character-level OCR limits: accents read
into names ("Moraés"), a J-code read as a digit, one dropped name row.

Cost and time: on-server $0, 40 s for 60 documents, nothing leaves the
server. Vision: $0.45 across three runs (3 + 60 + 60 documents, priced at
the extraction tier's maximum prices, so real spend is at or below this),
about 90 s per 60 documents with 4 at a time.

Decision as instructed: on-server stays the default reader. The vision
reader is behind the same `Extractor` interface with
`allowsRealPatientData: false`, and it refuses any document whose origin
is not `synthetic`. Using it on real documents needs a BAA first.
Either way, the patient confirms every field before any check runs.
