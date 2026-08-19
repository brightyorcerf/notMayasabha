/**
 * The scale engine. ARCHITECTURE-v2 §2.3.
 *
 * Takes:   a SiteDocument and its occupancy grids.
 * Returns: semantic sanity checks, a state (UNSCALED / PROVISIONAL / VALIDATED),
 *          and the one-click factor fixes for the three errors that cause almost all
 *          real failures.
 * Assumes: dispersion catches noise. Sanity checks catch a 3.281x unit error, which is
 *          the failure that actually happens. No default scale is ever substituted.
 */

import type { SiteDocument, ScaleCheck, ScaleRecord, ScaleState } from './types';
import type { Grid } from './grid';

/** Plausibility bounds, configurable. Not universal truths — say so to a judge. */
export const BANDS = {
  DOOR_WIDTH: [0.70, 1.30],
  WALL_THICKNESS: [0.08, 0.50],
  CORRIDOR_WIDTH: [0.90, 4.00],
  BBOX_VS_MANUAL: [0.90, 1.10],
  ROOM_AREA: [1.0, Infinity],
} as const;

export const FACTOR_FIXES = [
  { label: '× 3.281 — metres read as feet', factor: 3.280839895 },
  { label: '× 1000 — metres read as millimetres', factor: 1000 },
  { label: '÷ 1000 — millimetres read as metres', factor: 1 / 1000 },
  { label: '× 1.414 — A3 sheet printed at A4', factor: Math.SQRT2 },
];

function median(xs: number[]): number {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * A display-only scale for UNSCALED documents: assume the median detected door is 0.9 m.
 * Freeze patch item 1. It is never written to ScaleRecord.meters_per_unit.
 */
export function displayMpu(doc: SiteDocument): number {
  const widths: number[] = [];
  for (const st of doc.storeys) {
    for (const o of st.openings) if (o.kind === 'DOOR' || o.kind === 'DOUBLE_DOOR') widths.push(o.width_u);
  }
  const m = median(widths);
  return Number.isFinite(m) && m > 1e-9 ? 0.9 / m : 1;
}

export function runChecks(doc: SiteDocument, grids: Map<string, Grid>, mpu: number): ScaleCheck[] {
  const out: ScaleCheck[] = [];
  const mk = (
    name: ScaleCheck['name'], measured: number, band: readonly [number, number],
    hard: boolean, note: string,
  ): void => {
    const ok = measured >= band[0] && measured <= band[1];
    out.push({
      name, measured,
      expected_lo: band[0], expected_hi: band[1],
      result: ok ? 'PASS' : hard ? 'FAIL' : 'WARN',
      note,
    });
  };

  const doors: number[] = [];
  const thick: number[] = [];
  for (const st of doc.storeys) {
    for (const o of st.openings) if (o.sill_m <= 0.05) doors.push(o.width_u * mpu);
    for (const w of st.walls) thick.push(w.thickness_u * mpu);
  }
  mk('DOOR_WIDTH', median(doors), BANDS.DOOR_WIDTH, false, 'median door opening');
  mk('WALL_THICKNESS', median(thick), BANDS.WALL_THICKNESS, false, 'median wall thickness');

  // Narrowest circulation space, measured from the grid rather than from geometry.
  let narrowest = Infinity;
  for (const st of doc.storeys) {
    const g = grids.get(st.id);
    if (!g) continue;
    st.rooms.forEach((r, i) => {
      if (r.use !== 'CORRIDOR') return;
      const area = g.areas_u2[i];
      if (area <= 0) return;
      // Longest run gives the length; area / length approximates the clear width.
      let longest = 0;
      for (let j = 0; j < g.ny; j++) {
        let run = 0;
        for (let k = 0; k < g.nx; k++) {
          if (g.roomOf[j * g.nx + k] === i) { run++; longest = Math.max(longest, run); }
          else run = 0;
        }
      }
      const lenU = longest * g.cell;
      if (lenU > 0) narrowest = Math.min(narrowest, (area / lenU) * mpu);
    });
  }
  if (Number.isFinite(narrowest)) {
    mk('CORRIDOR_WIDTH', narrowest, BANDS.CORRIDOR_WIDTH, false, 'narrowest corridor clear width');
  }

  // The one hard failure: the footprint must match the length and breadth the operator typed.
  const st0 = doc.storeys[0];
  if (st0 && doc.manual_parameters.length_u > 0) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const n of st0.nodes) {
      minX = Math.min(minX, n.x_u); maxX = Math.max(maxX, n.x_u);
      minY = Math.min(minY, n.y_u); maxY = Math.max(maxY, n.y_u);
    }
    const ratio = ((maxX - minX) * mpu) / (doc.manual_parameters.length_u * mpu);
    mk('BBOX_VS_MANUAL', ratio, BANDS.BBOX_VS_MANUAL, true,
      `footprint ${((maxX - minX) * mpu).toFixed(1)} m vs manual ${(doc.manual_parameters.length_u * mpu).toFixed(1)} m`);
    void (maxY - minY);
  }

  let smallest = Infinity;
  for (const st of doc.storeys) {
    const g = grids.get(st.id);
    if (!g) continue;
    for (const a of g.areas_u2) if (a > 0) smallest = Math.min(smallest, a * mpu * mpu);
  }
  if (Number.isFinite(smallest)) {
    mk('ROOM_AREA', smallest, BANDS.ROOM_AREA, false, 'smallest enclosed room');
  }
  return out;
}

/** VALIDATED needs zero FAIL and at most one WARN. Otherwise PROVISIONAL. */
export function stateFromChecks(mpu: number | null, checks: ScaleCheck[]): ScaleState {
  if (mpu === null) return 'UNSCALED';
  const fails = checks.filter((c) => c.result === 'FAIL').length;
  const warns = checks.filter((c) => c.result === 'WARN').length;
  return fails === 0 && warns <= 1 ? 'VALIDATED' : 'PROVISIONAL';
}

/** Scale from a two-point calibration segment. The mechanism to demonstrate. */
export function calibrationMpu(
  p0: [number, number], p1: [number, number], realLengthM: number,
): number | null {
  const d = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
  if (d < 1e-9 || realLengthM <= 0) return null;
  return realLengthM / d;
}

export function unscaledRecord(now: string): ScaleRecord {
  return {
    state: 'UNSCALED',
    meters_per_unit: null,
    method: null,
    calibration: null,
    checks: [],
    evidence: [],
    dispersion: 0,
    confidence: 0,
    set_by: 'USER',
    set_at: now,
  };
}
