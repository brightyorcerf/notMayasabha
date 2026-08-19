/**
 * World-space point sequence and walking metrics for a computed Route.
 *
 * Takes:   the room graph, a Route (or null), the document (for storey elevation)
 *          and the live metres-per-unit ratio.
 * Returns: an ordered list of world points for the viewer's cinematic camera, plus
 *          the measured walking length and the timing helpers derived from it.
 * Assumes: mpu is the ratio the caller already resolved — UNSCALED gating (I4) happens
 *          at the call site, not here. Storey transform is not applied, matching the
 *          placement Briefing Mode has always used for its flight path.
 */

import * as THREE from 'three';
import { OUTSIDE, type RoomGraph, type Route } from '../analysis/graph';
import type { SiteDocument } from '../core/types';

const EYE_M = 1.6;

/** A room-clearing team's pace: not a sprint, not a stroll. */
export const WALK_PACE_MPS = 1.35;

/**
 * How far outside the building the camera starts an exterior route, so the approach
 * reads as an approach and not a jump-cut onto the doorstep. It is a framing device
 * for the camera only and is deliberately excluded from `length_m` — a commander's
 * distance must not contain a number invented by the cinematography.
 */
const CAMERA_LEAD_IN_M = 7;

/** Briefing Mode stage 3 is rehearsed choreography in a five-step sequence: fixed and brisk. */
export const BRIEFING_FLIGHT_MS = 6500;

/**
 * The Tactical Layer preview plays at real walking pace, so the time on the clock is the
 * answer. The bounds only catch the degenerate ends: a two-metre hop that would flash past,
 * and a route long enough to strand the operator watching it (playback is uninterruptible).
 */
const MIN_WALK_FLIGHT_MS = 3000;
const MAX_WALK_FLIGHT_MS = 20000;

export interface RoutePath {
  /** Camera path. Includes the exterior lead-in when the route starts outside. */
  points: THREE.Vector3[];
  /** Measured walking distance over the route itself. Never includes the camera lead-in. */
  length_m: number;
}

export function routePath(gr: RoomGraph, route: Route | null, site: SiteDocument, mpu: number): RoutePath {
  const points: THREE.Vector3[] = [];
  if (!route) return { points, length_m: 0 };
  const base = (id: string): number => site.storeys.find((s) => s.id === id)?.elevation_m ?? 0;

  for (let i = 0; i < route.nodes.length; i++) {
    const n = gr.nodes.get(route.nodes[i]);
    if (n && n.room_id) {
      points.push(new THREE.Vector3(n.centre_u[0] * mpu, base(n.storey_id) + EYE_M, n.centre_u[1] * mpu));
    }
    const e = route.edges[i];
    if (e) {
      points.push(new THREE.Vector3(e.point_u[0] * mpu, base(e.storey_id) + EYE_M, e.point_u[1] * mpu));
    }
  }

  // Measured before the lead-in is prepended. Order matters: this is the whole reason
  // the distance a commander reads is the distance a commander would walk.
  let length_m = 0;
  for (let i = 1; i < points.length; i++) length_m += points[i].distanceTo(points[i - 1]);

  if (route.nodes[0] === OUTSIDE && points.length >= 2) {
    const d = new THREE.Vector3().subVectors(points[0], points[1])
      .setY(0).normalize().multiplyScalar(CAMERA_LEAD_IN_M);
    points.unshift(new THREE.Vector3().addVectors(points[0], d));
  }

  return { points, length_m };
}

export function etaSeconds(length_m: number): number {
  return length_m / WALK_PACE_MPS;
}

export function formatEta(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)} s`;
  const m = Math.floor(seconds / 60), s = Math.round(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** Preview duration for the Tactical Layer walkthrough: real pace, bounded at both ends. */
export function walkFlightMs(length_m: number): number {
  return Math.min(MAX_WALK_FLIGHT_MS, Math.max(MIN_WALK_FLIGHT_MS, etaSeconds(length_m) * 1000));
}

/** How much faster than a real walk the preview runs. 1 is real time. */
export function playbackRate(length_m: number): number {
  if (!(length_m > 0)) return 1;
  return (etaSeconds(length_m) * 1000) / walkFlightMs(length_m);
}

/** Says the pace out loud, so a compressed preview never implies it is real time. */
export function formatPace(length_m: number): string {
  const r = playbackRate(length_m);
  if (r > 1.01) return `${r.toFixed(1)}× speed`;
  if (r < 0.99) return `${(1 / r).toFixed(1)}× slowed`;
  return 'real time';
}
