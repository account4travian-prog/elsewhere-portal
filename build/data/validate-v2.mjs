// Elsewhere Portal — Arm A (Data): portal.world-data/v2 validator.
//
// validateBundleV2(bundle) -> { valid, errors, rejections }
// validateManifestV2(manifest) -> { valid, errors, rejections }
//
// Every rejection is DATA, never silence (Hark mini-audit 2026-11-02,
// part 3): each error names the rejected record's id (the citizenKey, an
// episode/act-sequence record id derived from its own fields, or
// 'bundle'/'manifest' for structural failures) and the same list is
// returned as `rejections`. The CLI appends rejections to a JSONL log
// (default: validation-rejections.jsonl beside the bundle file) so a
// rejected record leaves a trace wherever validation runs.
//
// Validity rules enforced (CONTRACT-V2-DRAFT.md + Hark amendments):
//   - schema is exactly "portal.world-data/v2".
//   - Q2: a bundle emitting scenes[] is INVALID — reserved means
//     reserved. Q3: citizens[].presenceClass is likewise rejected.
//   - PORTAL-KEY clauses where mechanically checkable: K1 the
//     `portal-key:` prefix is part of every citizenKey and handle stays
//     "" (no handle is ever evidenced); K2 the raw name and
//     firstSeenUtc ride beside the key; citizenId is null-or-string and
//     consistent with citizenIdStatus (BOUND <=> non-null id);
//     K5 citizenCollisions has the shipped shape { key, names,
//     citizenKeys } and references real citizen keys.
//   - Disclosure validity (§1.4/§1.5, strengthened by Hark part 3): an
//     episode's disclosure must be the verbatim filed template
//     (episodes.mjs DISCLOSURE) and an act sequence's the verbatim
//     ACTS_DISCLOSURE — the template family, not any non-empty string.
//     A missing, stub ("n/a"), or altered disclosure is INVALID.
//   - world.bookId is present (world-NNN) and world.facts is present as
//     a key: null (no facts stream) or { schema: "portal.facts/v1",
//     seq } — absence is recorded, never omitted (Hark Q4).
//   - world.integritySource is exactly "none-in-tier-p" (Amendment A1,
//     M2.07): Tier P publishes no building integrity, and the constant
//     is the whole value — any other value is INVALID; a future real
//     source changes the contract, not the constant.
//   - Amendment A3 carriage is OPTIONAL and validated only when
//     present: `offices`, when emitted, is a list of
//     { office, name, citizenKey, provenance } — the holder name is a
//     non-empty string, citizenKey is null (unbound/ambiguous) or a
//     portal-key that names a real citizen in this bundle, and every
//     entry carries its evidenced source as provenance
//     { route, fetchedUtc } — an office with no source route is not a
//     carriage, it is a claim, and it fails. A ticker item's `dueUtc`,
//     when present, must be a parseable ISO date string; absent is
//     the honest "no due stamp evidenced" and is always valid. A
//     bundle with no `offices` key at all (pre-A3) stays valid —
//     optional means optional in both directions.

import { appendFile, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isPlainObject } from './derive.mjs';
import { ACTS_DISCLOSURE, DISCLOSURE } from './episodes.mjs';
import { CITIZEN_ID_STATUSES, FACTS_SCHEMA, INTEGRITY_SOURCE, SCHEMA_V2 } from './derive-v2.mjs';

const CITIZEN_STATES = ['unknown', 'present', 'travelling', 'talking', 'working', 'asleep'];
const COUNTER_FIELDS = [
  'regionsDiscovered', 'regionsSurveyed', 'regionsNamed',
  'collegeDeposits', 'treasury', 'populationKnown',
];

function episodeRecordId(ep, i) {
  return `episode:${ep?.place ?? '?'}:${ep?.firstUtc ?? '?'}:#${i}`;
}
function actSequenceRecordId(seq, i) {
  return `actSequence:${seq?.actor ?? '?'}:${seq?.kind ?? '?'}:${seq?.firstUtc ?? '?'}:#${i}`;
}

export function validateBundleV2(bundle) {
  const errors = [];
  const fail = (recordId, kind, detail) => errors.push({ recordId, kind, detail });

  if (!isPlainObject(bundle)) {
    fail('bundle', 'not-an-object', 'bundle is not a plain object');
    return { valid: false, errors, rejections: errors };
  }
  if (bundle.schema !== SCHEMA_V2) {
    fail('bundle', 'schema', `schema must be "${SCHEMA_V2}", got ${JSON.stringify(bundle.schema)}`);
  }
  // Q2 (Hark condition): reserved means reserved.
  if ('scenes' in bundle) {
    fail('bundle', 'scenes-emitted', 'bundle emits scenes[] — the section is reserved in v2 and must not be emitted');
  }
  if (!Number.isInteger(bundle.bundleSeq) || bundle.bundleSeq < 1) {
    fail('bundle', 'bundleSeq', 'bundleSeq must be a positive integer');
  }
  if (!(bundle.newestFetchUtc === null || typeof bundle.newestFetchUtc === 'string')) {
    fail('bundle', 'newestFetchUtc', 'newestFetchUtc must be an ISO string or null');
  }
  if (typeof bundle.dataAgeSeconds !== 'number' || !Number.isFinite(bundle.dataAgeSeconds)) {
    fail('bundle', 'dataAgeSeconds', 'dataAgeSeconds must be a finite number');
  }

  // --- world ---
  const world = bundle.world;
  if (!isPlainObject(world)) {
    fail('bundle', 'world', 'world must be an object');
  } else {
    if (typeof world.bookId !== 'string' || !/^world-\d+$/.test(world.bookId)) {
      fail('bundle', 'world.bookId', `world.bookId must be a world-NNN id, got ${JSON.stringify(world.bookId)}`);
    }
    if (world.integritySource !== INTEGRITY_SOURCE) {
      fail('bundle', 'world.integritySource', `world.integritySource must be exactly "${INTEGRITY_SOURCE}" (Amendment A1 — Tier P publishes no building integrity), got ${JSON.stringify(world.integritySource)}`);
    }
    if (!('facts' in world)) {
      fail('bundle', 'world.facts', 'world.facts key must be present (null when no facts stream exists)');
    } else if (world.facts !== null) {
      const f = world.facts;
      if (!isPlainObject(f) || f.schema !== FACTS_SCHEMA || !Number.isInteger(f.seq) || f.seq < 0) {
        fail('bundle', 'world.facts', `world.facts must be null or { schema: "${FACTS_SCHEMA}", seq: <int> }`);
      }
    }
  }

  // --- counters / ember / journeys ---
  if (!isPlainObject(bundle.counters)) {
    fail('bundle', 'counters', 'counters must be an object');
  } else {
    for (const f of COUNTER_FIELDS) {
      if (typeof bundle.counters[f] !== 'number') fail('bundle', 'counters', `counters.${f} must be a number`);
    }
  }
  if (!isPlainObject(bundle.ember) || !Array.isArray(bundle.ember.districts) ||
      !Array.isArray(bundle.ember.plots) || !Array.isArray(bundle.ember.works)) {
    fail('bundle', 'ember', 'ember must carry districts[], plots[], works[]');
  }
  if (!Array.isArray(bundle.journeys)) fail('bundle', 'journeys', 'journeys must be an array');

  // --- citizens (PORTAL-KEY clauses, mechanically checkable parts) ---
  const citizenKeys = new Set();
  if (!Array.isArray(bundle.citizens)) {
    fail('bundle', 'citizens', 'citizens must be an array');
  } else {
    bundle.citizens.forEach((c, i) => {
      const id = typeof c?.citizenKey === 'string' && c.citizenKey !== '' ? c.citizenKey : `citizen:#${i}`;
      if (!isPlainObject(c)) { fail(id, 'citizen-shape', 'citizen record is not an object'); return; }
      // K1: prefix is part of the value; handle is never evidenced.
      if (typeof c.citizenKey !== 'string' || !c.citizenKey.startsWith('portal-key:') || c.citizenKey === 'portal-key:') {
        fail(id, 'citizenKey-prefix', 'citizenKey must be a non-empty "portal-key:<slug>" value (K1)');
      } else if (citizenKeys.has(c.citizenKey)) {
        fail(id, 'citizenKey-duplicate', 'citizenKey values must be unique');
      } else {
        citizenKeys.add(c.citizenKey);
      }
      if (c.handle !== '') fail(id, 'handle', 'handle must stay "" — Tier P evidences no handles (K1)');
      // K2: raw name + first-seen ride beside the key.
      if (typeof c.name !== 'string') fail(id, 'name', 'raw display name must ride beside the key (K2)');
      if (!('firstSeenUtc' in c) || !(c.firstSeenUtc === null || typeof c.firstSeenUtc === 'string')) {
        fail(id, 'firstSeenUtc', 'firstSeenUtc must be present beside the key, an ISO string or null (K2)');
      }
      // citizenId: required but nullable; status required and consistent.
      if (!('citizenId' in c) || !(c.citizenId === null || (typeof c.citizenId === 'string' && c.citizenId !== ''))) {
        fail(id, 'citizenId', 'citizenId must be present: null (unverified) or a non-empty string');
      }
      if (!CITIZEN_ID_STATUSES.includes(c.citizenIdStatus)) {
        fail(id, 'citizenIdStatus', `citizenIdStatus must be one of ${CITIZEN_ID_STATUSES.join(' | ')}`);
      } else if (c.citizenIdStatus === 'BOUND' && typeof c.citizenId !== 'string') {
        fail(id, 'citizenIdStatus', 'BOUND requires a non-null citizenId');
      } else if (c.citizenIdStatus !== 'BOUND' && c.citizenId !== null) {
        fail(id, 'citizenIdStatus', `${c.citizenIdStatus} requires citizenId null — only BOUND carries an id`);
      }
      // Q3: presenceClass has no derivation rule; it is not a v2 field.
      if ('presenceClass' in c) {
        fail(id, 'presenceClass-emitted', 'citizens[].presenceClass is deferred in v2 and must not be emitted (Q3)');
      }
      if (!CITIZEN_STATES.includes(c.state)) fail(id, 'state', `state must be one of ${CITIZEN_STATES.join(' | ')}`);
      if (!isPlainObject(c.provenance) || typeof c.provenance.route !== 'string') {
        fail(id, 'provenance', 'provenance { route, fetchedUtc } is required');
      }
    });
  }

  // --- citizenCollisions (K5: published, never folded) ---
  if (!Array.isArray(bundle.citizenCollisions)) {
    fail('bundle', 'citizenCollisions', 'citizenCollisions must be present as an array (may be [])');
  } else {
    bundle.citizenCollisions.forEach((col, i) => {
      const id = `collision:${col?.key ?? `#${i}`}`;
      if (!isPlainObject(col) || typeof col.key !== 'string' || !col.key.startsWith('portal-key:')) {
        fail(id, 'collision-shape', 'collision entry needs its bare portal-key as `key` (K5)');
        return;
      }
      if (!Array.isArray(col.names) || col.names.length === 0 || !col.names.every((n) => typeof n === 'string')) {
        fail(id, 'collision-shape', 'collision entry needs `names`: the group\'s raw names (K5)');
      }
      if (!Array.isArray(col.citizenKeys) || col.citizenKeys.length < 2 ||
          !col.citizenKeys.every((k) => typeof k === 'string' && k.startsWith(col.key))) {
        fail(id, 'collision-shape', 'collision entry needs `citizenKeys`: 2+ assigned keys under the bare key (K5)');
      } else {
        for (const k of col.citizenKeys) {
          if (!citizenKeys.has(k)) fail(id, 'collision-shape', `collision cites citizenKey ${k} with no citizen record`);
        }
      }
    });
  }

  // --- offices (Amendment A3: optional carriage, validated when present) ---
  if ('offices' in bundle) {
    if (!Array.isArray(bundle.offices)) {
      fail('bundle', 'offices', 'offices must be an array when emitted (Amendment A3)');
    } else {
      bundle.offices.forEach((o, i) => {
        const id = `office:${typeof o?.office === 'string' && o.office !== '' ? o.office : `#${i}`}`;
        if (!isPlainObject(o)) { fail(id, 'office-shape', 'office entry is not an object'); return; }
        if (typeof o.office !== 'string' || o.office === '') {
          fail(id, 'office-shape', 'office entry needs its office name (Amendment A3)');
        }
        if (typeof o.name !== 'string' || o.name === '') {
          fail(id, 'office-shape', 'office entry needs the evidenced holder name (Amendment A3)');
        }
        if (!(o.citizenKey === null || (typeof o.citizenKey === 'string' && o.citizenKey.startsWith('portal-key:')))) {
          fail(id, 'office-citizenKey', 'citizenKey must be null (unbound/ambiguous) or a portal-key value (Amendment A3)');
        } else if (typeof o.citizenKey === 'string' && citizenKeys.size && !citizenKeys.has(o.citizenKey)) {
          fail(id, 'office-citizenKey', `office cites citizenKey ${o.citizenKey} with no citizen record in this bundle`);
        }
        if (!isPlainObject(o.provenance) || typeof o.provenance.route !== 'string' || o.provenance.route === '' ||
            !(o.provenance.fetchedUtc === null || typeof o.provenance.fetchedUtc === 'string')) {
          fail(id, 'office-provenance', 'office entry needs provenance { route, fetchedUtc } — the evidenced source route (Amendment A3)');
        }
      });
    }
  }

  // --- ticker ---
  if (!Array.isArray(bundle.ticker)) {
    fail('bundle', 'ticker', 'ticker must be an array');
  } else {
    bundle.ticker.forEach((t, i) => {
      if (!isPlainObject(t) || typeof t.utc !== 'string' || typeof t.text !== 'string' ||
          !Array.isArray(t.handles) || !isPlainObject(t.provenance)) {
        fail(`ticker:#${i}`, 'ticker-shape', 'ticker entries need utc, kind, text, placeCode, handles[], provenance');
      } else if ('dueUtc' in t && !(typeof t.dueUtc === 'string' && Number.isFinite(Date.parse(t.dueUtc)))) {
        // Amendment A3: dueUtc is optional carriage; when present it
        // must be a real date stamp, never prose mined from the text.
        fail(`ticker:#${i}`, 'ticker-dueUtc', 'dueUtc, when present, must be a parseable ISO date string (Amendment A3)');
      }
    });
  }

  // --- episodes (§1.4 + disclosure validity) ---
  if (!Array.isArray(bundle.episodes)) {
    fail('bundle', 'episodes', 'episodes must be present as an array (may be [])');
  } else {
    bundle.episodes.forEach((ep, i) => {
      const id = episodeRecordId(ep, i);
      if (!isPlainObject(ep)) { fail(id, 'episode-shape', 'episode is not an object'); return; }
      if (typeof ep.place !== 'string' || ep.place === '') fail(id, 'episode-shape', 'episode.place is required');
      if (!Array.isArray(ep.participants) || new Set(ep.participants).size < 2 ||
          !ep.participants.every((p) => typeof p === 'string')) {
        fail(id, 'episode-shape', 'episode.participants must be 2+ distinct speaker names');
      }
      if (!Number.isFinite(Date.parse(ep.firstUtc)) || !Number.isFinite(Date.parse(ep.lastUtc)) ||
          Date.parse(ep.firstUtc) > Date.parse(ep.lastUtc)) {
        fail(id, 'episode-shape', 'episode firstUtc/lastUtc must be ordered ISO stamps');
      }
      if (!Number.isInteger(ep.utteranceCount) || ep.utteranceCount < 2) {
        fail(id, 'episode-shape', 'episode.utteranceCount must be an integer >= 2');
      }
      if (typeof ep.corroborated !== 'boolean' ||
          (ep.corroborated === false && ep.corroboratedBy !== null) ||
          (ep.corroborated === true && !isPlainObject(ep.corroboratedBy))) {
        fail(id, 'episode-shape', 'corroboratedBy must be an object when corroborated, null when not');
      }
      // Disclosure: the verbatim filed template or INVALID — a stub or
      // an altered string fails exactly like a missing one.
      if (ep.disclosure !== DISCLOSURE) {
        fail(id, 'disclosure', 'episode disclosure must be the verbatim filed template (episodes.mjs DISCLOSURE); missing, stub, or altered text is invalid');
      }
    });
  }

  // --- act sequences (§1.5 + disclosure validity) ---
  if (!Array.isArray(bundle.actSequences)) {
    fail('bundle', 'actSequences', 'actSequences must be present as an array (may be [])');
  } else {
    bundle.actSequences.forEach((seq, i) => {
      const id = actSequenceRecordId(seq, i);
      if (!isPlainObject(seq)) { fail(id, 'actSequence-shape', 'act sequence is not an object'); return; }
      if (typeof seq.actor !== 'string' || seq.actor === '' || typeof seq.kind !== 'string' || seq.kind === '') {
        fail(id, 'actSequence-shape', 'act sequence needs an actor and a kind');
      }
      if (seq.presentation !== 'acts-only') {
        fail(id, 'actSequence-shape', 'presentation must be the literal "acts-only" — a sequence asserts no ongoing state');
      }
      if (!Array.isArray(seq.acts) || seq.acts.length < 2 || seq.count !== seq.acts.length) {
        fail(id, 'actSequence-shape', 'act sequence needs acts[] of 2+ and count === acts.length');
      } else {
        for (const a of seq.acts) {
          if (!isPlainObject(a) || !Number.isFinite(Date.parse(a.at)) || typeof a.phrase !== 'string' ||
              !(a.cell === null || Array.isArray(a.cell))) {
            fail(id, 'actSequence-shape', 'each act needs { at, phrase, cell[]|null }');
            break;
          }
        }
      }
      if (seq.disclosure !== ACTS_DISCLOSURE) {
        fail(id, 'disclosure', 'act-sequence disclosure must be the verbatim filed template (episodes.mjs ACTS_DISCLOSURE); missing, stub, or altered text is invalid');
      }
    });
  }

  return { valid: errors.length === 0, errors, rejections: errors };
}

export function validateManifestV2(manifest) {
  const errors = [];
  const fail = (kind, detail) => errors.push({ recordId: 'manifest', kind, detail });
  if (!isPlainObject(manifest)) {
    fail('not-an-object', 'manifest is not a plain object');
    return { valid: false, errors, rejections: errors };
  }
  if (manifest.schema !== SCHEMA_V2) fail('schema', `manifest schema must be "${SCHEMA_V2}"`);
  if (!Number.isInteger(manifest.bundleSeq) || manifest.bundleSeq < 1) fail('bundleSeq', 'bundleSeq must be a positive integer');
  if (typeof manifest.worlddataHash !== 'string' || !/^[0-9a-f]{64}$/.test(manifest.worlddataHash)) {
    fail('worlddataHash', 'worlddataHash must be a sha256 hex digest');
  }
  if (!('facts' in manifest)) {
    fail('facts', 'manifest must cite the facts stream by key: null or { schema, seq } (Hark Q4)');
  } else if (manifest.facts !== null) {
    const f = manifest.facts;
    if (!isPlainObject(f) || f.schema !== FACTS_SCHEMA || !Number.isInteger(f.seq) || f.seq < 0) {
      fail('facts', `manifest facts must be null or { schema: "${FACTS_SCHEMA}", seq: <int> }`);
    }
  }
  return { valid: errors.length === 0, errors, rejections: errors };
}

// Append rejections to a JSONL log — the audit trail that keeps a
// rejected record from disappearing silently.
export async function logRejections(logPath, rejections, atUtc = new Date().toISOString()) {
  if (!rejections.length) return 0;
  const lines = rejections.map((r) => JSON.stringify({ atUtc, ...r })).join('\n') + '\n';
  await appendFile(logPath, lines, 'utf8');
  return rejections.length;
}

async function main() {
  const args = process.argv.slice(2);
  const file = args.find((a) => !a.startsWith('--'));
  if (!file) {
    console.error('usage: node validate-v2.mjs <world-data.json> [--rejections <log.jsonl>]');
    process.exitCode = 2;
    return;
  }
  const ri = args.indexOf('--rejections');
  const logPath = ri >= 0 ? args[ri + 1] : join(dirname(file), 'validation-rejections.jsonl');
  const bundle = JSON.parse(await readFile(file, 'utf8'));
  const { valid, errors, rejections } = validateBundleV2(bundle);
  if (rejections.length) await logRejections(logPath, rejections);
  for (const e of errors) console.error(`reject ${e.recordId} [${e.kind}]: ${e.detail}`);
  console.log(JSON.stringify({ valid, rejections: rejections.length, log: rejections.length ? logPath : null }, null, 2));
  if (!valid) process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => {
    console.error('validate-v2 failed:', err);
    process.exitCode = 1;
  });
}
