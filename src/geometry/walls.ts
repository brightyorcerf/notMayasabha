/**
 * Wall panelisation. The step that turns a centreline graph into buildable solids.
 *
 * Takes:   a wall, its length, and the openings that sit on it.
 * Returns: a list of rectangular panels in wall-local coordinates (s along, z up).
 * Assumes: an opening is a rectangular hole. A panel is produced above the head and
 *          below the sill, so a window keeps its lintel and its parapet.
 *
 * Junctions are solved by extending each wall by half its own thickness at any node
 * where two or more walls meet. Overlap inside a junction is invisible and free.
 */

import type { Wall, Opening, Storey } from '../core/types';
import { nodeMap, wallLength, openingStart } from '../core/grid';

export interface Panel { s0: number; s1: number; z0: number; z1: number; }

export function nodeDegrees(st: Storey): Map<string, number> {
  const deg = new Map<string, number>();
  for (const w of st.walls) {
    deg.set(w.a, (deg.get(w.a) ?? 0) + 1);
    deg.set(w.b, (deg.get(w.b) ?? 0) + 1);
  }
  return deg;
}

export function wallPanels(
  w: Wall,
  L: number,
  openings: Opening[],
  extA: number,
  extB: number,
): Panel[] {
  const H = w.height_m;
  const holes = openings
    .map((o) => ({ s0: openingStart(o, L), s1: openingStart(o, L) + o.width_u, o }))
    .sort((a, b) => a.s0 - b.s0);

  const panels: Panel[] = [];
  let cursor = -extA;
  for (const h of holes) {
    if (h.s0 > cursor) panels.push({ s0: cursor, s1: h.s0, z0: 0, z1: H });
    if (h.o.sill_m > 0.001) panels.push({ s0: h.s0, s1: h.s1, z0: 0, z1: h.o.sill_m });
    if (h.o.head_m < H - 0.001) panels.push({ s0: h.s0, s1: h.s1, z0: h.o.head_m, z1: H });
    cursor = Math.max(cursor, h.s1);
  }
  if (cursor < L + extB) panels.push({ s0: cursor, s1: L + extB, z0: 0, z1: H });
  return panels.filter((p) => p.s1 - p.s0 > 1e-6 && p.z1 - p.z0 > 1e-6);
}

export interface WallPlan {
  wall: Wall;
  ax: number; ay: number; bx: number; by: number;
  length: number;
  panels: Panel[];
}

export function planStorey(st: Storey): WallPlan[] {
  const N = nodeMap(st);
  const deg = nodeDegrees(st);
  const byWall = new Map<string, Opening[]>();
  for (const o of st.openings) {
    const arr = byWall.get(o.wall_id) ?? [];
    arr.push(o);
    byWall.set(o.wall_id, arr);
  }
  return st.walls.map((w) => {
    const a = N.get(w.a)!, b = N.get(w.b)!;
    const L = wallLength(w, N);
    const extA = (deg.get(w.a) ?? 0) >= 2 ? w.thickness_u / 2 : 0;
    const extB = (deg.get(w.b) ?? 0) >= 2 ? w.thickness_u / 2 : 0;
    return {
      wall: w, ax: a.x_u, ay: a.y_u, bx: b.x_u, by: b.y_u, length: L,
      panels: wallPanels(w, L, byWall.get(w.id) ?? [], extA, extB),
    };
  });
}
