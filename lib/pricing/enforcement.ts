// Consent + freshness enforcement for ingested price rows (build ticket
// 2026-10-01). ONE pure function, called by both the ranking engine and
// the chat route's prompt builder, so a row cannot slip past one caller
// while the other filters it.
//
// The rule table (per row, first match wins):
//   1. expired / source disabled / older than source.max_staleness_hours
//      -> excludedStale (surfaced to the response: "which prices were
//      excluded as stale" is a required answer, not an omission)
//   2. fresh but source.allow_patient_display = false
//      -> excludedNotDisplayable (may inform internal checks; never
//      patient-facing, and never in a prompt, since prompts are
//      patient-facing here)
//   3. fresh, displayable, but source.allow_ai_processing = false
//      -> excludedAi (ranks nowhere TODAY: every ranking consumer feeds
//      a prompt. Kept as its own bucket so a future deterministic,
//      model-free render path can use it without re-deriving)
//   4. otherwise -> allowed (ranks identically regardless of source)
//
// Rows with no price_source_id (legacy seeds) keep pre-ingest behavior:
// allowed, subject only to their own expires_at.
// A row naming a price_source we could not load FAILS CLOSED (bucket 2).

export interface PriceSourceConsent {
  id: string;
  name: string;
  enabled: boolean;
  max_staleness_hours: number | null;
  allow_patient_display: boolean;
  allow_ai_processing: boolean;
}

export interface PriceRowLike {
  price_type?: string | null;
  price_source_id?: string | null;
  observed_at?: string | null;
  expires_at?: string | null;
}

export interface ExcludedPrice<T> {
  row: T;
  reason: string;
}

export interface PriceConsentPartition<T> {
  allowed: T[]; // fresh + displayable + ai-allowed: the ONLY set that may rank or reach a prompt
  excludedStale: ExcludedPrice<T>[];
  excludedNotDisplayable: ExcludedPrice<T>[];
  excludedAi: ExcludedPrice<T>[];
}

export function partitionPricesForConsent<T extends PriceRowLike>(
  rows: T[],
  ctx: { sourcesById: Record<string, PriceSourceConsent>; now?: Date | string },
): PriceConsentPartition<T> {
  const now = ctx.now ? new Date(ctx.now) : new Date();
  const out: PriceConsentPartition<T> = {
    allowed: [],
    excludedStale: [],
    excludedNotDisplayable: [],
    excludedAi: [],
  };

  for (const row of rows ?? []) {
    if (row.expires_at && new Date(row.expires_at) < now) {
      out.excludedStale.push({ row, reason: `expired ${row.expires_at}` });
      continue;
    }
    const src = row.price_source_id ? ctx.sourcesById[row.price_source_id] : undefined;
    if (row.price_source_id && !src) {
      out.excludedNotDisplayable.push({
        row,
        reason: 'price source rules unavailable - failing closed',
      });
      continue;
    }
    if (src && !src.enabled) {
      out.excludedStale.push({ row, reason: `source '${src.name}' is disabled` });
      continue;
    }
    if (src?.max_staleness_hours != null) {
      if (!row.observed_at) {
        // A staleness-bound source row with no observation date cannot be
        // proven fresh - fail closed, never guess freshness.
        out.excludedStale.push({
          row,
          reason: `missing observed_at under a max_staleness source ('${src.name}')`,
        });
        continue;
      }
      const cutoff = new Date(now.getTime() - src.max_staleness_hours * 3_600_000);
      if (new Date(row.observed_at) < cutoff) {
        out.excludedStale.push({
          row,
          reason: `observed ${row.observed_at}, older than source '${src.name}' max_staleness (${src.max_staleness_hours}h)`,
        });
        continue;
      }
    }
    if (src && !src.allow_patient_display) {
      out.excludedNotDisplayable.push({
        row,
        reason: `source '${src.name}' is internal-only (allow_patient_display=false)`,
      });
      continue;
    }
    if (src && !src.allow_ai_processing) {
      out.excludedAi.push({
        row,
        reason: `source '${src.name}' bars AI processing (allow_ai_processing=false)`,
      });
      continue;
    }
    out.allowed.push(row);
  }
  return out;
}
