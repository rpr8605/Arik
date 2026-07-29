// Deterministic location resolution for conversational extraction
// (CONVERSATIONAL_ENTITY_EXTRACTION.md). The raw extracted text is always
// stored verbatim in user_matching_profile.state_or_location_raw; this
// function derives structured zip_code/state from it when possible.
// Never guesses: no match is a valid result, and the route never asks a
// clarifying question just for location.

// USPS code -> full name. Codes are matched case-SENSITIVELY on purpose:
// a case-insensitive code match would turn "I live in Austin" into Indiana
// ("in"), "help me" into Maine, etc. Full names are matched
// case-insensitively; multi-word names are tried before single-word ones
// so "West Virginia" doesn't resolve as plain "Virginia".
const STATE_NAMES: Record<string, string> = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California',
  CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware', DC: 'District of Columbia',
  FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois',
  IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana',
  ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan',
  MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri', MT: 'Montana',
  NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey',
  NM: 'New Mexico', NY: 'New York', NC: 'North Carolina', ND: 'North Dakota',
  OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania',
  RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota',
  TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont', VA: 'Virginia',
  WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming',
};

// Longest-first so multi-word names win over their suffixes.
const NAMES_BY_LENGTH = Object.entries(STATE_NAMES).sort(
  (a, b) => b[1].length - a[1].length,
);

export interface ResolvedLocation {
  zip?: string;
  state?: string; // USPS code, e.g. 'TX'
}

export function resolveLocation(raw: string): ResolvedLocation {
  const out: ResolvedLocation = {};
  const text = raw.trim();
  if (!text) return out;

  const zipMatch = text.match(/\b(\d{5})(?:-\d{4})?\b/);
  if (zipMatch) out.zip = zipMatch[1];

  for (const [code, name] of NAMES_BY_LENGTH) {
    if (new RegExp(`\\b${name}\\b`, 'i').test(text)) {
      out.state = code;
      break;
    }
  }
  if (!out.state) {
    const codeMatch = text.match(/\b([A-Z]{2})\b/); // case-sensitive, see above
    if (codeMatch && STATE_NAMES[codeMatch[1]]) out.state = codeMatch[1];
  }

  return out;
}
