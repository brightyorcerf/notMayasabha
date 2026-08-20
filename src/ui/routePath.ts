/**
 * Camera path and walking metrics for a computed Route.
 *
 * Takes:   the room graph, a Route (or null), the document, the grids and mpu.
 * Returns: world-space points for the viewer's cinematic camera, the measured walking
 *          length, and the turn-by-turn steps aligned to those points.
 * Assumes: the geometry is `analysis/path.ts`'s problem, not this file's — everything
 *          here is presentation: the exterior lead-in, the metre conversion and the
 *          playback timing. mpu is the ratio the caller resolved; UNSCALED gating (I4)
 *          happens at the call site.
 */

import * as THREE from 'three';
import { OUTSIDE, type RoomGraph, type Route } from '../analysis/graph';
import { walkPath, type Step, type PathPoint } from '../analysis/path';
import { EYE_M } from '../view3d/viewer';
import { traverseSeconds, profile, type ProfileId, type TraverseInput } from '../analysis/pace';
import type { Grid } from '../core/grid';
import type { SiteDocument } from '../core/types';


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
  /** Camera path in world space. Includes the exterior lead-in when the route starts outside. */
  points: THREE.Vector3[];
  /** Measured walking distance over the route itself. Never includes the camera lead-in. */
  length_m: number;
  /** Turn-by-turn steps. `at` indexes into `points`, lead-in already accounted for. */
  steps: Step[];
  /** Cumulative metres at each point, aligned to `points`. */
  cumulative_m: number[];
  /**
   * The same path in plan space (document units), for the 2D plan and the 3D ribbon.
   * They must draw the path the camera actually flies, or the drawn route crosses walls
   * the flight avoids and the two disagree in front of a judge.
   */
  plan: PathPoint[];
  /** What the pace model needs: distances split by kind, plus the fixed-cost counts. */
  traverse: TraverseInput;
}

export function routePath(
  gr: RoomGraph, route: Route | null, site: SiteDocument,
  grids: Map<string, Grid>, mpu: number,
): RoutePath {
  const wp = walkPath(gr, route, site, grids, mpu);
  const traverse: TraverseInput = {
    level_m: wp.level_m,
    climb_m: wp.climb_m,
    doors: route ? route.doors : 0,
    // Only steps that actually change direction. AHEAD is filtered out upstream, and
    // START/ARRIVE are not turns, so what remains is the corners worth clearing.
    turns: wp.steps.filter((s) => s.turn !== 'START' && s.turn !== 'ARRIVE'
      && s.turn !== 'UP' && s.turn !== 'DOWN').length,
  };
  if (wp.points.length === 0) {
    return { points: [], length_m: 0, steps: [], cumulative_m: [], plan: [], traverse };
  }

  const points = wp.points.map((p) => new THREE.Vector3(p.x_u * mpu, p.floor_m + EYE_M, p.y_u * mpu));
  let steps = wp.steps;
  let cumulative_m = wp.cumulative_m;

  // The lead-in is prepended AFTER the measurement, and every index that refers to a
  // point is shifted with it. Order matters: this is the whole reason the distance a
  // commander reads is the distance a commander would walk.
  if (route && route.nodes[0] === OUTSIDE && points.length >= 2) {
    const d = new THREE.Vector3().subVectors(points[0], points[1])
      .setY(0).normalize().multiplyScalar(CAMERA_LEAD_IN_M);
    points.unshift(new THREE.Vector3().addVectors(points[0], d));
    steps = steps.map((s) => ({ ...s, at: s.at + 1 }));
    cumulative_m = [0, ...cumulative_m];
  }

  return { points, length_m: wp.length_m, steps, cumulative_m, plan: wp.points, traverse };
}

export function etaSeconds(t: TraverseInput, id: ProfileId): number {
  return traverseSeconds(t, id);
}

export function formatEta(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)} s`;
  const m = Math.floor(seconds / 60), s = Math.round(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** Preview duration for the Tactical Layer walkthrough: real pace, bounded at both ends. */
export function walkFlightMs(t: TraverseInput, id: ProfileId): number {
  return Math.min(MAX_WALK_FLIGHT_MS, Math.max(MIN_WALK_FLIGHT_MS, etaSeconds(t, id) * 1000));
}

/** How much faster than a real traverse the preview runs. 1 is real time. */
export function playbackRate(t: TraverseInput, id: ProfileId): number {
  const s = etaSeconds(t, id);
  if (!(s > 0)) return 1;
  return (s * 1000) / walkFlightMs(t, id);
}

/** Says the pace out loud, so a compressed preview never implies it is real time. */
export function formatPace(t: TraverseInput, id: ProfileId): string {
  const r = playbackRate(t, id);
  if (r > 1.01) return `${r.toFixed(1)}× speed`;
  if (r < 0.99) return `${(1 / r).toFixed(1)}× slowed`;
  return 'real time';
}

/** The profile's own label, for anywhere a time is printed without its context. */
export function paceLabel(id: ProfileId): string {
  return profile(id).label;
}
