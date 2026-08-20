/**
 * The occupancy grid. One derived artifact, four consumers.
 *
 * Takes:   one Storey, in document units.
 * Returns: a wall mask, a walkable mask, a room label per cell, and room areas.
 * Assumes: walls fully enclose rooms. A room is found by flood fill from its seed point.
 *          Derived data. Never persisted. Recomputed on every model change.
 *
 * Why a grid and not a polygonizer: a flood fill degrades gracefully. An unclosed
 * wall loop leaks into the neighbour and produces one large room, which is visible
 * and correctable. A polygonizer throws.
 */

import type { Storey, Opening, Wall, Node } from './types';

export const CELL_U = 0.05;
/** Space kept outside the footprint, so the operator can walk up to the building. */
const PAD_U = 9.0;

export interface Grid {
  x0: number; y0: number;
  nx: number; ny: number;
  cell: number;
  /** 1 where a wall stands. Doorways are NOT carved. Bounds rooms. */
  wallMask: Uint8Array;
  /** 1 where a person cannot stand. Doorways ARE carved. Drives collision. */
  walkMask: Uint8Array;
  /** index into storey.rooms, or -1 */
  roomOf: Int16Array;
  /** 1 where the cell is outside the building envelope */
  outsideMask: Uint8Array;
  areas_u2: number[];
  /** Rooms whose seed landed in no enclosed face. Warn, do not fail. */
  orphanRooms: string[];
}

export interface Seg { ax: number; ay: number; bx: number; by: number; }

export function nodeMap(st: Storey): Map<string, Node> {
  return new Map(st.nodes.map((n) => [n.id, n]));
}

export function wallSeg(w: Wall, N: Map<string, Node>): Seg {
  const a = N.get(w.a)!, b = N.get(w.b)!;
  return { ax: a.x_u, ay: a.y_u, bx: b.x_u, by: b.y_u };
}

export function wallLength(w: Wall, N: Map<string, Node>): number {
  const s = wallSeg(w, N);
  return Math.hypot(s.bx - s.ax, s.by - s.ay);
}

/** Distance along the wall from node A to the start of the opening. */
export function openingStart(o: Opening, wallLen: number): number {
  return o.anchor === 'FROM_A' ? o.offset_u : wallLen - o.offset_u - o.width_u;
}

/** Centre point of an opening, in document units, on the wall centreline. */
export function openingCentre(o: Opening, w: Wall, N: Map<string, Node>): [number, number] {
  const s = wallSeg(w, N);
  const L = Math.hypot(s.bx - s.ax, s.by - s.ay);
  const t = (openingStart(o, L) + o.width_u / 2) / L;
  return [s.ax + (s.bx - s.ax) * t, s.ay + (s.by - s.ay) * t];
}

function distToSeg(px: number, py: number, s: Seg): number {
  const dx = s.bx - s.ax, dy = s.by - s.ay;
  const L2 = dx * dx + dy * dy;
  let t = L2 === 0 ? 0 : ((px - s.ax) * dx + (py - s.ay) * dy) / L2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (s.ax + t * dx), py - (s.ay + t * dy));
}

export function buildGrid(st: Storey): Grid {
  const N = nodeMap(st);
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const n of st.nodes) {
    minX = Math.min(minX, n.x_u); maxX = Math.max(maxX, n.x_u);
    minY = Math.min(minY, n.y_u); maxY = Math.max(maxY, n.y_u);
  }
  const x0 = minX - PAD_U, y0 = minY - PAD_U;
  const nx = Math.ceil((maxX - minX + 2 * PAD_U) / CELL_U);
  const ny = Math.ceil((maxY - minY + 2 * PAD_U) / CELL_U);
  const wallMask = new Uint8Array(nx * ny);

  // Rasterise every wall as a thick segment, inside its own bounding box only.
  for (const w of st.walls) {
    const s = wallSeg(w, N);
    const h = w.thickness_u / 2;
    const i0 = Math.max(0, Math.floor((Math.min(s.ax, s.bx) - h - x0) / CELL_U));
    const i1 = Math.min(nx - 1, Math.ceil((Math.max(s.ax, s.bx) + h - x0) / CELL_U));
    const j0 = Math.max(0, Math.floor((Math.min(s.ay, s.by) - h - y0) / CELL_U));
    const j1 = Math.min(ny - 1, Math.ceil((Math.max(s.ay, s.by) + h - y0) / CELL_U));
    for (let j = j0; j <= j1; j++) {
      const py = y0 + (j + 0.5) * CELL_U;
      for (let i = i0; i <= i1; i++) {
        const px = x0 + (i + 0.5) * CELL_U;
        if (distToSeg(px, py, s) <= h) wallMask[j * nx + i] = 1;
      }
    }
  }

  // The walkable mask is the wall mask with every floor-level opening carved out.
  const walkMask = wallMask.slice();
  const W = new Map(st.walls.map((w) => [w.id, w]));
  for (const o of st.openings) {
    if (o.sill_m > 0.05) continue; // a window is not a way through
    const w = W.get(o.wall_id);
    if (!w) continue;
    const s = wallSeg(w, N);
    const L = Math.hypot(s.bx - s.ax, s.by - s.ay);
    const ux = (s.bx - s.ax) / L, uy = (s.by - s.ay) / L;
    const start = openingStart(o, L);
    const half = w.thickness_u / 2 + 0.03;
    // Sample the doorway rectangle densely enough that no cell is missed.
    const steps = Math.ceil(o.width_u / (CELL_U * 0.5));
    const nSteps = Math.ceil((half * 2) / (CELL_U * 0.5));
    for (let a = 0; a <= steps; a++) {
      const sAlong = start + (o.width_u * a) / steps;
      for (let b = 0; b <= nSteps; b++) {
        const sPerp = -half + (2 * half * b) / nSteps;
        const px = s.ax + ux * sAlong - uy * sPerp;
        const py = s.ay + uy * sAlong + ux * sPerp;
        const i = Math.floor((px - x0) / CELL_U), j = Math.floor((py - y0) / CELL_U);
        if (i >= 0 && i < nx && j >= 0 && j < ny) walkMask[j * nx + i] = 0;
      }
    }
  }

  // Outside = flood from the border across the wall mask. Doors are closed here,
  // so the fill cannot leak indoors.
  const outsideMask = new Uint8Array(nx * ny);
  const q = new Int32Array(nx * ny);
  let qh = 0, qt = 0;
  const push = (i: number, j: number, mask: Uint8Array, val: number) => {
    const k = j * nx + i;
    if (mask[k] || wallMask[k]) return;
    mask[k] = val; q[qt++] = k;
  };
  for (let i = 0; i < nx; i++) { push(i, 0, outsideMask, 1); push(i, ny - 1, outsideMask, 1); }
  for (let j = 0; j < ny; j++) { push(0, j, outsideMask, 1); push(nx - 1, j, outsideMask, 1); }
  while (qh < qt) {
    const k = q[qh++], i = k % nx, j = (k / nx) | 0;
    if (i > 0) push(i - 1, j, outsideMask, 1);
    if (i < nx - 1) push(i + 1, j, outsideMask, 1);
    if (j > 0) push(i, j - 1, outsideMask, 1);
    if (j < ny - 1) push(i, j + 1, outsideMask, 1);
  }

  // One flood fill per room seed.
  const roomOf = new Int16Array(nx * ny).fill(-1);
  const areas_u2: number[] = [];
  const orphanRooms: string[] = [];
  st.rooms.forEach((r, idx) => {
    const si = Math.floor((r.seed_point_u[0] - x0) / CELL_U);
    const sj = Math.floor((r.seed_point_u[1] - y0) / CELL_U);
    const sk = sj * nx + si;
    if (si < 0 || si >= nx || sj < 0 || sj >= ny || wallMask[sk] || roomOf[sk] !== -1 || outsideMask[sk]) {
      areas_u2.push(0);
      orphanRooms.push(r.id);
      return;
    }
    qh = 0; qt = 0;
    roomOf[sk] = idx; q[qt++] = sk;
    let count = 0;
    while (qh < qt) {
      const k = q[qh++]; count++;
      const i = k % nx, j = (k / nx) | 0;
      const tryCell = (ii: number, jj: number) => {
        if (ii < 0 || ii >= nx || jj < 0 || jj >= ny) return;
        const kk = jj * nx + ii;
        if (wallMask[kk] || roomOf[kk] !== -1) return;
        roomOf[kk] = idx; q[qt++] = kk;
      };
      tryCell(i - 1, j); tryCell(i + 1, j); tryCell(i, j - 1); tryCell(i, j + 1);
    }
    areas_u2.push(count * CELL_U * CELL_U);
  });

  return { x0, y0, nx, ny, cell: CELL_U, wallMask, walkMask, roomOf, outsideMask, areas_u2, orphanRooms };
}

/** Room index at a point, or -1. */
export function roomAt(g: Grid, x: number, y: number): number {
  const i = Math.floor((x - g.x0) / g.cell), j = Math.floor((y - g.y0) / g.cell);
  if (i < 0 || i >= g.nx || j < 0 || j >= g.ny) return -1;
  return g.roomOf[j * g.nx + i];
}

export function blockedAt(g: Grid, x: number, y: number): boolean {
  const i = Math.floor((x - g.x0) / g.cell), j = Math.floor((y - g.y0) / g.cell);
  if (i < 0 || i >= g.nx || j < 0 || j >= g.ny) return true;
  return g.walkMask[j * g.nx + i] === 1;
}

export interface Rect { x: number; y: number; w: number; h: number; }

/** Merge the cells of one room into horizontal runs. Cheap floor meshes and cheap 2D fills. */
export function roomRects(g: Grid, roomIdx: number): Rect[] {
  const out: Rect[] = [];
  for (let j = 0; j < g.ny; j++) {
    let run = -1;
    for (let i = 0; i <= g.nx; i++) {
      const on = i < g.nx && g.roomOf[j * g.nx + i] === roomIdx;
      if (on && run < 0) run = i;
      if (!on && run >= 0) {
        out.push({ x: g.x0 + run * g.cell, y: g.y0 + j * g.cell, w: (i - run) * g.cell, h: g.cell });
        run = -1;
      }
    }
  }
  return out;
}

/**
 * The true footprint boundary of one room, as a flat list of segment endpoints
 * (`x1, y1, x2, y2, ...`) in document units — every cell-grid edge where the room's
 * cell meets a non-room cell or the grid edge.
 *
 * A room's rendered floor is `roomRects` — a union of many fine axis-aligned strips,
 * one per grid row — so an axis-aligned bounding box around that union is only exact
 * for a rectangular room. For a radial or curved room (a wedge in a rotunda fan, say)
 * the AABB is far bigger than the room, which is why a bounding-box selection
 * highlight visibly disagreed with the room it was supposedly outlining. Tracing the
 * mask's actual edges instead gives a highlight that matches the floor mesh exactly,
 * because both are built from the same `roomOf` data.
 *
 * The segments are unordered — a boundary walk that stitches them into a closed loop
 * is not needed to draw them, only to fill them, and this function's only consumer is
 * a wireframe outline.
 */
export function roomOutlineSegments(g: Grid, roomIdx: number): number[] {
  const out: number[] = [];
  const at = (i: number, j: number): boolean =>
    i >= 0 && i < g.nx && j >= 0 && j < g.ny && g.roomOf[j * g.nx + i] === roomIdx;
  for (let j = 0; j < g.ny; j++) {
    for (let i = 0; i < g.nx; i++) {
      if (!at(i, j)) continue;
      const x0 = g.x0 + i * g.cell, x1 = x0 + g.cell;
      const y0 = g.y0 + j * g.cell, y1 = y0 + g.cell;
      if (!at(i - 1, j)) out.push(x0, y0, x0, y1);
      if (!at(i + 1, j)) out.push(x1, y0, x1, y1);
      if (!at(i, j - 1)) out.push(x0, y0, x1, y0);
      if (!at(i, j + 1)) out.push(x0, y1, x1, y1);
    }
  }
  return out;
}
