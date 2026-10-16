// Local mock partner API (M07-AC3), for manual runs only. Serves the same
// handler the tests use (lib/pricing/mockPartner.ts) on 127.0.0.1.
//
//   npx tsx scripts/mock_partner_api.ts [--port 4599] [--scenario valid]
//
// Then e.g. curl -H "x-api-key: test" "http://127.0.0.1:4599/v1/quote?ndc=00000000001&qty=30"
// Loopback only; it never binds a public interface. Ctrl+C to stop.

import { createServer } from 'node:http';
import { createMockPartnerFetch, MOCK_BASE, type MockScenario } from '../lib/pricing/mockPartner';

const args = process.argv.slice(2);
const port = Number(args[args.indexOf('--port') + 1] || 4599);
const scenario = ((args.includes('--scenario') && args[args.indexOf('--scenario') + 1]) || 'valid') as MockScenario;
const handler = createMockPartnerFetch(scenario);

createServer(async (req, res) => {
  const controller = new AbortController();
  req.on('close', () => controller.abort());
  try {
    const r = await handler(`${MOCK_BASE}${req.url ?? '/'}`, {
      headers: req.headers as Record<string, string>,
      signal: controller.signal,
    });
    res.writeHead(r.status, Object.fromEntries(r.headers.entries()));
    res.end(await r.text());
  } catch {
    res.destroy();
  }
}).listen(port, '127.0.0.1', () => {
  console.log(`mock partner API on http://127.0.0.1:${port} (scenario: ${scenario})`);
});
