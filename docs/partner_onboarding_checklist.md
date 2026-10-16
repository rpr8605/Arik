# Pricing partner onboarding checklist

How any pricing or routing partner gets connected to Arik. Partner names, terms, endpoints and prices never go in this repo: here they are "pricing partner". The real adapter lives in the private adapters repo and must pass the same contract tests as the mock (`scripts/test_partner_readiness.ts`).

## What Ryan needs from the partner first

- [ ] Signed data use agreement covering: patient display, caching, retention period, AI processing (yes or no), and whether any patient data flows to the partner.
- [ ] A BAA, if any patient health information is sent to them. Default: send none (NDC, quantity and zip only).
- [ ] API documentation and a sandbox key.
- [ ] Rate limits (per second, per day) and what a 429 response looks like (Retry-After?).
- [ ] Auth type: API key, bearer token or OAuth client credentials.
- [ ] Pagination style for bulk pulls: page, offset or cursor.
- [ ] Written confirmation that Arik is paid nothing: no referral, commission, affiliate or data fee. Any such field in their API is ignored and reported to Ryan.

## Steps to add the adapter

1. Register the source in a migration: a `price_sources` row with `kind`, `mode` (`bulk` or `quote`), `enabled = false`, `allow_patient_display = false`, `allow_ai_processing = false`, `max_staleness_hours` and `retention_days` from the agreement.
2. In the private repo, write the `SourceConfig` for `lib/pricing/configAdapter.ts`: URL, auth (env var NAMES only), pagination, records path, field map. Map only the fields the contract needs; nothing else.
3. Put the sandbox credentials in the private repo's `.env.local` only. Never print, log or commit them.
4. Run the contract suite against recorded sandbox fixtures with identifiers scrubbed. It must pass every scenario the mock covers: valid, paginated, 401, 429, 500, timeout, malformed, stale and unknown NDC.
5. Turn on `allow_patient_display` and `allow_ai_processing` only as far as the agreement allows, then `enabled = true`.
6. Check startup: an enabled source with a missing env var stops the app at boot (`instrumentation.ts`) and shows on `/api/health` by name.

## Turning a source off

- Kill switch: `npm run source:disable -- <name>` (instant; ranking, quotes and the ingest runner all read `enabled`).
- Remove its data: `npm run source:purge -- <name>` (disables, then deletes its prices, staging rows and ingest runs).
- Both write a `source_admin_events` row with counts only.
- Both run against the local database. For the demo database, the same statements go through the reviewed apply flow.
