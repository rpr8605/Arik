# Brand drug program research: 25 drugs (2026-10-16)

File: `docs/research/brand_programs_25.csv` (72 rows). **Every row is
`unverified`** until the owner or a reviewer checks it against the page.
Nothing here is loaded into the database; it is the input for Step 4 of
docs/kimi/DRUG_DATA_TOP200.md.

## Which 25 drugs

There was no written list, so the default is the top 25 brand drugs by
total spending in CMS Medicare Part D Spending by Drug, data year 2024 (the
`drug_rank_list` already loaded locally). Rank 18 is generic lenalidomide,
so it is skipped and rank 26 (Jakafi) is in. The `part_d_rank` column keeps
the CMS rank.

## Sources (owner rule: official drug-maker pages and TrumpRx only)

- **TrumpRx** (https://trumprx.gov/p/<drug>): 9 of the 25 brands have a page
  (Ozempic and the Ozempic pill, Mounjaro, Xarelto, Humira, Trulicity,
  Farxiga, Januvia, Enbrel), found through https://trumprx.gov/sitemap.xml
  (846 product pages). Prices are read from the page's own product data
  (per strength and quantity, in cents), with the page's label for the
  original price: "Original price represents the Wholesale Acquisition
  Cost". Six generics with the same active ingredient as one of the 25 are
  also listed (rivaroxaban, sacubitril/valsartan, sitagliptin, mirabegron
  ER, nintedanib, dapagliflozin) and marked `trumprx_generic_price`: they
  are NOT the brand. The original price shown for generics does not scale
  with quantity, so it is not recorded.
- **Drug-maker pages**: the savings, cost or support page on the brand's
  own site or the maker's program site (J&J withMe, J&J Direct, NovoCare,
  LillyDirect, AstraZeneca Direct, Merck Cash-Pay Gateway, IncyteCARES).
  The `quote` column is the page's sentence, word for word, from the page
  HTML. The Mounjaro savings card and the Stelara, Invega, J&J Direct,
  Trelegy, Jakafi and Merck rows were read through a fetch tool that
  summarizes. Their quotes may be trimmed, so check them first.

Third-party pharmacy and discount-network names that appear in some terms
are left out on purpose.

## Gaps (rows with `program_kind = not_found`)

- Jardiance, Ofev: the Boehringer Ingelheim patient site showed a bot check
  to both fetchers. These need a browser check.
- Revlimid, Pomalyst: no co-pay amount was found. pomalyst.com redirects to
  its prescribing information. The BMS Patient Assistance Foundation page
  returned no text; its terms are already sourced in db/030.
- Entresto: entresto.com redirects to the Novartis product list.
- Invega Sustenna: the cost page points to a PDF that was not fetched.
- Myrbetriq: no savings page (404).
- Eliquis: its direct-to-patient price and BMSPAF Medicare terms are already
  in the database (db/013, db/030) and were not researched again.

## Checks before use

- Each row needs a reviewer to open `source_url`, confirm the quote and the
  number, and set `verification_status`. Only then can it become an
  `exploits` row with a `sources` row (every exploit needs `source_id`).
- Copay cards never reach Medicare or Medicaid patients (the AKS block in
  lib/medicareEligibility.ts). A drug maker's direct or cash program for a
  Medicare or Medicaid patient stays pending unless the program row says
  `federal_program_allowed = 'yes'` (db/037). Ozempic's self-pay terms on
  ozempic.com and TrumpRx are the only ones here that say government
  beneficiaries may use the self-pay offer outside their insurance.
- One-time offers (the Eliquis free 30-day trial, the Ozempic first-two-fill
  price) are bridges, never yearly prices (lib/ranking.ts).
- Two pages give a Part D out-of-pocket cap: Humira and Imbruvica say $2,100
  for 2026; Vyndamax says $2,400 for 2027. Neither is verified against
  CMS, so neither is used.
