// SMOKE — live action-table completeness census (VER rotation 1,
// 2026-11-03).
//
// This file is NOT part of the deterministic suite and never gates
// it. It is the original live form of the completeness test from
// test/action-table.test.mjs, preserved at full strength as a
// surveillance read: it re-censuses every SURVIVING archived news
// snapshot and reports any headline kind the frozen M3.03 table
// neither maps nor leaves unmapped-with-reason — the table must not
// silently drift behind the record, and this file is where that
// drift is stated. It also reports frozen-census kinds no longer
// visible in the surviving archive (retention thins old snapshots,
// so absence here is a property of the surviving record, not proof a
// kind never occurred).
//
// Dispositioning a reported kind (mapping it, or recording an
// unmapped reason in action-table.mjs) is the data lane's decision —
// this smoke reports; it does not disposition, and it never fails
// the deterministic suites over live drift.
//
// Run per file: node --test test/action-table-live.smoke.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { ACTION_TABLE, UNMAPPED_KINDS, classifyKind } from '../action-table.mjs';

const FROZEN_WAVE1_KINDS = [
  'CITY_EVENT_BEGAN', 'HAPPENING_WITNESSED', 'OUTLOOK_CHANGED', 'RUIN_EXCAVATED', 'STRUCTURE_COLLAPSED',
];

test('SMOKE (live, non-gating): headline kinds in the surviving archive vs the frozen table', (t) => {
  const archiveDir = new URL('../archive/', import.meta.url).pathname;
  const kinds = new Set();
  for (const day of readdirSync(archiveDir)) {
    const dayPath = join(archiveDir, day);
    if (!statSync(dayPath).isDirectory()) continue;
    for (const f of readdirSync(dayPath)) {
      if (!f.startsWith('news-')) continue;
      const payload = JSON.parse(readFileSync(join(dayPath, f), 'utf8'));
      for (const h of payload.headlines || []) kinds.add(h.kind);
    }
  }
  assert.ok(kinds.size > 0, 'census found headline kinds in the surviving archive');
  t.diagnostic(`kinds in the surviving archive: ${[...kinds].sort().join(', ')}`);
  for (const kind of kinds) {
    const cls = classifyKind(kind);
    if (cls.mapped) {
      t.diagnostic(`kind ${kind}: mapped (family=${ACTION_TABLE[kind].family}, provenance=${ACTION_TABLE[kind].provenance})`);
      continue;
    }
    if (typeof UNMAPPED_KINDS[kind] === 'string' && UNMAPPED_KINDS[kind].length > 0) {
      t.diagnostic(`kind ${kind}: unmapped WITH recorded reason — dispositioned`);
      continue;
    }
    t.diagnostic(
      `FINDING: kind ${kind} appears in the live record but the frozen table neither maps it ` +
      'nor records an unmapped reason. It currently presents via the forward-compatible ' +
      'unmapped default (see the synthetic unknown-kind test in action-table.test.mjs). ' +
      'Disposition is owed by the data lane: map it, or record an unmapped reason.',
    );
  }
  for (const kind of FROZEN_WAVE1_KINDS) {
    if (!kinds.has(kind)) {
      t.diagnostic(
        `FINDING: frozen-census kind ${kind} is not visible in the surviving archive ` +
        '(retention has thinned the snapshots that carried it). The frozen census in ' +
        'action-table.test.mjs remains the deterministic record of the freeze.',
      );
    }
  }
});
