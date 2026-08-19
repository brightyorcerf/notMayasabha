/**
 * Smoke test. Runs the whole derived pipeline headlessly and prints what a judge
 * will be shown. If this is red, do not open the browser.
 */
import { loadDoc, derive, statusGate } from '../src/core/site';
import { Session } from '../src/core/session';
import { unscaledRecord, calibrationMpu } from '../src/core/scale';
import {
  buildRoomGraph, bridges, articulationPoints, route, betweenness,
  isolationOf, deadEnds, OUTSIDE,
} from '../src/analysis/graph';
import { blockedAt } from '../src/core/grid';

const t0 = Date.now();
const s = new Session(loadDoc());
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

const d2 = derive(loadDoc());
const fail =
  br.size === 0 || ap.size === 0 ||
  blockedAt(gg, 2.0, 26) || !blockedAt(gg, 2.0, 20) ||
  !route(gr, OUTSIDE, target.key) ||
  !s.verifyChain() ||
  !gate.briefingAllowed ||
  d2.hash !== derive(loadDoc()).hash;  // determinism: same input, same hash
console.log(`\n  determinism: ${d2.hash} == ${derive(loadDoc()).hash}`);
console.log(fail ? '\nSMOKE FAILED\n' : '\nSMOKE OK\n');
process.exit(fail ? 1 : 0);
