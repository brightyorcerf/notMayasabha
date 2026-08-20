/**
 * Walkable path geometry for a computed Route.
 *
 * Takes:   the room graph, a Route, the document and the per-storey occupancy grids.
 * Returns: a polyline that stays inside walkable space, its measured length, and the
 *          turn-by-turn instructions derived from it.
 * Assumes: XY is document units and floor elevation is metres (I5). The path is searched
 *          on `walkMask`, which has doorways carved, so a route through a door is legal
 *          and a route through a wall is not representable. Stairs are expanded into a
 *          real flight rather than a single point, so a climb follows the treads.
 */

import type { SiteDocument, Stair } from '../core/types';
import { nodeMap, wallSeg, openingCentre, type Grid } from '../core/grid';
import { clearanceField, snap, astar, stringPull } from './gridsearch';
import { sideKey, type RoomGraph, type Route, type GEdge } from './graph';
import { turnSteps } from './directions';

/** A body cannot pass closer than this to a wall. Below it, a cell is not traversable. */
const MIN_CLEAR_U = 0.16;
/** How far to stand off a doorway when approaching it square-on. */
const DOOR_STANDOFF_U = 0.7;

export interface PathPoint {
  x_u: number;
  y_u: number;
  /** Floor elevation in metres. The camera adds its own eye height on top. */
  floor_m: number;
  storey_id: string;
}

export type Turn = 'START' | 'AHEAD' | 'LEFT' | 'RIGHT' | 'HARD_LEFT' | 'HARD_RIGHT' | 'UP' | 'DOWN' | 'ARRIVE';

export interface Step {
  /** Index into `points` where this instruction takes effect. */
  at: number;
  turn: Turn;
  /** Metres travelled from the start of the path to `at`. */
  dist_m: number;
  text: string;
}

export interface WalkPath {
  points: PathPoint[];
  length_m: number;
  /** Distance walked on the flat. Excludes anything with a storey change under it. */
  level_m: number;
  /** Distance walked along a stair slope. Climbing is paced separately from walking. */
  climb_m: number;
  steps: Step[];
  /** Cumulative distance in metres at each point. Same length as `points`. */
  cumulative_m: number[];
}

// --------------------------------------------------------------------- stairs

/** Bottom and top of a stair flight in plan, taken along its up direction. */
function stairEnds(s: Stair): { bottom: [number, number]; top: [number, number] } {
  let cx = 0, cy = 0;
  for (const p of s.footprint_u) { cx += p[0]; cy += p[1]; }
  cx /= s.footprint_u.length; cy /= s.footprint_u.length;
  const [ux, uy] = s.up_direction_u;
  const L = Math.hypot(ux, uy) || 1;
  const dx = ux / L, dy = uy / L;
  // Extent of the footprint projected onto the up direction: the run of the flight.
  let lo = Infinity, hi = -Infinity;
  for (const p of s.footprint_u) {
    const t = (p[0] - cx) * dx + (p[1] - cy) * dy;
    lo = Math.min(lo, t); hi = Math.max(hi, t);
  }
  return {
    bottom: [cx + dx * lo, cy + dy * lo],
    top: [cx + dx * hi, cy + dy * hi],
  };
}

/**
 * Points up the flight, one per few treads, each at the elevation that tread sits at.
 * The old path had a single point at the footprint centroid on the LOWER storey, so the
 * camera cut a diagonal through the floor slab instead of climbing.
 */
function stairPoints(s: Stair, fromZ: number, toZ: number): PathPoint[] {
  const { bottom, top } = stairEnds(s);
  const n = Math.max(4, Math.min(24, s.step_count || 12));
  const out: PathPoint[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    out.push({
      x_u: bottom[0] + (top[0] - bottom[0]) * t,
      y_u: bottom[1] + (top[1] - bottom[1]) * t,
      floor_m: fromZ + (toZ - fromZ) * t,
      storey_id: t < 0.5 ? s.from_storey : s.to_storey,
    });
  }
  return out;
}

// ------------------------------------------------------------------ assembly

interface Anchor {
  x: number; y: number; storey: string; floor_m: number;
  /** Take the leg into this anchor literally, without a grid search. Stair treads only. */
  literal?: boolean;
}

/** Doorway centre and unit normal, per opening, for square-on approaches. */
function doorFrames(site: SiteDocument): Map<string, { c: [number, number]; n: [number, number] }> {
  const out = new Map<string, { c: [number, number]; n: [number, number] }>();
  for (const st of site.storeys) {
    const N = nodeMap(st);
    const W = new Map(st.walls.map((w) => [w.id, w]));
    for (const o of st.openings) {
      const w = W.get(o.wall_id);
      if (!w) continue;
      const s = wallSeg(w, N);
      const L = Math.hypot(s.bx - s.ax, s.by - s.ay) || 1;
      out.set(o.id, { c: openingCentre(o, w, N), n: [-(s.by - s.ay) / L, (s.bx - s.ax) / L] });
    }
  }
  return out;
}

/** The anchor sequence a route implies: room centres, square door approaches, stair treads. */
function anchorsFor(gr: RoomGraph, r: Route, site: SiteDocument, grids: Map<string, Grid>): Anchor[] {
  const frames = doorFrames(site);
  const stairs = new Map(site.stairs.map((s) => [s.id, s]));
  const storeys = new Map(site.storeys.map((s) => [s.id, s]));
  const floor = (id: string): number => storeys.get(id)?.elevation_m ?? 0;
  const out: Anchor[] = [];
  const last = (): Anchor | undefined => out[out.length - 1];

  const pushDoor = (e: GEdge, fromKey: string): void => {
    const f = e.opening_id ? frames.get(e.opening_id) : undefined;
    const z = floor(e.storey_id);
    if (!f) { out.push({ x: e.point_u[0], y: e.point_u[1], storey: e.storey_id, floor_m: z }); return; }
    const a: Anchor = { x: f.c[0] + f.n[0] * DOOR_STANDOFF_U, y: f.c[1] + f.n[1] * DOOR_STANDOFF_U, storey: e.storey_id, floor_m: z };
    const b: Anchor = { x: f.c[0] - f.n[0] * DOOR_STANDOFF_U, y: f.c[1] - f.n[1] * DOOR_STANDOFF_U, storey: e.storey_id, floor_m: z };

    // Which standoff is "near" is which side the walker is COMING FROM, not whichever
    // happens to be closer to the previous anchor. That heuristic had no previous
    // anchor to compare against for a route's very first door (Exterior has no room
    // centre to anchor from) and picked a side arbitrarily — so an entry route could
    // walk in, touch the threshold, step back outside, then re-enter to reach the room
    // it was already standing in. Classify by the grid instead: a standoff point IS in
    // a specific room or OUTSIDE, and that is checked against `fromKey` directly.
    const st = storeys.get(e.storey_id);
    const g = st ? grids.get(e.storey_id) : undefined;
    const sideOfA = st && g ? sideKey(st, g, a.x, a.y) : null;
    const sideOfB = st && g ? sideKey(st, g, b.x, b.y) : null;
    let near: Anchor;
    if (sideOfA === fromKey && sideOfB !== fromKey) near = a;
    else if (sideOfB === fromKey && sideOfA !== fromKey) near = b;
    else {
      // Neither classified cleanly (a probe landed in wall thickness, off-grid, or both
      // matched). Fall back to the old distance heuristic rather than fail the route.
      const p = last();
      near = !p ? a : (Math.hypot(a.x - p.x, a.y - p.y) <= Math.hypot(b.x - p.x, b.y - p.y) ? a : b);
    }
    const far = near === a ? b : a;
    // Standoff, threshold, standoff: three collinear points on the door normal, so the
    // walker meets the opening square instead of clipping a jamb on the way through.
    out.push(near, { x: f.c[0], y: f.c[1], storey: e.storey_id, floor_m: z }, far);
  };

  for (let i = 0; i < r.nodes.length; i++) {
    const n = gr.nodes.get(r.nodes[i]);
    if (n && n.room_id) {
      out.push({ x: n.centre_u[0], y: n.centre_u[1], storey: n.storey_id, floor_m: floor(n.storey_id) });
    }
    const e = r.edges[i];
    if (!e) continue;
    if (e.kind === 'STAIR') {
      const s = e.stair_id ? stairs.get(e.stair_id) : undefined;
      if (!s) continue;
      // Direction of travel decides which storey is the bottom of this climb.
      const up = r.nodes[i] === `${s.from_storey}:${s.from_room}`;
      const fromZ = floor(up ? s.from_storey : s.to_storey);
      const toZ = floor(up ? s.to_storey : s.from_storey);
      const pts = stairPoints(s, fromZ, toZ);
      const seq = up ? pts : [...pts].reverse();
      seq.forEach((p, k) => out.push({ x: p.x_u, y: p.y_u, storey: p.storey_id, floor_m: p.floor_m, literal: k > 0 }));
    } else {
      pushDoor(e, r.nodes[i]);
    }
  }
  return out;
}

/**
 * The walkable polyline for a route, plus its measured length and turn instructions.
 *
 * Each leg between anchors is searched on the storey's grid and then simplified, so
 * every point and every segment between them lies in walkable space. If a leg cannot
 * be searched — an anchor snapped nowhere, or a genuinely disconnected pair — the leg
 * falls back to a straight line rather than dropping the route: a visibly wrong
 * segment is recoverable, a silently missing one is not.
 */
export function walkPath(
  gr: RoomGraph, r: Route | null, site: SiteDocument, grids: Map<string, Grid>, mpu: number,
): WalkPath {
  const empty: WalkPath = { points: [], length_m: 0, level_m: 0, climb_m: 0, steps: [], cumulative_m: [] };
  if (!r) return empty;
  const anchors = anchorsFor(gr, r, site, grids);
  if (anchors.length === 0) return empty;

  const points: PathPoint[] = [{ x_u: anchors[0].x, y_u: anchors[0].y, floor_m: anchors[0].floor_m, storey_id: anchors[0].storey }];
  const push = (x: number, y: number, z: number, st: string): void => {
    const p = points[points.length - 1];
    if (Math.hypot(p.x_u - x, p.y_u - y) < 1e-4 && Math.abs(p.floor_m - z) < 1e-4) return;
    points.push({ x_u: x, y_u: y, floor_m: z, storey_id: st });
  };

  for (let i = 1; i < anchors.length; i++) {
    const a = anchors[i - 1], b = anchors[i];
    if (b.literal || a.storey !== b.storey) { push(b.x, b.y, b.floor_m, b.storey); continue; }
    const g = grids.get(b.storey);
    if (!g) { push(b.x, b.y, b.floor_m, b.storey); continue; }
    const clear = clearanceField(g);
    const minClear = MIN_CLEAR_U / g.cell;
    const from = snap(g, clear, a.x, a.y, minClear);
    const to = snap(g, clear, b.x, b.y, minClear);
    const cells = from < 0 || to < 0 ? null
      : astar(g, clear, from, to, minClear, true) ?? astar(g, clear, from, to, minClear, false);
    if (!cells) { push(b.x, b.y, b.floor_m, b.storey); continue; }
    const raw: Array<[number, number]> = cells.map((k) => [
      g.x0 + ((k % g.nx) + 0.5) * g.cell,
      g.y0 + (((k / g.nx) | 0) + 0.5) * g.cell,
    ]);
    for (const [x, y] of stringPull(g, clear, raw, minClear)) push(x, y, b.floor_m, b.storey);
    push(b.x, b.y, b.floor_m, b.storey);
  }

  const cumulative_m: number[] = [0];
  let length_m = 0, level_m = 0, climb_m = 0;
  for (let i = 1; i < points.length; i++) {
    const p = points[i], q = points[i - 1];
    const rise = Math.abs(p.floor_m - q.floor_m);
    const seg = Math.hypot((p.x_u - q.x_u) * mpu, (p.y_u - q.y_u) * mpu, rise);
    length_m += seg;
    // A segment that changes storey is stair, and stairs are paced on their own clock.
    if (rise > 1e-3) climb_m += seg; else level_m += seg;
    cumulative_m.push(length_m);
  }
  return {
    points, length_m, level_m, climb_m,
    steps: turnSteps(points, cumulative_m, gr, r), cumulative_m,
  };
}
