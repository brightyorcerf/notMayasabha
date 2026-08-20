/**
 * Document loading, validation and derived state.
 *
 * Takes:   one of the bundled site fixtures, or a document produced by the op log.
 * Returns: grids, findings, scale checks and a content hash. All derived, never stored.
 * Assumes: the fixture is bundled at build time. Nothing is fetched at run time.
 *          Every Finding carries an anchor, so the 2D view, the 3D view and the
 *          findings list can all point at the same entity (invariant: v2 §5).
 */

import type { SiteDocument, Storey, ScaleCheck } from './types';
import { buildGrid, nodeMap, wallLength, openingStart, type Grid } from './grid';
import { runChecks, stateFromChecks, displayMpu } from './scale';
import siteJson from '../../fixtures/site.json';
import trainingBlockJson from '../../fixtures/site-training-block.json';

export type Severity = 'BLOCKING' | 'WARNING' | 'INFO';

export interface Finding {
  id: string;
  severity: Severity;
  check: string;
  message: string;
  storey_id: string | null;
  wall_id?: string;
  room_id?: string;
  opening_id?: string;
  node_id?: string;
}

export interface Derived {
  grids: Map<string, Grid>;
  findings: Finding[];
  checks: ScaleCheck[];
  hash: string;
  /** Metres per document unit for display. Equals the real scale unless UNSCALED. */
  mpu: number;
  /** True when the document has no resolved scale. Measurements are refused. */
  unscaled: boolean;
}

/** Deterministic 32-bit content hash (FNV-1a). Not a cryptographic hash. */
export function contentHash(v: unknown): string {
  const s = JSON.stringify(v);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/**
 * The bundled plans, in demo order. Both are compiled in at build time; switching
 * between them fetches nothing. `mahindra` is the demo hero — a schematic of a real
 * 2D blueprint. `training-block` is the frozen contract fixture of CLAUDE.md §9 and
 * the only two-storey plan, so it is what exercises stairs and inter-floor routing.
 */
export const PLANS = [
  { id: 'mahindra', label: 'Mahindra Block', doc: siteJson },
  { id: 'training-block', label: 'Training Block B', doc: trainingBlockJson },
] as const;

export type PlanId = (typeof PLANS)[number]['id'];

export const DEFAULT_PLAN: PlanId = 'mahindra';

/** True when `v` names a bundled plan. Callers use it to sanitise external input. */
export function isPlanId(v: string | null): v is PlanId {
  return PLANS.some((p) => p.id === v);
}

/**
 * Deep-copy the named plan out of the bundle. The copy matters: Session mutates the
 * document it is handed, and the imported JSON is module-scoped, so handing it out
 * directly would let one plan's edits survive a switch to the other.
 */
export function loadDoc(plan: PlanId = DEFAULT_PLAN): SiteDocument {
  const entry = PLANS.find((p) => p.id === plan);
  if (!entry) throw new Error(`unknown plan: ${plan}`);
  return JSON.parse(JSON.stringify(entry.doc)) as SiteDocument;
}

/** Graph-language validation. "A gap" is not representable when walls share node IDs. */
function validateStorey(st: Storey, grid: Grid, out: Finding[]): void {
  const N = nodeMap(st);
  const deg = new Map<string, number>();
  for (const w of st.walls) {
    deg.set(w.a, (deg.get(w.a) ?? 0) + 1);
    deg.set(w.b, (deg.get(w.b) ?? 0) + 1);
    if (wallLength(w, N) < 1e-6) {
      out.push({ id: `zero-${w.id}`, severity: 'BLOCKING', check: 'ZERO_LENGTH_WALL',
        message: `Wall ${w.id} has zero length.`, storey_id: st.id, wall_id: w.id });
    }
  }
  for (const [id, d] of deg) {
    if (d === 1) {
      out.push({ id: `dangle-${id}`, severity: 'WARNING', check: 'DEGREE_1_NODE',
        message: `Node ${id} ends a wall run. Confirm this is intentional.`, storey_id: st.id, node_id: id });
    }
  }
  for (let i = 0; i < st.nodes.length; i++) {
    for (let j = i + 1; j < st.nodes.length; j++) {
      const a = st.nodes[i], b = st.nodes[j];
      const d = Math.hypot(a.x_u - b.x_u, a.y_u - b.y_u);
      if (d < 0.02) {
        out.push({ id: `coin-${a.id}-${b.id}`, severity: 'WARNING', check: 'UNMERGED_NODES',
          message: `Nodes ${a.id} and ${b.id} are closer than the snap tolerance and are not merged.`,
          storey_id: st.id, node_id: a.id });
      }
    }
  }
  const W = new Map(st.walls.map((w) => [w.id, w]));
  for (const o of st.openings) {
    const w = W.get(o.wall_id);
    if (!w) continue;
    const L = wallLength(w, N);
    const s = openingStart(o, L);
    if (s < -1e-9 || s + o.width_u > L + 1e-9) {
      out.push({ id: `ovf-${o.id}`, severity: 'BLOCKING', check: 'OPENING_OVERFLOWS_WALL',
        message: `Opening ${o.id} runs past the end of wall ${w.id}.`,
        storey_id: st.id, opening_id: o.id, wall_id: w.id });
    }
  }
  grid.orphanRooms.forEach((rid) => {
    out.push({ id: `orphan-${rid}`, severity: 'WARNING', check: 'ORPHAN_ROOM_SEED',
      message: `Room seed ${rid} is not inside an enclosed face. Close the loop, or paint the room by hand.`,
      storey_id: st.id, room_id: rid });
  });
}

export function derive(doc: SiteDocument): Derived {
  const findings: Finding[] = [];
  const grids = new Map<string, Grid>();
  for (const st of doc.storeys) {
    const g = buildGrid(st);
    grids.set(st.id, g);
    validateStorey(st, g, findings);
  }

  const real = doc.scale.meters_per_unit;
  const unscaled = real === null;
  const mpu = unscaled ? displayMpu(doc) : real;
  const checks = unscaled ? [] : runChecks(doc, grids, mpu);

  if (unscaled) {
    findings.push({
      id: 'unscaled', severity: 'BLOCKING', check: 'UNSCALED',
      message: 'UNSCALED MODEL — NOT FOR TACTICAL USE. Rendered in normalised units for ' +
        'inspection only. Areas, distances and export are disabled, not defaulted.',
      storey_id: null,
    });
  } else {
    for (const c of checks) {
      if (c.result === 'PASS') continue;
      findings.push({
        id: `scale-${c.name}`,
        severity: c.result === 'FAIL' ? 'BLOCKING' : 'WARNING',
        check: `SCALE_${c.name}`,
        message: `${c.note}: measured ${c.measured.toFixed(2)}, expected ` +
          `${c.expected_lo}–${c.expected_hi === Infinity ? '∞' : c.expected_hi}. ` +
          (c.result === 'FAIL' ? 'Check the scale factor before you trust any dimension.' : ''),
        storey_id: null,
      });
    }
    const st = stateFromChecks(real, checks);
    if (st === 'PROVISIONAL') {
      findings.push({
        id: 'scale-provisional', severity: 'WARNING', check: 'SCALE_PROVISIONAL',
        message: 'Scale is PROVISIONAL: more than one sanity check is outside its band.',
        storey_id: null,
      });
    }
  }

  let entries = 0;
  for (const s of doc.storeys) for (const o of s.openings) if (o.is_entry) entries++;
  if (entries === 0) {
    findings.push({ id: 'no-entry', severity: 'BLOCKING', check: 'NO_ENTRY_POINT',
      message: 'No entry point is marked. A briefing needs at least one.', storey_id: null });
  }

  for (const s of doc.storeys) {
    for (const w of s.walls) {
      if (w.height_source === 'DEFAULT') {
        findings.push({ id: `def-${w.id}`, severity: 'INFO', check: 'ASSUMED_DIMENSION',
          message: `Wall ${w.id} height is an assumed default, not a measurement.`,
          storey_id: s.id, wall_id: w.id });
      }
    }
  }

  return { grids, findings, checks, hash: contentHash(doc), mpu, unscaled };
}

export interface StatusGate {
  blocking: Finding[];
  warnings: Finding[];
  info: Finding[];
  unaccepted: Finding[];
  canReachReviewed: boolean;
  exportAllowed: boolean;
  briefingAllowed: boolean;
}

/**
 * v2 §3.2, with freeze patch 6: REVIEWED needs zero blocking failures and every
 * warning explicitly accepted by a human. Briefing requires LOCKED.
 */
export function statusGate(
  doc: SiteDocument, findings: Finding[], accepted: Set<string>,
): StatusGate {
  const blocking = findings.filter((f) => f.severity === 'BLOCKING');
  const warnings = findings.filter((f) => f.severity === 'WARNING');
  const info = findings.filter((f) => f.severity === 'INFO');
  const unaccepted = warnings.filter((w) => !accepted.has(w.id));
  return {
    blocking, warnings, info, unaccepted,
    canReachReviewed: blocking.length === 0 && unaccepted.length === 0,
    exportAllowed: blocking.length === 0,
    briefingAllowed: doc.status === 'LOCKED',
  };
}
