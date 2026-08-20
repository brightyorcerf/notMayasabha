/**
 * Turn-by-turn instructions for a walkable path.
 *
 * Takes:   the simplified path points, their cumulative distances, and the route the
 *          path was built from (for the names of the spaces being entered).
 * Returns: an ordered list of Steps, each anchored to a point index and a distance.
 * Assumes: the points have already been simplified — a direction derived from raw 50 mm
 *          A* cells is noise. A turn is only meaningful about a path that stays inside
 *          walkable space, so this must never be run on a straight centroid polyline.
 */

import type { PathPoint, Step, Turn } from './path';
import type { RoomGraph, Route } from './graph';

/** Below this, a change of heading is drift, not a turn worth calling. */
const AHEAD_DEG = 22;
/** Above this, it reads as a doubling back rather than a turn. */
const HARD_DEG = 105;
/** Legs shorter than this are joined to their neighbour before headings are measured. */
const MIN_LEG_U = 0.45;
/** A climb of at least this much between points is a storey change, not a ramp. */
const CLIMB_M = 0.4;

function heading(a: PathPoint, b: PathPoint): number {
  return Math.atan2(b.y_u - a.y_u, b.x_u - a.x_u);
}

/** Signed turn in degrees, positive to the right in plan space (screen Y grows down). */
function signedTurn(prev: number, next: number): number {
  let d = next - prev;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return (d * 180) / Math.PI;
}

function classify(deg: number): Turn {
  const a = Math.abs(deg);
  if (a < AHEAD_DEG) return 'AHEAD';
  if (a >= HARD_DEG) return deg > 0 ? 'HARD_RIGHT' : 'HARD_LEFT';
  return deg > 0 ? 'RIGHT' : 'LEFT';
}

const PHRASE: Record<Turn, string> = {
  START: 'Start',
  AHEAD: 'Continue ahead',
  LEFT: 'Turn left',
  RIGHT: 'Turn right',
  HARD_LEFT: 'Sharp left',
  HARD_RIGHT: 'Sharp right',
  UP: 'Up the stairs',
  DOWN: 'Down the stairs',
  ARRIVE: 'Arrive',
};

/** Distance rounded the way a person says it out loud, not the way a float prints. */
function say(m: number): string {
  return m < 10 ? `${m.toFixed(1)} m` : `${Math.round(m)} m`;
}

/**
 * Reduce a path to the instructions a person would be given. Consecutive points that
 * continue in the same heading collapse into one leg, so a corridor with a slight jog
 * reads as "continue ahead 20 m" rather than four separate nudges.
 */
export function turnSteps(
  points: PathPoint[], cumulative_m: number[], gr: RoomGraph, r: Route,
): Step[] {
  if (points.length < 2) return [];
  const dest = gr.nodes.get(r.nodes[r.nodes.length - 1]);
  const steps: Step[] = [{ at: 0, turn: 'START', dist_m: 0, text: 'Start' }];

  // Indices worth measuring a heading at: skip the noise of very short legs.
  const keep: number[] = [0];
  for (let i = 1; i < points.length; i++) {
    const p = points[keep[keep.length - 1]], q = points[i];
    if (Math.hypot(q.x_u - p.x_u, q.y_u - p.y_u) >= MIN_LEG_U || i === points.length - 1) keep.push(i);
  }

  for (let k = 1; k < keep.length - 1; k++) {
    const i = keep[k];
    const climb = points[keep[k + 1]].floor_m - points[i].floor_m;
    if (Math.abs(climb) >= CLIMB_M) {
      const turn: Turn = climb > 0 ? 'UP' : 'DOWN';
      if (steps[steps.length - 1].turn !== turn) {
        steps.push({ at: i, turn, dist_m: cumulative_m[i], text: PHRASE[turn] });
      }
      continue;
    }
    const t = classify(signedTurn(
      heading(points[keep[k - 1]], points[i]),
      heading(points[i], points[keep[k + 1]]),
    ));
    if (t === 'AHEAD') continue;
    steps.push({ at: i, turn: t, dist_m: cumulative_m[i], text: PHRASE[t] });
  }

  const end = points.length - 1;
  steps.push({
    at: end, turn: 'ARRIVE', dist_m: cumulative_m[end],
    text: dest ? `Arrive ${dest.name}` : 'Arrive',
  });

  // Distances read as "how far from the last instruction", which is how they are used.
  for (let i = 0; i < steps.length; i++) {
    const run = steps[i].dist_m - (i ? steps[i - 1].dist_m : 0);
    if (i > 0 && run >= 0.5) steps[i].text += ` after ${say(run)}`;
  }
  return steps;
}
