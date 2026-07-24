# Arik: Location-Specific Savings

## Zip code first, GPS as optional convenience

Both are technically easy - the browser's native Geolocation API
(`navigator.geolocation`) is free, built-in, and requires only a
permission prompt. But the actual use cases below (FQHC lookup, facility
price comparison, state programs) only need zip-code-level precision,
not exact GPS coordinates. Asking for a zip code:
- Avoids the permission-prompt friction entirely for most patients
- Is more private by default - a zip code is meaningfully coarser than
  precise home coordinates, consistent with the minimal-collection
  principle already in SECURITY.md
- Works identically well for every location-driven feature below

Add an optional "use my current location" button as a convenience layer
on top - tapping it uses the Geolocation API once, converts the
coordinates to a distance calculation for a "nearest" query, and doesn't
need to persist raw GPS coordinates afterward. The zip code is what gets
stored in the profile; a one-time location tap is a query-time
convenience, not a stored field.

## What location actually unlocks

- **FQHC/sliding-fee clinic lookup** (already speced in the uninsured
  access scope) - nearest qualifying health centers by zip
- **340B contract pharmacy matching** - once a patient is established at
  a qualifying clinic, finding that clinic's specific contract pharmacies
  nearby
- **Facility price shopping** (later phase, hospital/imaging) - comparing
  the same CPT code across nearby hospital outpatient departments,
  independent imaging centers, and ambulatory surgery centers, per the
  original site-of-service arbitrage research
- **Pharmacy proximity for cash-price comparison** - the discount-network
  click-out model works better when Arik already knows which nearby
  pharmacies are worth checking, not just "discounts exist somewhere"
- **State-specific program matching** - state pharmaceutical assistance
  programs, state Medicaid expansion status, and state-level accumulator/
  maximizer bans all vary by state, and zip code resolves state
  automatically rather than needing it as a separate onboarding field

## Data sources for facility locations (public, free)

- **HRSA's Health Center Program data** - public directory of FQHCs and
  their locations, free
- **NPPES (National Plan and Provider Enumeration System)** - the public
  federal registry of provider/facility addresses tied to NPIs, free,
  already relevant since NPI numbers show up elsewhere in this build
  (denial appeals, PAP applications)
- **CMS hospital price transparency machine-readable files** (already
  flagged in BLUE_BUTTON_AND_DISCOUNT_GRAPH.md as a later-phase source)
  include facility identifiers alongside pricing, so facility location
  and facility pricing can eventually be joined from the same ingestion
  pipeline

No paid location/places API (Google Places, etc.) is necessary for the
core use cases here, keeping this consistent with the "public data first"
philosophy already established for pricing.

## Schema addition

```sql
alter table user_matching_profile add column zip_code text;
alter table managed_patients add column zip_code text;
```

State can be derived from zip code rather than requiring it as a separate
onboarding question - one less thing asked during the crisis-aware,
minimal-friction onboarding flow.

## What this means for the build

- Zip code becomes part of the incremental onboarding fields (collected
  when a location-dependent task actually needs it, per
  CRISIS_AWARE_DESIGN.md's incremental-profile principle, not demanded
  up front)
- The optional geolocation button is a small, genuinely optional frontend
  addition - not a blocking dependency for anything in the Phase 1 scope
- Facility-distance calculations (nearest FQHC, nearest imaging center)
  are a straightforward distance query once zip-to-coordinates data
  exists for both the patient and the facility list - no need for a live
  mapping API subscription for this
