// astar.test.mjs — deterministic A* over the staged Ember layout.
// Run: node --test test/astar.test.mjs   (from build/engine/)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { findPath, findRoute, nodeByCode } from '../astar.mjs';

const layout = JSON.parse(
  readFileSync(new URL('../../shared/ember-layout.json', import.meta.url), 'utf8'),
);

const edgeKey = (a, b) => [a, b].sort().join('|');
const edgeSet = new Set(layout.edges.map((e) => edgeKey(e.a, e.b)));

test('layout sanity: required places present, graph connected', () => {
  const required = [
    'EMBER_PLAZA_OF_UNITY',
    'EMBER_COLLEGE',
    'EMBER_TOWNHALL',
    'MARKET_HALL',
    'PUBLIC_WORKSHOP',
    'LIBRARY_ANNEX',
    'EMBER_DISTRICT_3_PLOT_18',
    'EMBER_DISTRICT_1_PLOT_31',
  ];
  for (const code of required) assert.ok(nodeByCode(layout, code), `missing node ${code}`);
  const homes = layout.nodes.filter((n) => /HOME/.test(n.code));
  assert.equal(homes.length, 2, 'two generic homes');
  for (const home of homes) assert.equal(home.codeStatus, 'staging');
  // Every node reaches every other node (connected street graph).
  for (const a of layout.nodes) {
    for (const b of layout.nodes) {
      assert.ok(findPath(layout, a.code, b.code), `no route ${a.code} -> ${b.code}`);
    }
  }
});

test('route validity: every step of every returned path uses a layout edge', () => {
  const pairs = [
    ['LIBRARY_ANNEX', 'EMBER_COLLEGE'],
    ['EMBER_HOME_MAPLE_COTTAGE', 'EMBER_HOME_WILLOW_COTTAGE'],
    ['EMBER_DISTRICT_1_PLOT_31', 'EMBER_DISTRICT_3_PLOT_18'],
    ['EMBER_TOWNHALL', 'PUBLIC_WORKSHOP'],
  ];
  for (const [from, to] of pairs) {
    const { path } = findPath(layout, from, to);
    assert.equal(path[0], from);
    assert.equal(path[path.length - 1], to);
    for (let i = 0; i + 1 < path.length; i++) {
      assert.ok(edgeSet.has(edgeKey(path[i], path[i + 1])), `non-edge ${path[i]} -> ${path[i + 1]}`);
    }
  }
});

test('known least-seconds route: Maple Cottage to Willow Cottage', () => {
  const { path, cost } = findPath(
    layout,
    'EMBER_HOME_MAPLE_COTTAGE',
    'EMBER_HOME_WILLOW_COTTAGE',
  );
  assert.deepEqual(path, [
    'EMBER_HOME_MAPLE_COTTAGE',
    'MARKET_HALL',
    'EMBER_PLAZA_OF_UNITY',
    'PUBLIC_WORKSHOP',
    'EMBER_HOME_WILLOW_COTTAGE',
  ]);
  assert.equal(cost, 4 + 8 + 8 + 4);
});

test('determinism: same query, same path, across 25 runs', () => {
  const first = findPath(layout, 'LIBRARY_ANNEX', 'EMBER_DISTRICT_3_PLOT_18');
  for (let i = 0; i < 25; i++) {
    assert.deepEqual(findPath(layout, 'LIBRARY_ANNEX', 'EMBER_DISTRICT_3_PLOT_18'), first);
  }
  const r1 = findRoute(layout, 'EMBER_TOWNHALL', 'LIBRARY_ANNEX');
  for (let i = 0; i < 25; i++) {
    assert.deepEqual(findRoute(layout, 'EMBER_TOWNHALL', 'LIBRARY_ANNEX'), r1);
  }
});

test('same place: trivial path, zero cost', () => {
  assert.deepEqual(findPath(layout, 'EMBER_PLAZA_OF_UNITY', 'EMBER_PLAZA_OF_UNITY'), {
    path: ['EMBER_PLAZA_OF_UNITY'],
    cost: 0,
  });
});

test('unknown code and unreachable graph both yield null', () => {
  assert.equal(findPath(layout, 'NOPE', 'EMBER_COLLEGE'), null);
  assert.equal(findPath(layout, 'EMBER_COLLEGE', 'NOPE'), null);
  const islands = {
    version: 1,
    nodes: [
      { code: 'A', label: 'A', x: 0, y: 0, kind: 'room' },
      { code: 'B', label: 'B', x: 5, y: 0, kind: 'room' },
    ],
    edges: [],
  };
  assert.equal(findPath(islands, 'A', 'B'), null);
  assert.equal(findRoute(islands, 'A', 'B'), null);
});
