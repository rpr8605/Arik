// Pure-logic test of the location resolver. Run: npx tsx scripts/test_location.ts
import { resolveLocation } from '../lib/resolveLocation';

let failures = 0;

function check(name: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    console.log(`PASS  ${name}`);
  } else {
    console.error(`FAIL  ${name}: expected ${e}, got ${a}`);
    failures++;
  }
}

check('bare zip', resolveLocation('78701'), { zip: '78701' });
check('zip+4 keeps 5-digit base', resolveLocation('Austin, TX 78701-1234'), { zip: '78701', state: 'TX' });
check('city + uppercase code', resolveLocation('Austin, TX'), { state: 'TX' });
check('full state name', resolveLocation('I live in Texas'), { state: 'TX' });
check('full state name case-insensitive', resolveLocation('moved to oregon last year'), { state: 'OR' });
check('lowercase code does NOT match ("in" != Indiana)', resolveLocation('I live in Austin'), {});
check('city only: nothing resolved, raw is still stored by caller', resolveLocation('Austin'), {});
check('multi-word state beats suffix (West Virginia, not Virginia)', resolveLocation('West Virginia'), { state: 'WV' });
check('plain Virginia still resolves', resolveLocation('Virginia'), { state: 'VA' });
check('North Carolina, not South', resolveLocation('North Carolina'), { state: 'NC' });
check('empty string', resolveLocation(''), {});
check('whitespace only', resolveLocation('   '), {});
check('zip and state together', resolveLocation('Denver, CO 80202'), { zip: '80202', state: 'CO' });
check('non-state uppercase pair ignored', resolveLocation('Building AB, room 2'), {});

console.log(failures === 0 ? '\nLOCATION TESTS: ALL PASS' : `\nLOCATION TESTS: ${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
