// Next.js startup hook. Fails fast when an enabled price source is missing
// an env var it needs (M07-AC6); the error names the variables, never values.
import { assertSourceEnv } from './lib/pricing/configAdapter';
import { QUOTE_SOURCE_CONFIGS } from './lib/pricing/quoteSources';

export function register() {
  assertSourceEnv(QUOTE_SOURCE_CONFIGS, process.env);
}
