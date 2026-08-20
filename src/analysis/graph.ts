/**
 * The room adjacency graph and the three analysers.
 *
 * Takes:   a loaded SiteDocument and its occupancy grids.
 * Returns: a graph whose nodes are rooms and whose edges are openings and stairs,
 *          plus bridges (critical doors), articulation points (critical rooms) and routes.
 * Assumes: a door is an EDGE. The critical-door question is therefore a bridge question,
 *          not a cut-vertex question. Cut vertices answer the critical-ROOM question.
 *          Both are shipped, and they are labelled differently on purpose.
 */

import type { SiteDocument, RoomUse, Storey } from '../core/types';
import { roomAt, nodeMap, wallSeg, openingCentre, roomRects, type Grid } from '../core/grid';

export const OUTSIDE = 'OUTSIDE';

export interface GNode {
  key: string;
  storey_id: string;
  room_id: string | null;
  name: string;
  use: RoomUse | 'EXTERIOR';
  area_u2: number;
  centre_u: [number, number];
  level: number;
}

export interface GEdge {
  key: string;
  kind: 'DOOR' | 'STAIR';
  a: string;
  b: string;
  opening_id?: string;
  stair_id?: string;
  storey_id: string;
  point_u: [number, number];
  label: string;
  is_entry: boolean;
  is_exit: boolean;
}

export interface RoomGraph {
  nodes: Map<string, GNode>;
  edges: GEdge[];
  adj: Map<string, Array<{ to: string; edge: GEdge }>>;
}

export function nodeKey(storeyId: string, roomId: string): string {
  return `${storeyId}:${roomId}`;
}

/**
 * Which room graph key — a room's `nodeKey`, or OUTSIDE — a plan-space point falls in,
 * or null if it falls in neither (inside wall thickness, off the building envelope with
 * no outside flood reaching it, or off-grid). Shared by the door-edge classification
 * here and by `analysis/path.ts`, which uses the same test to tell a door's two
 * standoff points apart: a point is not "the near one" by distance to whatever anchor
 * happened to precede it, it is the one that actually lies on the room the walker is
 * coming from.
 */
export function sideKey(st: Storey, g: Grid, x: number, y: number): string | null {
  const idx = roomAt(g, x, y);
  if (idx >= 0) return nodeKey(st.id, st.rooms[idx].id);
  const i = Math.floor((x - g.x0) / g.cell), j = Math.floor((y - g.y0) / g.cell);
  if (i >= 0 && i < g.nx && j >= 0 && j < g.ny && g.outsideMask[j * g.nx + i]) return OUTSIDE;
  return null;
}

/** A point inside the room, close to the centroid of its cells. */
function roomCentre(g: Grid, idx: number): [number, number] {
  const rects = roomRects(g, idx);
  if (rects.length === 0) return [g.x0, g.y0];
  let sx = 0, sy = 0, sw = 0;
  for (const r of rects) {
    sx += (r.x + r.w / 2) * r.w; sy += (r.y + r.h / 2) * r.w; sw += r.w;
  }
  const cx = sx / sw, cy = sy / sw;
  if (roomAt(g, cx, cy) === idx) return [cx, cy];
  // Concave room: fall back to the cell nearest the centroid that is really inside.
  let best: [number, number] = [rects[0].x + rects[0].w / 2, rects[0].y + rects[0].h / 2];
  let bestD = Infinity;
  for (const r of rects) {
    const px = r.x + r.w / 2, py = r.y + r.h / 2;
    const d = (px - cx) ** 2 + (py - cy) ** 2;
    if (d < bestD) { bestD = d; best = [px, py]; }
  }
  return best;
}

export function buildRoomGraph(site: SiteDocument, grids: Map<string, Grid>): RoomGraph {
  const nodes = new Map<string, GNode>();
  const edges: GEdge[] = [];

  nodes.set(OUTSIDE, {
    key: OUTSIDE, storey_id: '', room_id: null, name: 'Exterior', use: 'EXTERIOR',
    area_u2: 0, centre_u: [0, 0], level: 0,
  });

  for (const st of site.storeys) {
    const g = grids.get(st.id)!;
    st.rooms.forEach((r, i) => {
      nodes.set(nodeKey(st.id, r.id), {
        key: nodeKey(st.id, r.id), storey_id: st.id, room_id: r.id, name: r.name,
        use: r.use, area_u2: g.areas_u2[i], centre_u: roomCentre(g, i), level: st.index,
      });
    });
  }

  for (const st of site.storeys) {
    const g = grids.get(st.id)!;
    const N = nodeMap(st);
    const W = new Map(st.walls.map((w) => [w.id, w]));
    for (const o of st.openings) {
      if (o.sill_m > 0.05) continue; // a window is not an edge in a movement graph
      const w = W.get(o.wall_id);
      if (!w) continue;
      const seg = wallSeg(w, N);
      const L = Math.hypot(seg.bx - seg.ax, seg.by - seg.ay);
      const nx = -(seg.by - seg.ay) / L, ny = (seg.bx - seg.ax) / L;
      const [cx, cy] = openingCentre(o, w, N);
      const probe = w.thickness_u / 2 + 0.35;
      const ka = sideKey(st, g, cx + nx * probe, cy + ny * probe);
      const kb = sideKey(st, g, cx - nx * probe, cy - ny * probe);
      if (!ka || !kb || ka === kb) continue;
      edges.push({
        key: o.id, kind: 'DOOR', a: ka, b: kb, opening_id: o.id, storey_id: st.id,
        point_u: [cx, cy],
        label: `${nodes.get(ka)?.name ?? ka} ↔ ${nodes.get(kb)?.name ?? kb}`,
        is_entry: o.is_entry, is_exit: o.is_exit,
      });
    }
  }

  for (const s of site.stairs) {
    const a = nodeKey(s.from_storey, s.from_room);
    const b = nodeKey(s.to_storey, s.to_room);
    if (!nodes.has(a) || !nodes.has(b)) continue;
    let cx = 0, cy = 0;
    for (const p of s.footprint_u) { cx += p[0]; cy += p[1]; }
    edges.push({
      key: s.id, kind: 'STAIR', a, b, stair_id: s.id, storey_id: s.from_storey,
      point_u: [cx / s.footprint_u.length, cy / s.footprint_u.length],
      label: `${nodes.get(a)!.name} ↕ ${nodes.get(b)!.name}`,
      is_entry: false, is_exit: false,
    });
  }

  const adj = new Map<string, Array<{ to: string; edge: GEdge }>>();
  for (const k of nodes.keys()) adj.set(k, []);
  for (const e of edges) {
    adj.get(e.a)!.push({ to: e.b, edge: e });
    adj.get(e.b)!.push({ to: e.a, edge: e });
  }
  return { nodes, edges, adj };
}

/**
 * Bridges — the CRITICAL DOORS. An edge whose removal disconnects the graph.
 * Tarjan, iterative, on the undirected multigraph. Parallel edges are handled by
 * excluding the specific edge we came in on, not the parent vertex.
 */
export function bridges(gr: RoomGraph): Set<string> {
  const disc = new Map<string, number>();
  const low = new Map<string, number>();
  const out = new Set<string>();
  let timer = 0;

  for (const root of gr.nodes.keys()) {
    if (disc.has(root)) continue;
    const stack: Array<{ v: string; viaEdge: string | null; it: number }> = [
      { v: root, viaEdge: null, it: 0 },
    ];
    disc.set(root, timer); low.set(root, timer); timer++;
    while (stack.length) {
      const fr = stack[stack.length - 1];
      const nbrs = gr.adj.get(fr.v)!;
      if (fr.it < nbrs.length) {
        const { to, edge } = nbrs[fr.it++];
        if (edge.key === fr.viaEdge) continue;
        if (disc.has(to)) {
          low.set(fr.v, Math.min(low.get(fr.v)!, disc.get(to)!));
        } else {
          disc.set(to, timer); low.set(to, timer); timer++;
          stack.push({ v: to, viaEdge: edge.key, it: 0 });
        }
      } else {
        stack.pop();
        const parent = stack[stack.length - 1];
        if (parent) {
          low.set(parent.v, Math.min(low.get(parent.v)!, low.get(fr.v)!));
          if (low.get(fr.v)! > disc.get(parent.v)!) out.add(fr.viaEdge!);
        }
      }
    }
  }
  return out;
}

/** Articulation points — the CRITICAL ROOMS. A vertex whose removal disconnects the graph. */
export function articulationPoints(gr: RoomGraph): Set<string> {
  const disc = new Map<string, number>();
  const low = new Map<string, number>();
  const out = new Set<string>();
  let timer = 0;

  for (const root of gr.nodes.keys()) {
    if (disc.has(root)) continue;
    let rootChildren = 0;
    const stack: Array<{ v: string; parent: string | null; it: number }> = [
      { v: root, parent: null, it: 0 },
    ];
    disc.set(root, timer); low.set(root, timer); timer++;
    while (stack.length) {
      const fr = stack[stack.length - 1];
      const nbrs = gr.adj.get(fr.v)!;
      if (fr.it < nbrs.length) {
        const { to } = nbrs[fr.it++];
        if (to === fr.parent) continue;
        if (disc.has(to)) {
          low.set(fr.v, Math.min(low.get(fr.v)!, disc.get(to)!));
        } else {
          if (fr.v === root) rootChildren++;
          disc.set(to, timer); low.set(to, timer); timer++;
          stack.push({ v: to, parent: fr.v, it: 0 });
        }
      } else {
        stack.pop();
        const parent = stack[stack.length - 1];
        if (parent) {
          low.set(parent.v, Math.min(low.get(parent.v)!, low.get(fr.v)!));
          if (parent.parent !== null && low.get(fr.v)! >= disc.get(parent.v)!) out.add(parent.v);
        }
      }
    }
    if (rootChildren > 1) out.add(root);
  }
  return out;
}

export interface Route {
  nodes: string[];
  edges: GEdge[];
  doors: number;
}

/** Shortest path over the room graph. Uniform edge cost: doors traversed. */
export function route(gr: RoomGraph, from: string, to: string): Route | null {
  if (!gr.nodes.has(from) || !gr.nodes.has(to)) return null;
  const prev = new Map<string, { v: string; e: GEdge }>();
  const seen = new Set<string>([from]);
  const q: string[] = [from];
  while (q.length) {
    const v = q.shift()!;
    if (v === to) break;
    for (const { to: n, edge } of gr.adj.get(v)!) {
      if (seen.has(n)) continue;
      seen.add(n);
      prev.set(n, { v, e: edge });
      q.push(n);
    }
  }
  if (!seen.has(to)) return null;
  const nodes: string[] = [to];
  const edges: GEdge[] = [];
  let cur = to;
  while (cur !== from) {
    const p = prev.get(cur)!;
    edges.push(p.e);
    nodes.push(p.v);
    cur = p.v;
  }
  nodes.reverse(); edges.reverse();
  return { nodes, edges, doors: edges.length };
}

/**
 * Isolation — what sealing one door costs the defender.
 * Returns the rooms that become unreachable from the exterior once that edge is removed.
 */
export function isolationOf(gr: RoomGraph, edgeKey: string): string[] {
  const seen = new Set<string>([OUTSIDE]);
  const q: string[] = [OUTSIDE];
  while (q.length) {
    const v = q.shift()!;
    for (const { to, edge } of gr.adj.get(v)!) {
      if (edge.key === edgeKey || seen.has(to)) continue;
      seen.add(to);
      q.push(to);
    }
  }
  return [...gr.nodes.keys()].filter((k) => k !== OUTSIDE && !seen.has(k));
}

/** Dead ends — rooms with exactly one way in. Degree 1 in the room graph. */
export function deadEnds(gr: RoomGraph): string[] {
  return [...gr.nodes.values()]
    .filter((n) => n.room_id && gr.adj.get(n.key)!.length === 1)
    .map((n) => n.key);
}

/** Betweenness centrality over rooms. Used to rank which rooms to control. */
export function betweenness(gr: RoomGraph): Map<string, number> {
  const keys = [...gr.nodes.keys()];
  const cb = new Map<string, number>(keys.map((k) => [k, 0]));
  for (const s of keys) {
    const stack: string[] = [];
    const preds = new Map<string, string[]>(keys.map((k) => [k, []]));
    const sigma = new Map<string, number>(keys.map((k) => [k, 0]));
    const dist = new Map<string, number>(keys.map((k) => [k, -1]));
    sigma.set(s, 1); dist.set(s, 0);
    const q: string[] = [s];
    while (q.length) {
      const v = q.shift()!;
      stack.push(v);
      for (const { to: w } of gr.adj.get(v)!) {
        if (dist.get(w)! < 0) { dist.set(w, dist.get(v)! + 1); q.push(w); }
        if (dist.get(w)! === dist.get(v)! + 1) {
          sigma.set(w, sigma.get(w)! + sigma.get(v)!);
          preds.get(w)!.push(v);
        }
      }
    }
    const delta = new Map<string, number>(keys.map((k) => [k, 0]));
    while (stack.length) {
      const w = stack.pop()!;
      for (const v of preds.get(w)!) {
        delta.set(v, delta.get(v)! + (sigma.get(v)! / sigma.get(w)!) * (1 + delta.get(w)!));
      }
      if (w !== s) cb.set(w, cb.get(w)! + delta.get(w)!);
    }
  }
  for (const k of keys) cb.set(k, cb.get(k)! / 2);
  return cb;
}
