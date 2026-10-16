// `npm run ingest -- <name> [args]`: one command for every loader.
//   price sources (price_sources.name, e.g. nadac) -> scripts/ingest_prices.ts
//   tic_puf, prior_auth                            -> scripts/load_denial_data.ts
//   mcd                                            -> scripts/load_coverage_data.ts
// Same environment, same exit code as the loader it runs.

import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

const [name, ...rest] = process.argv.slice(2);
if (!name) {
  console.error('usage: npm run ingest -- <nadac | tic_puf | prior_auth | mcd> [args]');
  process.exit(1);
}
const DATASETS = new Set(['tic_puf', 'prior_auth']);
const script = name === 'mcd'
  ? ['scripts/load_coverage_data.ts', ...rest]
  : DATASETS.has(name) ? ['scripts/load_denial_data.ts', name, ...rest] : ['scripts/ingest_prices.ts', '--source', name, ...rest];
const r = spawnSync(process.execPath, ['--import', 'tsx', ...script], { cwd: join(__dirname, '..'), stdio: 'inherit', timeout: 230_000 });
process.exit(r.status ?? 1);
