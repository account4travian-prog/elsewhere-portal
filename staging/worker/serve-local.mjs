// Elsewhere Portal — local staging server (M4.02 dry-run surface).
//
// Serves the published snapshot from a local bucket directory through
// the REAL Worker handler (worker.mjs) over the filesystem store — the
// same code path Cloudflare will run, minus the platform. For local
// verification only; the deploy target is the Worker on workers.dev.
//
// Usage:
//   PORTAL_PATH_TOKEN=<token> node serve-local.mjs [--bucket <dir>] [--port 8917]
// The token may also come from --token <value>. It is never read from
// the repo and never defaulted: no token, no server.

import { createServer } from 'node:http';
import { createHandler } from './worker.mjs';
import { createFsStore } from './store-fs.mjs';

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const bucketDir = arg('bucket', new URL('../.local-bucket', import.meta.url).pathname);
const port = Number(arg('port', '8917'));
const pathToken = arg('token', process.env.PORTAL_PATH_TOKEN || '');

const handle = createHandler({ store: createFsStore(bucketDir), config: { pathToken } });

const server = createServer(async (req, res) => {
  try {
    const request = new Request(`http://127.0.0.1:${port}${req.url}`, { method: req.method, headers: req.headers });
    const response = await handle(request);
    const body = Buffer.from(await response.arrayBuffer());
    res.writeHead(response.status, Object.fromEntries(response.headers.entries()));
    res.end(body);
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(`local staging server error: ${err.message}\n`);
  }
});

server.listen(port, '127.0.0.1', () => {
  console.log(`portal staging (local) on http://127.0.0.1:${port}/<token>/ — bucket ${bucketDir}`);
});
