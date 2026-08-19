/**
 * The geometry generator. Runs in the browser, in TypeScript.
 *
 * Takes:   a SiteDocument (document units) and its occupancy grids.
 * Returns: three.js meshes grouped per storey, addressable per room and per door.
 * Assumes: XY is built in DOCUMENT UNITS and Y (height) in metres. The viewer applies
 *          the plan scale as world.scale.set(mpu, 1, mpu), so changing the scale is one
 *          line and never rebuilds geometry. Freeze patch 14: no Python in this path.
 *          If the perception backend dies, the building still renders.
 */

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { SiteDocument, Storey, RoomUse } from '../core/types';
import { planStorey } from './walls';
import { roomRects, roomAt, nodeMap, wallSeg, openingCentre, type Grid } from '../core/grid';

export const FLOOR_TINT: Record<RoomUse, number> = {
  CORRIDOR: 0x4a5568,
  OFFICE: 0x3f5a4a,
  SERVER: 0x6b3f3f,
  STORE: 0x55503f,
  STAIRWELL: 0x4a4160,
  HALL: 0x45505c,
  CLASSROOM: 0x3d5560,
  PLANT: 0x4a4a42,
  TOILET: 0x3b4a52,
  PLATFORM: 0x444e58,
  UNKNOWN: 0x3f4650,
};

export interface StoreyMeshes {
  id: string;
  group: THREE.Group;
  walls: THREE.Mesh;
  roof: THREE.Mesh | null;
  floors: Map<string, THREE.Mesh>;
  doors: Map<string, THREE.Mesh>;
}

export interface SiteMeshes {
  root: THREE.Group;
  storeys: Map<string, StoreyMeshes>;
  bounds: THREE.Box3;
}

function boxAt(
  cx: number, cy: number, cz: number,
  len: number, height: number, thick: number,
  angle: number,
): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(len, height, thick);
  const m = new THREE.Matrix4()
    .makeTranslation(cx, cy, cz)
    .multiply(new THREE.Matrix4().makeRotationY(angle));
  g.applyMatrix4(m);
  return g;
}

function storeyWallGeometry(st: Storey): THREE.BufferGeometry | null {
  const parts: THREE.BufferGeometry[] = [];
  for (const p of planStorey(st)) {
    const L = p.length;
    if (L < 1e-9) continue;
    const ux = (p.bx - p.ax) / L, uy = (p.by - p.ay) / L;
    const angle = Math.atan2(-uy, ux);
    for (const pan of p.panels) {
      const sMid = (pan.s0 + pan.s1) / 2;
      const cx = p.ax + ux * sMid;
      const cz = p.ay + uy * sMid;
      const cy = st.elevation_m + (pan.z0 + pan.z1) / 2;
      parts.push(boxAt(
        cx, cy, cz,
        pan.s1 - pan.s0, pan.z1 - pan.z0, p.wall.thickness_u,
        angle,
      ));
    }
  }
  if (parts.length === 0) return null;
  const merged = mergeGeometries(parts, false);
  parts.forEach((g) => g.dispose());
  return merged;
}

/** The floor tint of whichever room sits just past a wall face, or null outdoors/void. */
function sideTint(g: Grid, rooms: Storey['rooms'], x: number, y: number): THREE.Color | null {
  const idx = roomAt(g, x, y);
  if (idx < 0) return null;
  const hex = FLOOR_TINT[rooms[idx].use];
  return hex === undefined ? null : new THREE.Color(hex);
}

/**
 * Interior walls only, vertex-coloured a faint wash of whichever room(s) they face.
 * Every wall in the fixture is the same two greys today, which reads fine in the
 * doll-house but leaves a first-person walker with no idea which room they are in —
 * the floor tint they'd use for that is out of the frame at eye height. Reusing
 * FLOOR_TINT keeps a room's walls, floor and HUD label all the same colour family.
 */
function storeyInteriorWallGeometry(st: Storey, g: Grid): THREE.BufferGeometry | null {
  const parts: THREE.BufferGeometry[] = [];
  const white = new THREE.Color(0xffffff);
  const WASH = 0.16;
  for (const p of planStorey(st)) {
    const L = p.length;
    if (L < 1e-9) continue;
    const ux = (p.bx - p.ax) / L, uy = (p.by - p.ay) / L;
    const nx = -uy, ny = ux;
    const probe = p.wall.thickness_u / 2 + 0.35;
    const angle = Math.atan2(-uy, ux);
    for (const pan of p.panels) {
      const sMid = (pan.s0 + pan.s1) / 2;
      const px = p.ax + ux * sMid, py = p.ay + uy * sMid;
      const cy = st.elevation_m + (pan.z0 + pan.z1) / 2;
      const geo = boxAt(px, cy, py, pan.s1 - pan.s0, pan.z1 - pan.z0, p.wall.thickness_u, angle);

      const a = sideTint(g, st.rooms, px + nx * probe, py + ny * probe);
      const b = sideTint(g, st.rooms, px - nx * probe, py - ny * probe);
      const tint = a && b ? a.clone().lerp(b, 0.5) : a ?? b;
      const c = tint ? white.clone().lerp(tint, WASH) : white;

      const n = geo.attributes.position.count;
      const col = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) { col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
      geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
      parts.push(geo);
    }
  }
  if (parts.length === 0) return null;
  const merged = mergeGeometries(parts, false);
  parts.forEach((p) => p.dispose());
  return merged;
}

function roomFloorGeometry(g: Grid, idx: number, y: number): THREE.BufferGeometry | null {
  const rects = roomRects(g, idx);
  if (rects.length === 0) return null;
  const parts = rects.map((r) =>
    boxAt(r.x + r.w / 2, y - 0.05, r.y + r.h / 2, r.w, 0.1, r.h, 0),
  );
  const merged = mergeGeometries(parts, false);
  parts.forEach((p) => p.dispose());
  return merged;
}

export function buildSiteMeshes(doc: SiteDocument, grids: Map<string, Grid>): SiteMeshes {
  const root = new THREE.Group();
  root.name = 'site';
  const storeys = new Map<string, StoreyMeshes>();

  const wallMatExt = new THREE.MeshStandardMaterial({ color: 0x9aa0a6, roughness: 0.95, metalness: 0.0 });
  // storeyInteriorWallGeometry writes a near-white vertex colour lerped toward the
  // adjoining room's floor tint; multiplied against this base grey it shifts hue
  // per room without changing overall brightness.
  const wallMatInt = new THREE.MeshStandardMaterial({
    color: 0xb8bcc0, roughness: 0.95, metalness: 0.0, vertexColors: true,
  });

  for (const st of doc.storeys) {
    const grid = grids.get(st.id)!;
    const group = new THREE.Group();
    group.name = st.id;

    const isExt = (c: string): boolean => c === 'EXTERIOR' || c === 'SHAFT';
    const extOnly: Storey = { ...st, walls: st.walls.filter((w) => isExt(w.wall_class)) };
    const intOnly: Storey = { ...st, walls: st.walls.filter((w) => !isExt(w.wall_class)) };
    const geoExt = storeyWallGeometry(extOnly);
    const geoInt = storeyInteriorWallGeometry(intOnly, grid);

    const wallGroup = new THREE.Group();
    let wallsMesh: THREE.Mesh = new THREE.Mesh();
    if (geoExt) {
      const m = new THREE.Mesh(geoExt, wallMatExt);
      m.castShadow = true; m.receiveShadow = true;
      m.userData = { kind: 'walls', storey: st.id };
      wallGroup.add(m);
      wallsMesh = m;
    }
    if (geoInt) {
      const m = new THREE.Mesh(geoInt, wallMatInt);
      m.castShadow = true; m.receiveShadow = true;
      m.userData = { kind: 'walls', storey: st.id };
      wallGroup.add(m);
    }
    group.add(wallGroup);

    const floors = new Map<string, THREE.Mesh>();
    st.rooms.forEach((r, i) => {
      const geo = roomFloorGeometry(grid, i, st.elevation_m);
      if (!geo) return;
      const mat = new THREE.MeshStandardMaterial({
        color: FLOOR_TINT[r.use] ?? 0x4a5568, roughness: 1.0, metalness: 0.0,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.receiveShadow = true;
      mesh.userData = { kind: 'room', storey: st.id, room: r.id };
      group.add(mesh);
      floors.set(r.id, mesh);
    });

    // Doorway markers. Colour carries the tactical meaning, set later by the analysers.
    const doors = new Map<string, THREE.Mesh>();
    const N = nodeMap(st);
    const W = new Map(st.walls.map((w) => [w.id, w]));
    for (const o of st.openings) {
      if (o.sill_m > 0.05) continue;
      const w = W.get(o.wall_id);
      if (!w) continue;
      const seg = wallSeg(w, N);
      const Lw = Math.hypot(seg.bx - seg.ax, seg.by - seg.ay);
      const ux = (seg.bx - seg.ax) / Lw, uy = (seg.by - seg.ay) / Lw;
      const [cx, cy] = openingCentre(o, w, N);
      const geo = new THREE.BoxGeometry(o.width_u, 0.04, w.thickness_u + 0.10);
      const mat = new THREE.MeshStandardMaterial({ color: 0x8899aa, roughness: 0.8, emissive: 0x000000 });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(cx, st.elevation_m + 0.03, cy);
      mesh.rotation.y = Math.atan2(-uy, ux);
      mesh.userData = { kind: 'door', storey: st.id, opening: o.id };
      group.add(mesh);
      doors.set(o.id, mesh);
    }

    // Roof over the top storey only. Hidden in the doll-house view.
    let roof: THREE.Mesh | null = null;
    const isTop = st.index === Math.max(...doc.storeys.map((x) => x.index));
    if (isTop) {
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const n of st.nodes) {
        minX = Math.min(minX, n.x_u); maxX = Math.max(maxX, n.x_u);
        minY = Math.min(minY, n.y_u); maxY = Math.max(maxY, n.y_u);
      }
      const h = Math.max(...st.walls.map((w) => w.height_m));
      const geo = new THREE.BoxGeometry(maxX - minX + 0.5, 0.25, maxY - minY + 0.5);
      roof = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0x707880, roughness: 1 }));
      roof.position.set((minX + maxX) / 2, st.elevation_m + h + 0.125, (minY + maxY) / 2);
      roof.castShadow = true;
      roof.userData = { kind: 'roof', storey: st.id };
      group.add(roof);
    }

    root.add(group);
    storeys.set(st.id, { id: st.id, group, walls: wallsMesh, roof, floors, doors });
  }

  // Stairs: a stepped solid. Named in the problem statement, so it is not a coloured prism.
  const stairMat = new THREE.MeshStandardMaterial({ color: 0x8f86b0, roughness: 0.9 });
  for (const s of doc.stairs) {
    const from = doc.storeys.find((x) => x.id === s.from_storey);
    const to = doc.storeys.find((x) => x.id === s.to_storey);
    if (!from || !to) continue;
    const rise = to.elevation_m - from.elevation_m;
    const xs = s.footprint_u.map((p) => p[0]), ys = s.footprint_u.map((p) => p[1]);
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const minY = Math.min(...ys), maxY = Math.max(...ys);
    const along = Math.abs(s.up_direction_u[1]) > Math.abs(s.up_direction_u[0]) ? maxY - minY : maxX - minX;
    const across = Math.abs(s.up_direction_u[1]) > Math.abs(s.up_direction_u[0]) ? maxX - minX : maxY - minY;
    const n = Math.max(2, Math.round(rise / s.riser_m));
    const parts: THREE.BufferGeometry[] = [];
    for (let i = 0; i < n; i++) {
      const s0 = (along * i) / n, s1 = (along * (i + 1)) / n;
      const topY = from.elevation_m + (rise * (i + 1)) / n;
      const midS = (s0 + s1) / 2;
      const vertical = Math.abs(s.up_direction_u[1]) > Math.abs(s.up_direction_u[0]);
      const dir = vertical ? Math.sign(s.up_direction_u[1]) : Math.sign(s.up_direction_u[0]);
      const base = vertical ? (dir > 0 ? minY : maxY) : (dir > 0 ? minX : maxX);
      const pos = base + dir * midS;
      const cx = vertical ? (minX + maxX) / 2 : pos;
      const cy = vertical ? pos : (minY + maxY) / 2;
      parts.push(boxAt(
        cx, (from.elevation_m + topY) / 2, cy,
        vertical ? across : s1 - s0, topY - from.elevation_m, vertical ? s1 - s0 : across,
        0,
      ));
    }
    const geo = mergeGeometries(parts, false);
    parts.forEach((p) => p.dispose());
    const mesh = new THREE.Mesh(geo, stairMat);
    mesh.castShadow = true; mesh.receiveShadow = true;
    mesh.userData = { kind: 'stair', stair: s.id, storey: s.from_storey };
    const sm = storeys.get(s.from_storey);
    (sm ? sm.group : root).add(mesh);
  }

  const bounds = new THREE.Box3().setFromObject(root);
  return { root, storeys, bounds };
}
