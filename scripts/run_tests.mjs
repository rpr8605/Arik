// One command runs every pure test suite (M22-AC1): scripts/test_*.ts,
// each in its own process via tsx, with a hard 120s cap per suite
// (AGENTS.md standing rule: no unbounded waits). Suites that need a live
// database are smoke_*.mjs / test_ingest_integration.mjs and are NOT part
// of this run.
import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const suites = readdirSync(here).filter((f) => /^test_.*\.ts$/.test(f)).sort();
// Invoke tsx through node directly: spawning npx.cmd on Windows is blocked
// (EINVAL, CVE-2024-27980) and a shell wrapper would be another moving part.
const tsxCli = join(here, '..', 'node_modules', 'tsx', 'dist', 'cli.mjs');

let failed = 0;
for (const suite of suites) {
  const r = spawnSync(process.execPath, [tsxCli, join(here, suite)], {
    stdio: 'inherit',
    timeout: 120_000,
  });
  const ok = r.status === 0;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${suite}${ok ? '' : ` (exit ${r.status}${r.signal ? `, ${r.signal}` : ''})`}`);
  if (!ok) failed++;
}
console.log(`\n${suites.length - failed}/${suites.length} suites passed`);
process.exit(failed === 0 ? 0 : 1);
