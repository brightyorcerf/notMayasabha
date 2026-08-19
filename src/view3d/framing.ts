/**
 * Camera framing maths. Pure: no three.js scene, no DOM, no side effects.
 *
 * Takes:   a bounding box and the camera's field of view and aspect.
 * Returns: where to stand and what to look at so the box fills the view.
 * Assumes: a Y-up world and a perspective camera. The caller decides how to get
 *          there — cut, or the viewer's eased flyTo.
 */

import * as THREE from 'three';

/** How much empty space to leave around a framed box. 1.0 is a tight fit. */
const PADDING = 1.28;
/** Compass bearing the framing camera approaches from, so north stays up-ish. */
const AZIMUTH = Math.PI * 0.82;
/** How steeply the framing camera looks down. Higher reads more like a plan. */
const PITCH = 0.62;

export interface Framing {
  pos: THREE.Vector3;
  look: THREE.Vector3;
}

/**
 * Distance at which a sphere of `radius` fits inside both the vertical and the
 * horizontal field of view. The horizontal one binds on wide, shallow buildings,
 * which is exactly the shape a floor plan usually is.
 */
export function fitDistance(radius: number, fovDeg: number, aspect: number): number {
  const vFov = (fovDeg * Math.PI) / 180;
  const hFov = 2 * Math.atan(Math.tan(vFov / 2) * aspect);
  const dV = radius / Math.sin(vFov / 2);
  const dH = radius / Math.sin(hFov / 2);
  return Math.max(dV, dH) * PADDING;
}

/**
 * Frame a box from a fixed three-quarter angle. Deterministic: the same box always
 * frames identically, so "reset view" and "frame the route" are repeatable on stage.
 */
export function frameBox(box: THREE.Box3, fovDeg: number, aspect: number): Framing {
  const look = box.getCenter(new THREE.Vector3());
  const radius = Math.max(0.5, box.getBoundingSphere(new THREE.Sphere()).radius);
  const d = fitDistance(radius, fovDeg, aspect);
  const horiz = Math.cos(PITCH) * d;
  const pos = new THREE.Vector3(
    look.x + Math.cos(AZIMUTH) * horiz,
    look.y + Math.sin(PITCH) * d,
    look.z + Math.sin(AZIMUTH) * horiz,
  );
  return { pos, look };
}
