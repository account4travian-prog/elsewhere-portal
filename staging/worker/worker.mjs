// Elsewhere Portal — staging Worker (M4.02, SE-5.1 / SE-5.4).
//
// One thin Worker and no more: serve the published snapshot from an
// R2-style object store, stamp the honesty headers, 405 every non-GET.
// It holds no Elsewhere key and no per-visitor state (SE-5.4 / SE-6.3).
//
// Link-only posture (D3/D7): every route lives under an unguessable
// path-token segment, /<token>/... The token comes from configuration
// (the PORTAL_PATH_TOKEN Worker secret at deploy; an env/arg locally),
// never from source. Without the token the site does not exist: every
// other path — including "/" — is a 404, there is no listing and no
// index of anything.
//
// Publishing is content-addressed (SE-5.2): the store holds immutable
// objects under objects/<sha256> plus ONE mutable pointer,
// publish-manifest.json, written last by the publisher. Rollback is
// repointing that manifest. The handler reads the pointer fresh on
// every request, so a publish or rollback takes effect with no deploy.
//
// Cache rules (SE-5.2 + the M4.02 brief): feed documents are
// `no-cache` with a strong ETag — a client must revalidate, and a 304
// is only issued against the exact current bytes, so a stale bundle
// can never be served as fresh. Static site files cache briefly
// (max-age=300) and also carry ETags. Hashed objects are immutable by
// construction; they are never addressed directly by URL.
//
// The handler core is environment-free: `handleRequest(request, store,
// config)` takes any store with `async get(key) -> Uint8Array | null`.
// On Cloudflare the store is the R2 binding; locally it is the
// filesystem shim (store-fs.mjs) over the publisher's bucket directory,
// with identical semantics.

export const PUBLISH_MANIFEST_KEY = 'publish-manifest.json';

const FEED_PREFIX = 'data/feed/';
const STATIC_MAX_AGE_SECONDS = 300;

// SE-6.5's edge policy, served on document responses: self-only
// scripts/styles/fonts, no framing. (Console-violation verification
// under this policy rides with the M4.22 harness, as the plan gates it.)
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
].join('; ');

// The scene page is the one published page that cannot be fully
// externalised: its import map must be an inline <script
// type="importmap"> (there is no external-import-map form), its small
// page stylesheet ships inline in scene.html, and its vendored
// Meshopt decoder instantiates WebAssembly from embedded bytes.
// Under the strict policy above a browser blocks all three — the
// import map as inline script, the <style> block as inline style, and
// the decoder's WebAssembly instantiation — leaving the scene
// unstyled and its module graph unresolved (staging diagnosis,
// 2026-11-02; the missing-module 404s masked it until they were
// fixed). The scene response therefore carries two exact-content
// hashes — of the import-map text node and the style text node in the
// CURRENT build/visual/scene/scene.html — plus 'wasm-unsafe-eval',
// which permits WebAssembly compilation only, never JS eval. Any
// edit to either inline block changes its hash and must update these
// constants in the same change; the handler suite recomputes both
// hashes from scene.html and fails on drift. Every other page keeps
// the strict policy untouched.
export const SCENE_IMPORTMAP_SHA256 = 'sha256-JmFPMM6hqTDeOhh+5pDmskMz2dW/Br0dXHziUxIC+BA=';
export const SCENE_STYLE_SHA256 = 'sha256-TeE8LbgSLeoagb/F43ZpZqOiLJbPppf0IQEKeMKLg7Y=';
const SCENE_CSP = [
  "default-src 'self'",
  `script-src 'self' '${SCENE_IMPORTMAP_SHA256}' 'wasm-unsafe-eval'`,
  `style-src 'self' '${SCENE_STYLE_SHA256}'`,
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
].join('; ');

function baseHeaders() {
  return {
    'X-Robots-Tag': 'noindex, nofollow',
    'X-Content-Type-Options': 'nosniff',
  };
}

function notFound() {
  return new Response('not found\n', {
    status: 404,
    headers: { ...baseHeaders(), 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

// timingSafeEqual-ish: token comparison that does not short-circuit on
// the first differing byte. (The token is a capability URL segment, not
// a password; this is cheap hygiene, not a security boundary claim.)
function tokenEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function readPublishManifest(store) {
  const bytes = await store.get(PUBLISH_MANIFEST_KEY);
  if (!bytes) return null;
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
}

export function createHandler({ store, config } = {}) {
  if (!store || typeof store.get !== 'function') {
    throw new Error('createHandler: a store with async get(key) is required');
  }
  if (!config || typeof config.pathToken !== 'string' || config.pathToken.length < 16) {
    // An unset or short token must never degrade to open access.
    throw new Error('createHandler: config.pathToken must be a string of at least 16 characters');
  }
  const token = config.pathToken;

  return async function handle(request) {
    const method = request.method || 'GET';
    if (method !== 'GET' && method !== 'HEAD') {
      return new Response('method not allowed\n', {
        status: 405,
        headers: {
          ...baseHeaders(),
          'Allow': 'GET, HEAD',
          'Content-Type': 'text/plain; charset=utf-8',
          'Cache-Control': 'no-store',
        },
      });
    }

    let url;
    try {
      url = new URL(request.url);
    } catch {
      return notFound();
    }
    const segments = url.pathname.split('/').filter((s) => s !== '');
    if (segments.length === 0 || !tokenEqual(segments[0], token)) return notFound();

    const rest = segments.slice(1).map((s) => {
      try { return decodeURIComponent(s); } catch { return s; }
    });
    if (rest.some((s) => s === '..' || s.includes('\\') || s.includes('\0'))) return notFound();

    // The app document's canonical URL is /<token>/app/index.html.
    // Everything the page loads is a relative reference — styles.css,
    // the app.js module script, the module graph behind it, and the
    // app's own data fetches (../data/feed/…, ../shared/…) — and a
    // browser resolves those against the document's URL. Serving the
    // document AT the token root strips the app/ segment, so the
    // stylesheet and script resolve to /<token>/styles.css and
    // /<token>/app.js, which do not exist: the page renders unstyled
    // and its JavaScript never executes, while every file census
    // passes because censuses fetch manifest paths, not the URLs a
    // browser derives from the served page (staging diagnosis
    // round 2, 2026-11-02). The root and the bare app segment
    // therefore redirect to the canonical URL instead of serving
    // the document at an address its own references cannot survive.
    if (rest.length === 0 || (rest.length === 1 && rest[0] === 'app')) {
      return new Response('redirect\n', {
        status: 302,
        headers: {
          ...baseHeaders(),
          'Location': `/${token}/app/index.html${url.search}`,
          'Content-Type': 'text/plain; charset=utf-8',
          'Cache-Control': 'no-store',
        },
      });
    }
    const sitePath = rest.join('/');

    const publish = await readPublishManifest(store);
    if (!publish || !publish.files) return notFound();
    const entry = publish.files[sitePath];
    if (!entry) return notFound(); // no listing, no guessing

    const isFeed = sitePath.startsWith(FEED_PREFIX);
    const etag = `"${entry.sha256}"`;
    const headers = {
      ...baseHeaders(),
      'Content-Type': entry.contentType,
      'ETag': etag,
      // SE-5.4 honesty stamps: any client can verify freshness and the
      // exact bundle bytes without trusting the page.
      'X-Portal-Worlddata-Hash': publish.feed?.worlddataHash ?? '',
      'X-Portal-Newest-Fetch': publish.feed?.newestFetchUtc ?? '',
      'X-Portal-Bundle-Seq': String(publish.bundleSeq ?? ''),
      'X-Portal-Publish-Id': publish.publishId ?? '',
      'Cache-Control': isFeed ? 'no-cache' : `public, max-age=${STATIC_MAX_AGE_SECONDS}`,
    };
    if (entry.contentType.startsWith('text/html')) {
      headers['Content-Security-Policy'] = sitePath === 'visual/scene/scene.html' ? SCENE_CSP : CSP;
    }

    const ifNoneMatch = request.headers.get('if-none-match');
    if (ifNoneMatch && ifNoneMatch.split(',').map((t) => t.trim()).includes(etag)) {
      return new Response(null, { status: 304, headers });
    }

    const bytes = await store.get(entry.object);
    if (!bytes) return notFound();
    headers['Content-Length'] = String(bytes.byteLength);
    return new Response(method === 'HEAD' ? null : bytes, { status: 200, headers });
  };
}

// Cloudflare entry point: env.BUCKET is the R2 binding (wrangler.toml),
// env.PORTAL_PATH_TOKEN the Worker secret. Locally, serve-local.mjs
// builds the same handler over the filesystem store — this default
// export is never used by the local path or the tests.
export default {
  async fetch(request, env) {
    const store = {
      async get(key) {
        const obj = await env.BUCKET.get(key);
        if (!obj) return null;
        return new Uint8Array(await obj.arrayBuffer());
      },
    };
    const handle = createHandler({ store, config: { pathToken: env.PORTAL_PATH_TOKEN } });
    return handle(request);
  },
};
