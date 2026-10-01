// callModel timeout tests (Step 5, 2026-10-01): a hung provider call
// aborts at the configured timeout with a clear error; a fast call is
// unaffected. fetch is stubbed - no network, no API key spend.
// Run: npx tsx scripts/test_callmodel_timeout.ts
import { callModel } from '../lib/callModel';
import { MODEL_TIERS } from '../lib/modelConfig';

let failures = 0;
function check(name: string, cond: boolean, detail = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ' - ' + detail : ''}`);
  if (!cond) failures++;
}

process.env.OPENROUTER_API_KEY = 'test-key-not-sent-anywhere';

const realFetch = globalThis.fetch;

async function main() {
  // Tier defaults are configured, not guessed.
  check('extraction tier carries a timeout', MODEL_TIERS.extraction.timeoutMs === 30_000);
  check('response tier carries a timeout', MODEL_TIERS.response.timeoutMs === 120_000);

  // 1. Hung request: fetch that never resolves but honors the abort
  //    signal (exactly what a stalled socket looks like).
  let signalSeen: AbortSignal | null = null;
  globalThis.fetch = ((url: string, init: RequestInit) => {
    signalSeen = init.signal ?? null;
    return new Promise((_, reject) => {
      init.signal?.addEventListener('abort', () => {
        reject(Object.assign(new Error('The operation was aborted'), { name: 'AbortError' }));
      });
    });
  }) as any;
  const started = Date.now();
  let err: Error | null = null;
  try {
    await callModel({ tier: 'extraction', prompt: 'hang', timeoutMs: 120 });
  } catch (e) {
    err = e as Error;
  }
  const elapsed = Date.now() - started;
  check('hung call throws', err !== null);
  check('error names it a timeout with the tier + ms',
    !!err && /timed out after 120ms/.test(err.message) && /extraction/.test(err.message),
    err?.message ?? '');
  check('abort fired near the configured timeout (not instantly, not never)',
    elapsed >= 100 && elapsed < 3000, `${elapsed}ms`);
  check('the fetch received our abort signal', (signalSeen as unknown) instanceof AbortSignal);

  // 2. Fast, well-formed response: unaffected by the timeout wrapper.
  globalThis.fetch = (async () => ({
    ok: true,
    json: async () => ({
      model: 'anthropic/claude-haiku-4.5',
      choices: [{ message: { content: 'ok' } }],
      usage: { prompt_tokens: 3, completion_tokens: 2 },
    }),
    text: async () => '',
  })) as any;
  const out = await callModel({ tier: 'extraction', prompt: 'fast', timeoutMs: 5000 });
  check('fast call returns content normally', out === 'ok');

  // 3. HTTP error path still fails loud (unchanged behavior).
  globalThis.fetch = (async () => ({ ok: false, status: 402, text: async () => 'max_price unmet' })) as any;
  let httpErr: Error | null = null;
  try {
    await callModel({ tier: 'extraction', prompt: 'x' });
  } catch (e) {
    httpErr = e as Error;
  }
  check('HTTP error still fails loud with status + body',
    !!httpErr && /call failed \(402\): max_price unmet/.test(httpErr.message), httpErr?.message ?? '');
}

main()
  .then(() => {
    globalThis.fetch = realFetch;
    console.log(failures === 0 ? '\nCALLMODEL TIMEOUT: ALL PASS' : `\nCALLMODEL TIMEOUT: ${failures} FAILURE(S)`);
    process.exit(failures === 0 ? 0 : 1);
  })
  .catch((e) => {
    globalThis.fetch = realFetch;
    console.error(e);
    process.exit(1);
  });
