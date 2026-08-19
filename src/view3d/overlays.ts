/**
 * Tactical overlays. Everything a commander looks at is drawn here.
 *
 * Takes:   the room graph, the analyser results and the built meshes.
 * Returns: nothing. It mutates the overlay group and the door/room materials.
 * Assumes: overlays are drawn in DOCUMENT UNITS, inside the viewer's world group, so
 *          they rescale with the model when the scale changes. Derived: rebuilt on
 *          every document change.
 */

import * as THREE from 'three';
import type { RoomGraph, GEdge, Route } from '../analysis/graph';
import { OUTSIDE } from '../analysis/graph';
import type { SiteMeshes } from '../geometry/build3d';
import type { SiteDocument } from '../core/types';

export const COL = {
  bridge: 0xff4d4d,
  door: 0x7f8fa6,
  entry: 0x2ecc71,
  exit: 0xf1c40f,
  route: 0x00e5ff,
  critical: 0xff9f43,
  target: 0xff2d55,
  select: 0x00ffcc,
  marker: 0xff6b9d,
} as const;

export class Overlays {
  private routeGroup = new THREE.Group();
  private markerGroup = new THREE.Group();
  private selectGroup = new THREE.Group();
  private baseDoorColour = new Map<string, number>();

  constructor(
    group: THREE.Group,
    private site: SiteDocument,
    private meshes: SiteMeshes,
  ) {
    group.add(this.routeGroup, this.markerGroup, this.selectGroup);
    for (const s of meshes.storeys.values()) {
      for (const [id, m] of s.doors) {
        this.baseDoorColour.set(id, (m.material as THREE.MeshStandardMaterial).color.getHex());
      }
    }
  }

  private storeyBase(id: string): number {
    return this.site.storeys.find((s) => s.id === id)?.elevation_m ?? 0;
  }

  /** Colour every door by its tactical role. Bridges are the critical doors. */
  applyDoorRoles(gr: RoomGraph, bridgeKeys: Set<string>): void {
    for (const s of this.meshes.storeys.values()) {
      for (const [id, mesh] of s.doors) {
        const mat = mesh.material as THREE.MeshStandardMaterial;
        const e = gr.edges.find((x) => x.opening_id === id);
        let c: number = this.baseDoorColour.get(id) ?? COL.door;
        let emissive = 0x000000;
        if (e?.is_entry) c = COL.entry;
        else if (e?.is_exit) c = COL.exit;
        if (e && bridgeKeys.has(e.key)) { c = COL.bridge; emissive = 0x330000; }
        mat.color.setHex(c);
        mat.emissive.setHex(emissive);
      }
    }
  }

  /** Tint the floors of rooms that are articulation points. */
  applyCriticalRooms(critical: Set<string>, gr: RoomGraph): void {
    for (const s of this.meshes.storeys.values()) {
      for (const [rid, mesh] of s.floors) {
        const mat = mesh.material as THREE.MeshStandardMaterial;
        const key = `${s.id}:${rid}`;
        mat.emissive.setHex(critical.has(key) && gr.nodes.has(key) ? 0x3a1e00 : 0x000000);
      }
    }
  }

  clearRoute(): void {
    this.routeGroup.clear();
  }

  /** Draw the route as a floating ribbon with a marker at every door it passes. */
  drawRoute(gr: RoomGraph, r: Route): void {
    this.clearRoute();
    const pts: THREE.Vector3[] = [];
    const at = (key: string): THREE.Vector3 | null => {
      const n = gr.nodes.get(key);
      if (!n) return null;
      if (key === OUTSIDE) return null;
      return new THREE.Vector3(n.centre_u[0], this.storeyBase(n.storey_id) + 0.25, n.centre_u[1]);
    };
    for (let i = 0; i < r.nodes.length; i++) {
      const p = at(r.nodes[i]);
      if (p) pts.push(p);
      const e: GEdge | undefined = r.edges[i];
      if (e) {
        const yFrom = this.storeyBase(e.storey_id);
        if (e.kind === 'STAIR') {
          const other = this.site.stairs.find((s) => s.id === e.stair_id);
          const to = other ? this.storeyBase(other.to_storey) : yFrom;
          pts.push(new THREE.Vector3(e.point_u[0], yFrom + 0.25, e.point_u[1]));
          pts.push(new THREE.Vector3(e.point_u[0], to + 0.25, e.point_u[1]));
        } else {
          pts.push(new THREE.Vector3(e.point_u[0], yFrom + 0.25, e.point_u[1]));
        }
      }
    }
    // The exterior node has no centre. Start just outside the entry door instead.
    if (r.nodes[0] === OUTSIDE && pts.length >= 2) {
      const first = pts[0], second = pts[1];
      const d = new THREE.Vector3().subVectors(first, second).normalize().multiplyScalar(3.0);
      pts.unshift(new THREE.Vector3().addVectors(first, d));
    }
    if (pts.length < 2) return;

    const curve = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.15);
    const tube = new THREE.Mesh(
      new THREE.TubeGeometry(curve, Math.max(24, pts.length * 12), 0.09, 8, false),
      new THREE.MeshStandardMaterial({ color: COL.route, emissive: 0x004455, roughness: 0.4 }),
    );
    tube.renderOrder = 5;
    this.routeGroup.add(tube);

    for (const e of r.edges) {
      const y = this.storeyBase(e.storey_id);
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(0.45, 0.06, 8, 24),
        new THREE.MeshStandardMaterial({ color: COL.route, emissive: 0x006677 }),
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(e.point_u[0], y + 0.1, e.point_u[1]);
      this.routeGroup.add(ring);
    }
  }

  /** Entry and exit pylons, so they read from any camera angle. */
  drawEntryMarkers(gr: RoomGraph): void {
    this.markerGroup.clear();
    for (const e of gr.edges) {
      if (!e.is_entry && !e.is_exit) continue;
      const y = this.storeyBase(e.storey_id);
      const col = e.is_entry ? COL.entry : COL.exit;
      const cone = new THREE.Mesh(
        new THREE.ConeGeometry(0.32, 0.9, 12),
        new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 0.35 }),
      );
      cone.position.set(e.point_u[0], y + 3.0, e.point_u[1]);
      cone.rotation.x = Math.PI;
      this.markerGroup.add(cone);
    }
  }

  /** Briefing markers: threat, hostage, IED, cover. */
  drawMarkers(markers: Array<{ id: string; storey_id: string; x_u: number; y_u: number; z_m: number; kind: string; label: string }>): void {
    const old = this.markerGroup.children.filter((c) => c.name.startsWith('mk-'));
    for (const o of old) this.markerGroup.remove(o);
    for (const m of markers) {
      const g = new THREE.Group();
      g.name = `mk-${m.id}`;
      const pin = new THREE.Mesh(
        new THREE.OctahedronGeometry(0.45),
        new THREE.MeshStandardMaterial({ color: COL.marker, emissive: 0x400020 }),
      );
      pin.position.set(m.x_u, this.storeyBase(m.storey_id) + m.z_m + 0.6, m.y_u);
      const stem = new THREE.Mesh(
        new THREE.CylinderGeometry(0.03, 0.03, m.z_m + 0.6),
        new THREE.MeshBasicMaterial({ color: COL.marker }),
      );
      stem.position.set(m.x_u, this.storeyBase(m.storey_id) + (m.z_m + 0.6) / 2, m.y_u);
      g.add(pin, stem);
      this.markerGroup.add(g);
    }
  }

  /** One box outline around the selected room or door. */
  select(kind: 'room' | 'door' | null, storeyId?: string, id?: string): void {
    this.selectGroup.clear();
    if (!kind || !storeyId || !id) return;
    const s = this.meshes.storeys.get(storeyId);
    if (!s) return;
    const mesh = kind === 'room' ? s.floors.get(id) : s.doors.get(id);
    if (!mesh) return;
    mesh.updateMatrix();
    mesh.geometry.computeBoundingBox();
    const box = mesh.geometry.boundingBox!.clone().applyMatrix4(mesh.matrix);
    if (kind === 'room') box.max.y += 3.0;
    const helper = new THREE.Box3Helper(box, new THREE.Color(COL.select));
    (helper.material as THREE.Material).depthTest = false;
    helper.renderOrder = 10;
    this.selectGroup.add(helper);
  }

  /** A pulsing beacon over the chosen target room. */
  markTarget(gr: RoomGraph, key: string | null): void {
    const existing = this.markerGroup.getObjectByName('target');
    if (existing) this.markerGroup.remove(existing);
    if (!key) return;
    const n = gr.nodes.get(key);
    if (!n || !n.room_id) return;
    const beacon = new THREE.Mesh(
      new THREE.CylinderGeometry(0.28, 0.28, 6, 12, 1, true),
      new THREE.MeshBasicMaterial({ color: COL.target, transparent: true, opacity: 0.32, side: THREE.DoubleSide }),
    );
    beacon.name = 'target';
    beacon.position.set(n.centre_u[0], this.storeyBase(n.storey_id) + 3, n.centre_u[1]);
    this.markerGroup.add(beacon);
  }
}
