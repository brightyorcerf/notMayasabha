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
import { makeLabel, type Label } from './labels';

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
  private labelGroup = new THREE.Group();
  /**
   * Live labels, kept so their canvas textures can be released on redraw. Room chips
   * and marker chips are tracked separately because they are rebuilt by different
   * calls: disposing one set from the other's redraw would blank sprites still in
   * the scene.
   */
  private roomLabels: Label[] = [];
  private markerLabels: Label[] = [];
  private baseDoorColour = new Map<string, number>();
  /** Room-name chips are off by default: they are context, not tactical state. */
  private roomLabelsOn = false;
  private lastGraph: RoomGraph | null = null;
  /**
   * Plan scale, so a chip stays square when the world group is rescaled. app.ts sets
   * it on every SET_SCALE, before the overlays are redrawn.
   */
  mpu = 1;

  constructor(
    group: THREE.Group,
    private site: SiteDocument,
    private meshes: SiteMeshes,
  ) {
    group.add(this.routeGroup, this.markerGroup, this.selectGroup, this.labelGroup);
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

  /**
   * Draw the route as a floating ribbon with a marker at every door it passes.
   * `walk` is the searched walkable path in document units; when it is supplied the
   * ribbon follows it exactly, so the drawn route and the flown route are the same
   * line. The centroid fallback below is only for callers that have no path yet.
   */
  drawRoute(gr: RoomGraph, r: Route, walk?: Array<{ x_u: number; y_u: number; floor_m: number }>): void {
    this.clearRoute();
    const pts: THREE.Vector3[] = [];
    if (walk && walk.length >= 2) {
      for (const p of walk) pts.push(new THREE.Vector3(p.x_u, p.floor_m + 0.25, p.y_u));
      this.ribbon(pts, r);
      return;
    }
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
    this.ribbon(pts, r);
  }

  /** The ribbon mesh and its door rings. Shared by both drawRoute paths. */
  private ribbon(pts: THREE.Vector3[], r: Route): void {
    if (pts.length < 2) return;

    // 'centripetal' for the same reason the camera uses it: the uniform variant
    // overshoots corners, and a ribbon that bulges through a wall says the route does.
    const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal', 0.5);
    const tube = new THREE.Mesh(
      new THREE.TubeGeometry(curve, Math.max(24, pts.length * 4), 0.09, 8, false),
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
    for (const l of this.markerLabels) l.dispose();
    this.markerLabels = [];
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
      // The marker's label was carried in the document but never drawn: a pink pin
      // with no text tells a commander something is there, not what it is.
      if (m.label.trim()) {
        const l = makeLabel(m.label, COL.marker, this.mpu);
        l.sprite.position.set(m.x_u, this.storeyBase(m.storey_id) + m.z_m + 1.5, m.y_u);
        this.markerLabels.push(l);
        g.add(l.sprite);
      }
      this.markerGroup.add(g);
    }
  }

  /**
   * Room-name chips, one per room, floating just above head height. Off by default and
   * driven by the header toggle: on a nineteen-room plan they are useful orientation in
   * the doll-house and pure clutter in a walkthrough, so the operator decides.
   * Passing the graph again refreshes them; the previous textures are released first.
   */
  drawRoomLabels(gr: RoomGraph): void {
    this.lastGraph = gr;
    this.clearLabels();
    if (!this.roomLabelsOn) return;
    for (const n of gr.nodes.values()) {
      if (n.key === OUTSIDE || !n.room_id) continue;
      const l = makeLabel(n.name, COL.door, this.mpu);
      l.sprite.position.set(n.centre_u[0], this.storeyBase(n.storey_id) + 2.6, n.centre_u[1]);
      this.roomLabels.push(l);
      this.labelGroup.add(l.sprite);
    }
  }

  /** Toggle the room chips. Returns the state it settled on, for the button's label. */
  toggleRoomLabels(on: boolean): boolean {
    this.roomLabelsOn = on;
    if (this.lastGraph) this.drawRoomLabels(this.lastGraph);
    return this.roomLabelsOn;
  }

  /** Release the room chips. A sprite off the graph still owns its canvas. */
  private clearLabels(): void {
    for (const l of this.roomLabels) l.dispose();
    this.roomLabels = [];
    this.labelGroup.clear();
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
