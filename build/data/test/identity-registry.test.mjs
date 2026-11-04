// Identity registry tests (M2.04 / SE-1.8 / D8). All payloads and pages
// below are SYNTHETIC fixtures shaped like the real Tier P payloads;
// no fixture string is world data. The verification rule under test:
// a binding exists only when an EVIDENCED public agent route returns
// 200 and its display name matches the raw name exactly, character for
// character. Candidates are never derived from names.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildRegistry,
  collectCandidates,
  extractCandidates,
} from '../identity-registry.mjs';
import { canonicalStringify } from '../derive.mjs';

const CHECKED = '2026-11-03T00:00:00.000Z';

const CITIZENS = [
  { citizenKey: 'portal-key:mira-solace', name: 'Mira Solace', firstSeenUtc: '2026-11-01T00:00:00.000Z' },
  { citizenKey: 'portal-key:tomas-reed', name: 'Tomas Reed', firstSeenUtc: '2026-11-01T00:00:00.000Z' },
  { citizenKey: 'portal-key:petra-vale', name: 'Petra Vale', firstSeenUtc: '2026-11-01T00:00:00.000Z' },
];

// A news-shaped payload whose residents row carries a link field (the
// route as a whole field value) beside the display name.
function payloadWithLink(name, route) {
  return {
    file: '2026-11-02/news-fixture.json',
    data: { residents: [{ handle: name, latest: { page: route } }] },
  };
}

// fetchPage stub: pages maps route -> { status, body }; records calls.
function stubFetch(pages) {
  const calls = [];
  const fetchPage = async (route) => {
    calls.push(route);
    if (!(route in pages)) return { status: 404, body: 'not found' };
    return pages[route];
  };
  return { fetchPage, calls };
}

const page = (name) => ({ status: 200, body: JSON.stringify({ name }) });

test('exact-match page binds: verified, citizenId is the evidenced handle', async () => {
  const candidates = collectCandidates([payloadWithLink('Mira Solace', '/public/agents/msolace')]);
  const { fetchPage, calls } = stubFetch({ '/public/agents/msolace': page('Mira Solace') });
  const reg = await buildRegistry({ citizens: CITIZENS, candidates, fetchPage, checkedUtc: CHECKED });
  const e = reg.entries['portal-key:mira-solace'];
  assert.equal(e.state, 'verified');
  assert.equal(e.citizenId, 'msolace');
  assert.equal(e.evidence.file, '2026-11-02/news-fixture.json');
  assert.equal(e.evidence.field, '$.residents[0].latest.page');
  assert.equal(e.evidence.pageName, 'Mira Solace');
  assert.deepEqual(calls, ['/public/agents/msolace']);
});

test('mismatched page name does not bind', async () => {
  const candidates = collectCandidates([payloadWithLink('Mira Solace', '/public/agents/msolace')]);
  const { fetchPage } = stubFetch({ '/public/agents/msolace': page('Mira Solace Chen') });
  const reg = await buildRegistry({ citizens: CITIZENS, candidates, fetchPage, checkedUtc: CHECKED });
  const e = reg.entries['portal-key:mira-solace'];
  assert.equal(e.state, 'unverified');
  assert.equal(e.citizenId, null);
  assert.equal(e.reason, 'name-mismatch');
});

test('character-for-character: a trailing space in the page name is a mismatch', async () => {
  const candidates = collectCandidates([payloadWithLink('Mira Solace', '/public/agents/msolace')]);
  const { fetchPage } = stubFetch({ '/public/agents/msolace': page('Mira Solace ') });
  const reg = await buildRegistry({ citizens: CITIZENS, candidates, fetchPage, checkedUtc: CHECKED });
  assert.equal(reg.entries['portal-key:mira-solace'].state, 'unverified');
  assert.equal(reg.entries['portal-key:mira-solace'].citizenId, null);
});

test('route that does not answer 200 does not bind', async () => {
  const candidates = collectCandidates([payloadWithLink('Mira Solace', '/public/agents/msolace')]);
  const { fetchPage } = stubFetch({}); // everything 404s
  const reg = await buildRegistry({ citizens: CITIZENS, candidates, fetchPage, checkedUtc: CHECKED });
  const e = reg.entries['portal-key:mira-solace'];
  assert.equal(e.state, 'unverified');
  assert.equal(e.reason, 'route-not-200');
});

test('two evidenced candidates are ambiguous and never auto-bound, even when both pages match', async () => {
  const candidates = collectCandidates([
    payloadWithLink('Petra Vale', '/public/agents/pvale'),
    payloadWithLink('Petra Vale', '/public/agents/petra-vale-official'),
  ]);
  const { fetchPage } = stubFetch({
    '/public/agents/pvale': page('Petra Vale'),
    '/public/agents/petra-vale-official': page('Petra Vale'),
  });
  const reg = await buildRegistry({ citizens: CITIZENS, candidates, fetchPage, checkedUtc: CHECKED });
  const e = reg.entries['portal-key:petra-vale'];
  assert.equal(e.state, 'ambiguous');
  assert.equal(e.citizenId, null);
  assert.deepEqual(reg.auditQueue, ['portal-key:petra-vale']);
  assert.deepEqual(
    e.candidates.map((c) => c.outcome),
    ['match', 'match'],
  );
});

test('NEGATIVE CONTROL: no evidenced route stays unverified even though a slugified guess would have "worked"', async () => {
  // No payload evidences any route for Tomas Reed. The stub is loaded
  // so that the slugified guess /public/agents/tomas-reed WOULD return
  // 200 with his exact name — if the builder ever guessed, it would
  // bind. The ban: it must not even try.
  const candidates = collectCandidates([payloadWithLink('Mira Solace', '/public/agents/msolace')]);
  const { fetchPage, calls } = stubFetch({
    '/public/agents/msolace': page('Mira Solace'),
    '/public/agents/tomas-reed': page('Tomas Reed'),
  });
  const reg = await buildRegistry({ citizens: CITIZENS, candidates, fetchPage, checkedUtc: CHECKED });
  const e = reg.entries['portal-key:tomas-reed'];
  assert.equal(e.state, 'unverified');
  assert.equal(e.citizenId, null);
  assert.equal(e.reason, 'no-evidenced-route');
  assert.ok(!calls.includes('/public/agents/tomas-reed'), 'builder fetched a guessed route');
  // Registry-wide invariant (plan M2.04 gate): zero bindings whose
  // evidence is a transformation of the name — every fetch used an
  // evidenced route, and every verified entry cites a payload field.
  assert.deepEqual(calls, ['/public/agents/msolace']);
  for (const entry of Object.values(reg.entries)) {
    if (entry.state === 'verified') {
      assert.ok(entry.evidence.file && entry.evidence.field, 'verified entry lacks an evidence pointer');
    }
  }
});

test('a route inside prose is testimony, not a candidate', () => {
  const data = {
    places: [
      {
        said: [
          {
            by: 'Mira Solace',
            said: 'come and read my page at /public/agents/msolace whenever you like',
          },
        ],
      },
    ],
  };
  assert.deepEqual(extractCandidates(data, 'voices-fixture.json'), []);
});

test('an untied evidenced route binds only via its own page name', async () => {
  const candidates = collectCandidates([
    { file: '2026-11-02/overview-fixture.json', data: { featured: { page: '/public/agents/msolace' } } },
  ]);
  const { fetchPage } = stubFetch({ '/public/agents/msolace': page('Mira Solace') });
  const reg = await buildRegistry({ citizens: CITIZENS, candidates, fetchPage, checkedUtc: CHECKED });
  assert.equal(reg.entries['portal-key:mira-solace'].state, 'verified');
  assert.equal(reg.entries['portal-key:mira-solace'].citizenId, 'msolace');
  assert.equal(reg.entries['portal-key:tomas-reed'].state, 'unverified');
});

test('namesakes sharing one verifying candidate are both ambiguous — never folded onto one id', async () => {
  const twins = [
    { citizenKey: 'portal-key:sam-wren', name: 'Sam Wren', firstSeenUtc: '2026-11-01T00:00:00.000Z' },
    { citizenKey: 'portal-key:sam-wren#2', name: 'Sam Wren', firstSeenUtc: '2026-11-02T00:00:00.000Z' },
  ];
  const candidates = collectCandidates([payloadWithLink('Sam Wren', '/public/agents/swren')]);
  const { fetchPage } = stubFetch({ '/public/agents/swren': page('Sam Wren') });
  const reg = await buildRegistry({ citizens: twins, candidates, fetchPage, checkedUtc: CHECKED });
  assert.equal(reg.entries['portal-key:sam-wren'].state, 'ambiguous');
  assert.equal(reg.entries['portal-key:sam-wren#2'].state, 'ambiguous');
  assert.equal(reg.entries['portal-key:sam-wren'].citizenId, null);
  assert.equal(reg.entries['portal-key:sam-wren#2'].citizenId, null);
  assert.deepEqual(reg.auditQueue, ['portal-key:sam-wren', 'portal-key:sam-wren#2']);
});

test('registry output is deterministic across re-runs', async () => {
  const build = async () => {
    const candidates = collectCandidates([
      payloadWithLink('Mira Solace', '/public/agents/msolace'),
      payloadWithLink('Petra Vale', '/public/agents/pvale'),
      payloadWithLink('Petra Vale', '/public/agents/petra-vale-official'),
    ]);
    const { fetchPage } = stubFetch({
      '/public/agents/msolace': page('Mira Solace'),
      '/public/agents/pvale': page('Petra Vale'),
      '/public/agents/petra-vale-official': page('Petra Vale'),
    });
    return buildRegistry({ citizens: CITIZENS, candidates, fetchPage, checkedUtc: CHECKED });
  };
  const a = await build();
  const b = await build();
  assert.deepEqual(a, b);
  assert.equal(canonicalStringify(a), canonicalStringify(b));
});
