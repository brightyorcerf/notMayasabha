/**
 * The cinematic tracking shot: a camera flown along a pre-computed walkable path.
 *
 * Takes:   a world-space polyline, a duration, a rise above the path and a trailing leash.
 * Returns: `step(dt)` drives one frame and reports progress; `done` ends the shot.
 * Assumes: the polyline is already collision-free — it is searched on the occupancy grid
 *          by `analysis/path.ts` before it ever reaches here. This class does no collision
 *          work of its own and must never be handed a raw centroid polyline.
 */

import * as THREE from 'three';

/** Look-ahead along the path, in world metres. A fraction of total arc length made turn
 *  anticipation depend on how long the route happened to be. */
const LOOK_AHEAD_M = 2.6;
/** Radians per second the heading may slew. A corner is turned into, not snapped to. */
const YAW_RATE = 2.2;
/** How far in front of the camera the look target is placed, in metres. */
const TARGET_M = 6;

export class TrackingShot {
  private curve: THREE.CatmullRomCurve3;
  private t = 0;
  private yaw: number;
  private len: number;
  /** Progress 0..1. */
  k = 0;

  constructor(
    points: THREE.Vector3[],
    private dur_s: number,
    private rise: number,
    private leash: number,
    private mpu: number,
  ) {
    // 'centripetal', not 'catmullrom'. The uniform variant overshoots its control points
    // at a corner and the bulge went straight through the wall the corner was made of;
    // the centripetal parameterisation is provably cusp- and loop-free, so the curve stays
    // inside the corridor the path was searched in.
    this.curve = new THREE.CatmullRomCurve3(points, false, 'centripetal', 0.5);
    this.len = this.curve.getLength() || 1;
    this.yaw = Math.atan2(points[1].x - points[0].x, points[1].z - points[0].z);
  }

  get done(): boolean { return this.k >= 1; }

  /**
   * Where to leave the camera once the shot ends. A tracking shot finishes standing
   * inside the destination room at eye height, and the orbit controls then take over
   * from exactly there — which means orbiting from inside a wall. This hands back a
   * framing of the last point instead: pulled back along the final heading and lifted,
   * so the space that was just walked to is the thing on screen.
   */
  endFraming(back_m: number, up_m: number): { pos: THREE.Vector3; look: THREE.Vector3 } {
    const look = this.curve.getPointAt(1);
    const b = back_m * this.mpu;
    return {
      look,
      pos: new THREE.Vector3(
        look.x - Math.sin(this.yaw) * b,
        look.y + up_m,
        look.z - Math.cos(this.yaw) * b,
      ),
    };
  }

  /**
   * Advance one frame and place the camera. The camera rides the path at eye height by
   * default: the previous version sat 6.5 m behind and several metres above, which on a
   * 3.2 m storey put it above the wall tops on one plan and inside the storey above on
   * the other. `leash` reintroduces a trail deliberately, clamped so it can never exceed
   * the distance already travelled.
   */
  step(dt: number, camera: THREE.PerspectiveCamera, target: THREE.Vector3): void {
    this.t += dt;
    this.k = Math.min(1, this.t / this.dur_s);

    const look = (LOOK_AHEAD_M * this.mpu) / this.len;
    const p = this.curve.getPointAt(this.k);
    const ahead = this.curve.getPointAt(Math.min(1, this.k + look));

    // Damped yaw on the shortest angular path. A hard corner would otherwise slew as fast
    // as the curve turns, which is what read as the camera snapping around.
    const want = Math.atan2(ahead.x - p.x, ahead.z - p.z);
    let d = want - this.yaw;
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    this.yaw += Math.max(-YAW_RATE * dt, Math.min(YAW_RATE * dt, d));

    const trail = Math.min(this.leash, this.k * this.len);
    const at = this.curve.getPointAt(Math.max(0, this.k - trail / this.len));
    camera.position.set(at.x, at.y + this.rise, at.z);

    const m = TARGET_M * this.mpu;
    target.set(p.x + Math.sin(this.yaw) * m, p.y, p.z + Math.cos(this.yaw) * m);
    camera.lookAt(target);
  }
}
