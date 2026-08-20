/**
 * Smoke test. Runs the whole derived pipeline headlessly and prints what a judge
 * will be shown. If this is red, do not open the browser.
 */
import { loadDoc, derive, statusGate, PLANS } from '../src/core/site';
import { Session } from '../src/core/session';
import { unscaledRecord, calibrationMpu } from '../src/core/scale';
import {
  buildRoomGraph, bridges, articulationPoints, route, betweenness,
  isolationOf, deadEnds, OUTSIDE,
} from '../src/analysis/graph';
import { blockedAt } from '../src/core/grid';
import { walkPath } from '../src/analysis/path';

const t0 = Date.now();
const s = new Session(loadDoc('mahindra'));
const gr = buildRoomGraph(s.doc, s.derived.grids);
const br = bridges(gr);
const ap = articulationPoints(gr);
const bc = betweenness(gr);
const ms = Date.now() - t0;

const mpu = s.derived.mpu;
console.log(`\n=== ${s.doc.building.name} — schema ${s.doc.schema_version} — hash ${s.derived.hash} — derived in ${ms} ms ===`);
console.log(`scale: ${s.doc.scale.meters_per_unit} m/unit (${s.doc.scale.method}, ${s.doc.scale.state})`);

console.log('\n-- scale sanity checks (v2 C6) --');
for (const c of s.derived.checks) {
  console.log(`  ${c.result.padEnd(4)} ${c.name.padEnd(16)} ${c.measured.toFixed(2).padStart(7)}  band ${c.expected_lo}–${c.expected_hi}  (${c.note})`);
}

console.log('\n-- rooms --');
for (const n of gr.nodes.values()) {
  if (n.key === OUTSIDE) continue;
  console.log(
    `  L${n.level} ${n.name.padEnd(18)} ${(n.area_u2 * mpu * mpu).toFixed(1).padStart(6)} m²` +
    `  doors=${gr.adj.get(n.key)!.length}  btw=${bc.get(n.key)!.toFixed(1).padStart(5)}` +
    `${ap.has(n.key) ? '  <-- CRITICAL ROOM' : ''}`,
  );
}

console.log('\n-- critical doors (bridges) --');
for (const e of gr.edges) {
  if (!br.has(e.key)) continue;
  const iso = isolationOf(gr, e.key);
  console.log(`  ${e.kind.padEnd(5)} ${(e.opening_id ?? e.stair_id ?? '').padEnd(10)} ${e.label.padEnd(42)} sealing it isolates ${iso.length} space(s)`);
}
console.log(`\n-- dead ends --  ${deadEnds(gr).map((k) => gr.nodes.get(k)!.name).join(', ')}`);

const target = [...gr.nodes.values()].find((n) => n.name === 'ECR 3')!;
const upper = [...gr.nodes.values()].find((n) => n.name === 'Faculty 4')!;
for (const dest of [target, upper]) {
  const r = route(gr, OUTSIDE, dest.key);
  console.log(`\n-- route: Exterior -> ${dest.name} --`);
  console.log(r ? `  ${r.doors} doors: ` + r.nodes.map((k) => gr.nodes.get(k)!.name).join(' -> ') : '  NO ROUTE');
}

const gg = s.derived.grids.get('st-ground')!;
console.log('\n-- occupancy grid --');
console.log(`  doorway at main entry blocked? ${blockedAt(gg, 2.0, 26)}  (must be false)`);
console.log(`  solid wall at (2.0, 20) blocked? ${blockedAt(gg, 2.0, 20)}  (must be true)`);

let gate = statusGate(s.doc, s.derived.findings, new Set());
console.log(`\n-- gate at load --  blocking=${gate.blocking.length} warning=${gate.warnings.length} export=${gate.exportAllowed} briefing=${gate.briefingAllowed}`);

// --- the op log, exercised the way the demo exercises it ---
console.log('\n-- op log --');
s.do('SET_WALL_PROPS', ['w-rad-72'], { breachable: true, breach_note: 'Half brick. Operator assessed.' }, 'mark breachable');
s.do('ADD_MARKER', ['mk-1'], { storey_id: 'st-ground', x_u: 40, y_u: 30, kind: 'THREAT', label: 'Suspect last seen' }, 'threat marker');
s.do('CLEAR_SCALE', [], { scale: unscaledRecord(new Date().toISOString()) }, 'clear scale');
gate = statusGate(s.doc, s.derived.findings, new Set());
console.log(`  after CLEAR_SCALE: unscaled=${s.derived.unscaled} displayMpu=${s.derived.mpu.toFixed(4)} export=${gate.exportAllowed} blocking=${gate.blocking.length}`);
const back = calibrationMpu([0, 0], [20, 0], 20);
s.do('SET_SCALE', [], {
  scale: { state: 'VALIDATED', meters_per_unit: back, method: 'CALIBRATION_SEGMENT',
    calibration: { p0: [0, 0], p1: [20, 0], real_length_m: 20 }, checks: [], evidence: [],
    dispersion: 0, confidence: 1, set_by: 'USER', set_at: new Date().toISOString() },
}, 'calibrate 20 m');
gate = statusGate(s.doc, s.derived.findings, new Set());
console.log(`  after SET_SCALE:   unscaled=${s.derived.unscaled} mpu=${s.derived.mpu} export=${gate.exportAllowed}`);
s.undo();
console.log(`  after undo:        unscaled=${s.derived.unscaled} ops=${s.ops.length}`);
s.do('SET_SCALE', [], {
  scale: { state: 'VALIDATED', meters_per_unit: back, method: 'CALIBRATION_SEGMENT',
    calibration: { p0: [0, 0], p1: [20, 0], real_length_m: 20 }, checks: [], evidence: [],
    dispersion: 0, confidence: 1, set_by: 'USER', set_at: new Date().toISOString() },
}, 'calibrate 20 m');
s.do('SET_STATUS', [], { status: 'REVIEWED' }, 'review');
s.do('SET_STATUS', [], { status: 'LOCKED' }, 'lock');
const m = s.metrics;
console.log(`  ops=${m.total_ops} corrective=${m.corrective_ops} correction_density=${m.correction_density.toFixed(4)} verified=${(m.verified_fraction * 100).toFixed(0)}%`);
console.log(`  chain intact: ${s.verifyChain()}`);
gate = statusGate(s.doc, s.derived.findings, new Set());
console.log(`  briefing allowed after LOCKED: ${gate.briefingAllowed}`);

const d2 = derive(loadDoc('mahindra'));
const fail =
  br.size === 0 || ap.size === 0 ||
  blockedAt(gg, 2.0, 26) || !blockedAt(gg, 2.0, 20) ||
  !route(gr, OUTSIDE, target.key) ||
  !s.verifyChain() ||
  !gate.briefingAllowed ||
  d2.hash !== derive(loadDoc('mahindra')).hash;  // determinism: same input, same hash
console.log(`\n  determinism: ${d2.hash} == ${derive(loadDoc('mahindra')).hash}`);

/**
 * Every bundled plan, checked for the properties that must hold whatever the
 * blueprint is. The run above is deep but Mahindra-specific — it names rooms and wall
 * IDs — so it cannot speak for the other plans. This pass names nothing: it asserts
 * that each plan derives without a blocking finding, extracts rooms, is fully
 * reachable from the exterior, and hashes the same twice. That is the CLAUDE.md §9
 * guarantee, applied to every plan the demo can actually load.
 */
console.log('\n-- every bundled plan (structural) --');
let planFail = false;
for (const p of PLANS) {
  const doc = loadDoc(p.id);
  const d = derive(doc);
  const g = buildRoomGraph(doc, d.grids);
  const rooms = [...g.nodes.values()].filter((n) => n.key !== OUTSIDE);
  const unreachable = rooms.filter((n) => !route(g, OUTSIDE, n.key));
  const gt = statusGate(doc, d.findings, new Set());
  const stable = d.hash === derive(loadDoc(p.id)).hash;

  // Every walkthrough path, sampled against the collision mask. This is the assertion
  // the animated preview never had: the old centroid-to-door polyline was spline-
  // smoothed into the walls it was supposed to thread, on 11 of 18 routes.
  let pierced = 0, worstRoom = '';
  for (const n of rooms) {
    const r = route(g, OUTSIDE, n.key);
    if (!r) continue;
    const wp = walkPath(g, r, doc, d.grids, d.mpu);
    for (let i = 1; i < wp.points.length; i++) {
      const a = wp.points[i - 1], b = wp.points[i];
      if (a.storey_id !== b.storey_id) continue;
      const gg = d.grids.get(a.storey_id);
      if (!gg) continue;
      const steps = Math.max(2, Math.ceil(Math.hypot(b.x_u - a.x_u, b.y_u - a.y_u) / gg.cell));
      for (let t = 0; t <= steps; t++) {
        const x = a.x_u + (b.x_u - a.x_u) * (t / steps), y = a.y_u + (b.y_u - a.y_u) * (t / steps);
        const ci = Math.floor((x - gg.x0) / gg.cell), cj = Math.floor((y - gg.y0) / gg.cell);
        if (ci < 0 || ci >= gg.nx || cj < 0 || cj >= gg.ny) continue;
        if (blockedAt(gg, x, y)) { pierced++; if (!worstRoom) worstRoom = n.name; }
      }
    }
  }

  const ok = rooms.length > 0 && unreachable.length === 0 && gt.blocking.length === 0
    && stable && pierced === 0;
  if (!ok) planFail = true;
  console.log(
    `  ${ok ? 'OK  ' : 'FAIL'} ${p.id.padEnd(15)} storeys=${d.grids.size} rooms=${String(rooms.length).padStart(2)}` +
    `  unreachable=${unreachable.length}  blocking=${gt.blocking.length}  wall-pierce=${pierced}` +
    `  hash=${d.hash}${stable ? '' : ' UNSTABLE'}` +
    `${pierced ? '  [first: ' + worstRoom + ']' : ''}` +
    `${unreachable.length ? '  [' + unreachable.map((n) => n.name).join(', ') + ']' : ''}`,
  );
}

const allFail = fail || planFail;
console.log(allFail ? '\nSMOKE FAILED\n' : '\nSMOKE OK\n');
process.exit(allFail ? 1 : 0);
