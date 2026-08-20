/**
 * Grid search primitives for walkable paths.
 *
 * Takes:   an occupancy Grid and plan-space points in document units.
 * Returns: a clearance field, an A* cell path, and a line-of-sight simplifier.
 * Assumes: it searches `walkMask`, where doorways ARE carved, so a door is passable
 *          and a wall is not. Nothing here knows about rooms, routes or storeys — it
 *          is pure geometry over one storey's grid.
 */

import type { Grid } from '../core/grid';

/** Clearance is measured in cells and capped: beyond this, more room does not help. */
const CLEAR_CAP = 24;
/** Preferred distance from a wall. The search pays to get here, then stops caring. */
export const WANT_CLEAR_U = 0.55;
/** How hard hugging a wall is punished, as a multiple of the base step cost. */
const HUG_PENALTY = 3.0;
/** Search is bounded to the endpoints' box plus this, then retried unbounded. */
const SEARCH_PAD_U = 16;

// ------------------------------------------------------------------ clearance

const clearCache = new WeakMap<Grid, Uint8Array>();

/**
 * Distance in cells from every free cell to the nearest blocked one, capped at
 * CLEAR_CAP. Multi-source BFS from all blocked cells: one pass over the grid, cached
 * per Grid object. Grids are rebuilt on every document change, so the cache cannot
 * go stale — a new Grid is a new key.
 */
export function clearanceField(g: Grid): Uint8Array {
  const hit = clearCache.get(g);
  if (hit) return hit;
  const n = g.nx * g.ny;
  const out = new Uint8Array(n).fill(CLEAR_CAP);
  const q = new Int32Array(n);
  let qh = 0, qt = 0;
  for (let k = 0; k < n; k++) if (g.walkMask[k]) { out[k] = 0; q[qt++] = k; }
  while (qh < qt) {
    const k = q[qh++];
    const d = out[k];
    if (d >= CLEAR_CAP) continue;
    const i = k % g.nx, j = (k / g.nx) | 0;
    for (let dj = -1; dj <= 1; dj++) {
      for (let di = -1; di <= 1; di++) {
        if (!di && !dj) continue;
        const ni = i + di, nj = j + dj;
        if (ni < 0 || ni >= g.nx || nj < 0 || nj >= g.ny) continue;
        const nk = nj * g.nx + ni;
        if (out[nk] > d + 1) { out[nk] = d + 1; q[qt++] = nk; }
      }
    }
  }
  clearCache.set(g, out);
  return out;
}

// ------------------------------------------------------------------- search

/** Binary min-heap over cell indices, keyed by f-score. Plain arrays: no allocation churn. */
class Heap {
  private ks: number[] = [];
  private fs: number[] = [];
  get size(): number { return this.ks.length; }
  push(k: number, f: number): void {
    this.ks.push(k); this.fs.push(f);
    let i = this.ks.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.fs[p] <= this.fs[i]) break;
      this.swap(p, i); i = p;
    }
  }
  pop(): number {
    const top = this.ks[0];
    const k = this.ks.pop()!, f = this.fs.pop()!;
    if (this.ks.length) {
      this.ks[0] = k; this.fs[0] = f;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < this.fs.length && this.fs[l] < this.fs[m]) m = l;
        if (r < this.fs.length && this.fs[r] < this.fs[m]) m = r;
        if (m === i) break;
        this.swap(m, i); i = m;
      }
    }
    return top;
  }
  private swap(a: number, b: number): void {
    [this.ks[a], this.ks[b]] = [this.ks[b], this.ks[a]];
    [this.fs[a], this.fs[b]] = [this.fs[b], this.fs[a]];
  }
}

const cellOf = (g: Grid, x: number, y: number): [number, number] =>
  [Math.floor((x - g.x0) / g.cell), Math.floor((y - g.y0) / g.cell)];

/**
 * Nearest traversable cell to (x, y), searched outward in rings. A room centroid can
 * land in a doorway recess or a column, and a search that refuses to start is worse
 * than one that starts 100 mm away.
 */
export function snap(g: Grid, clear: Uint8Array, x: number, y: number, minClear: number): number {
  const [ci, cj] = cellOf(g, x, y);
  for (let r = 0; r <= 40; r++) {
    for (let dj = -r; dj <= r; dj++) {
      for (let di = -r; di <= r; di++) {
        if (r > 0 && Math.abs(di) !== r && Math.abs(dj) !== r) continue;
        const i = ci + di, j = cj + dj;
        if (i < 0 || i >= g.nx || j < 0 || j >= g.ny) continue;
        const k = j * g.nx + i;
        if (!g.walkMask[k] && clear[k] >= minClear) return k;
      }
    }
  }
  return -1;
}

/**
 * A* between two cells, 8-connected, biased away from walls by the clearance field.
 * Bounded to the endpoints' bounding box plus SEARCH_PAD_U so a short hop cannot walk
 * the whole grid; the caller retries unbounded if the box has no answer.
 */
export function astar(g: Grid, clear: Uint8Array, from: number, to: number, minClear: number, bounded: boolean): number[] | null {
  const n = g.nx * g.ny;
  const want = WANT_CLEAR_U / g.cell;
  let i0 = 0, i1 = g.nx - 1, j0 = 0, j1 = g.ny - 1;
  if (bounded) {
    const pad = Math.ceil(SEARCH_PAD_U / g.cell);
    const ax = from % g.nx, ay = (from / g.nx) | 0;
    const bx = to % g.nx, by = (to / g.nx) | 0;
    i0 = Math.max(0, Math.min(ax, bx) - pad); i1 = Math.min(g.nx - 1, Math.max(ax, bx) + pad);
    j0 = Math.max(0, Math.min(ay, by) - pad); j1 = Math.min(g.ny - 1, Math.max(ay, by) + pad);
  }

  const gScore = new Float32Array(n).fill(Infinity);
  const cameFrom = new Int32Array(n).fill(-1);
  const closed = new Uint8Array(n);
  const tx = to % g.nx, ty = (to / g.nx) | 0;
  const h = (k: number): number => {
    const dx = Math.abs((k % g.nx) - tx), dy = Math.abs(((k / g.nx) | 0) - ty);
    return (dx + dy) + (Math.SQRT2 - 2) * Math.min(dx, dy);
  };

  const open = new Heap();
  gScore[from] = 0;
  open.push(from, h(from));
  while (open.size) {
    const k = open.pop();
    if (k === to) break;
    if (closed[k]) continue;
    closed[k] = 1;
    const i = k % g.nx, j = (k / g.nx) | 0;
    for (let dj = -1; dj <= 1; dj++) {
      for (let di = -1; di <= 1; di++) {
        if (!di && !dj) continue;
        const ni = i + di, nj = j + dj;
        if (ni < i0 || ni > i1 || nj < j0 || nj > j1) continue;
        const nk = nj * g.nx + ni;
        if (g.walkMask[nk] || clear[nk] < minClear) continue;
        // No corner-cutting: a diagonal needs both orthogonal neighbours open too.
        if (di && dj && (g.walkMask[j * g.nx + ni] || g.walkMask[nj * g.nx + i])) continue;
        const step = di && dj ? Math.SQRT2 : 1;
        const hug = Math.max(0, want - clear[nk]) / want;
        const cost = step * (1 + HUG_PENALTY * hug * hug);
        const t = gScore[k] + cost;
        if (t < gScore[nk]) { gScore[nk] = t; cameFrom[nk] = k; open.push(nk, t + h(nk)); }
      }
    }
  }
  if (cameFrom[to] < 0 && from !== to) return null;
  const out: number[] = [];
  for (let k = to; k >= 0; k = cameFrom[k]) { out.push(k); if (k === from) break; }
  return out.reverse();
}

/** True when a straight line from a to b stays traversable the whole way. */
export function clearLine(g: Grid, clear: Uint8Array, ax: number, ay: number, bx: number, by: number, minClear: number): boolean {
  const d = Math.hypot(bx - ax, by - ay);
  const steps = Math.max(2, Math.ceil(d / (g.cell * 0.5)));
  for (let s = 0; s <= steps; s++) {
    const x = ax + (bx - ax) * (s / steps), y = ay + (by - ay) * (s / steps);
    const [i, j] = cellOf(g, x, y);
    if (i < 0 || i >= g.nx || j < 0 || j >= g.ny) return false;
    const k = j * g.nx + i;
    if (g.walkMask[k] || clear[k] < minClear) return false;
  }
  return true;
}

/**
 * Drop every vertex that the previous kept vertex can already see. An A* result is a
 * staircase of 50 mm steps; this turns it into the handful of straight legs a person
 * would actually walk, which is also what makes turn detection meaningful.
 */
export function stringPull(g: Grid, clear: Uint8Array, pts: Array<[number, number]>, minClear: number): Array<[number, number]> {
  if (pts.length <= 2) return pts;
  const out: Array<[number, number]> = [pts[0]];
  let anchor = 0;
  for (let i = 2; i < pts.length; i++) {
    if (!clearLine(g, clear, pts[anchor][0], pts[anchor][1], pts[i][0], pts[i][1], minClear)) {
      out.push(pts[i - 1]);
      anchor = i - 1;
    }
  }
  out.push(pts[pts.length - 1]);
  return out;
}

