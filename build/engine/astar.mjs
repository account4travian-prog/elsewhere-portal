// astar.mjs — deterministic A* over the staged Ember layout graph.
// Pure ESM, no dependencies, browser + Node compatible.
//
// Cost of an edge is its presentation `seconds`. The heuristic is Euclidean
// grid distance scaled by the smallest seconds-per-unit ratio in the layout,
// which keeps it admissible (never overestimates), so the returned path is a
// true least-seconds path. Determinism: neighbours are expanded in compass
// order N, E, S, W (dominant axis), then by code; the open list orders by
// (f, h, insertion sequence); a parent is replaced only on a strictly
// smaller g. Same query + same layout => same path, every run.

function nodeMap(layout) {
  const map = new Map();
  for (const n of layout.nodes) map.set(n.code, n);
  return map;
}

export function nodeByCode(layout, code) {
  return layout.nodes.find((n) => n.code === code);
}

function adjacency(layout) {
  const adj = new Map();
  for (const n of layout.nodes) adj.set(n.code, []);
  for (const e of layout.edges) {
    if (!adj.has(e.a) || !adj.has(e.b)) continue;
    adj.get(e.a).push({ to: e.b, seconds: e.seconds });
    adj.get(e.b).push({ to: e.a, seconds: e.seconds });
  }
  return adj;
}

// Compass rank of the direction from `from` node to `to` node: N=0, E=1,
// S=2, W=3, by dominant axis. Used only for tie-breaking expansion order.
function directionRank(from, to) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (Math.abs(dy) >= Math.abs(dx)) return dy < 0 ? 0 : 2; // N or S dominant
  return dx > 0 ? 1 : 3; // E or W dominant
}

function minSecondsPerUnit(layout, nodes) {
  let min = Infinity;
  for (const e of layout.edges) {
    const a = nodes.get(e.a);
    const b = nodes.get(e.b);
    if (!a || !b) continue;
    const d = Math.hypot(b.x - a.x, b.y - a.y);
    if (d > 0) min = Math.min(min, e.seconds / d);
  }
  return Number.isFinite(min) ? min : 1;
}

/**
 * findPath(layout, fromCode, toCode)
 * -> { path: [code, ...], cost }  (cost = total presentation seconds)
 * -> { path: [fromCode], cost: 0 } when fromCode === toCode
 * -> null when either code is unknown or no route exists.
 */
export function findPath(layout, fromCode, toCode) {
  const nodes = nodeMap(layout);
  if (!nodes.has(fromCode) || !nodes.has(toCode)) return null;
  if (fromCode === toCode) return { path: [fromCode], cost: 0 };

  const adj = adjacency(layout);
  const scale = minSecondsPerUnit(layout, nodes);
  const goal = nodes.get(toCode);
  const h = (code) => {
    const n = nodes.get(code);
    return Math.hypot(goal.x - n.x, goal.y - n.y) * scale;
  };

  const gScore = new Map([[fromCode, 0]]);
  const parent = new Map();
  const closed = new Set();
  let seq = 0;
  // Open list entries: {code, f, h, seq}. Small graph: linear min-extract is
  // fine and keeps ordering semantics transparent.
  const open = [{ code: fromCode, f: h(fromCode), h: h(fromCode), seq: seq++ }];

  while (open.length > 0) {
    let best = 0;
    for (let i = 1; i < open.length; i++) {
      const a = open[i];
      const b = open[best];
      if (a.f < b.f || (a.f === b.f && (a.h < b.h || (a.h === b.h && a.seq < b.seq)))) best = i;
    }
    const current = open.splice(best, 1)[0];
    if (closed.has(current.code)) continue;
    closed.add(current.code);

    if (current.code === toCode) {
      const path = [toCode];
      let c = toCode;
      while (parent.has(c)) {
        c = parent.get(c);
        path.unshift(c);
      }
      return { path, cost: gScore.get(toCode) };
    }

    const curNode = nodes.get(current.code);
    const neighbours = [...adj.get(current.code)].sort((p, q) => {
      const rp = directionRank(curNode, nodes.get(p.to));
      const rq = directionRank(curNode, nodes.get(q.to));
      if (rp !== rq) return rp - rq;
      return p.to < q.to ? -1 : p.to > q.to ? 1 : 0;
    });

    for (const nb of neighbours) {
      if (closed.has(nb.to)) continue;
      const tentative = gScore.get(current.code) + nb.seconds;
      if (tentative < (gScore.get(nb.to) ?? Infinity)) {
        gScore.set(nb.to, tentative);
        parent.set(nb.to, current.code);
        const hh = h(nb.to);
        open.push({ code: nb.to, f: tentative + hh, h: hh, seq: seq++ });
      }
    }
  }
  return null;
}

/**
 * findRoute(layout, fromCode, toCode)
 * -> { codes, legs: [{a, b, seconds, distance}], totalSeconds, totalDistance }
 *    or null when findPath finds no route.
 * `distance` is Euclidean grid distance of the leg.
 */
export function findRoute(layout, fromCode, toCode) {
  const found = findPath(layout, fromCode, toCode);
  if (!found) return null;
  const nodes = nodeMap(layout);
  const legs = [];
  let totalDistance = 0;
  for (let i = 0; i + 1 < found.path.length; i++) {
    const a = nodes.get(found.path[i]);
    const b = nodes.get(found.path[i + 1]);
    const edge = layout.edges.find(
      (e) => (e.a === a.code && e.b === b.code) || (e.a === b.code && e.b === a.code),
    );
    const distance = Math.hypot(b.x - a.x, b.y - a.y);
    legs.push({ a: a.code, b: b.code, seconds: edge.seconds, distance });
    totalDistance += distance;
  }
  return { codes: found.path, legs, totalSeconds: found.cost, totalDistance };
}
