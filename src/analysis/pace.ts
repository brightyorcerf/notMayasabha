/**
 * Movement profiles: how long a route takes an assaulting team, not a pedestrian.
 *
 * Takes:   the level and climb distances of a path, its door and turn counts, a profile.
 * Returns: a traverse time in seconds, and the strings that say which profile produced it.
 * Assumes: these are CONFIGURABLE PLANNING ESTIMATES, not doctrine and not measured
 *          truth — the same standing as the plausibility bands in `core/scale.ts` (§5).
 *          A number here is a defensible starting point that an operator is expected to
 *          override for their own team, load and SOP. Nothing downstream may present a
 *          figure from this module as a guarantee.
 */

export type ProfileId = 'DELIBERATE' | 'TACTICAL' | 'DYNAMIC';

export interface PaceProfile {
  id: ProfileId;
  label: string;
  /** Speed over cleared, level floor, in metres per second. */
  level_mps: number;
  /** Speed measured ALONG the stair slope, not vertically. Always slower than level. */
  stair_mps: number;
  /** Seconds lost at each doorway: stack, check, cross the threshold. */
  door_s: number;
  /** Seconds lost at each change of direction: a corner has to be cleared before it is turned. */
  turn_s: number;
  /** What this profile represents, in one line. Shown to the operator, so it must be honest. */
  note: string;
}

/**
 * Three profiles, all assuming a loaded operator (body armour, helmet, weapon, breaching
 * kit — call it 20 kg), which is why every figure sits below the equivalent unloaded one.
 *
 * The spread between DELIBERATE and DYNAMIC is roughly five to one, and that is the point:
 * the same corridor is a different problem depending on whether the building is believed
 * hostile. A single "walking pace" hid that entirely.
 */
export const PROFILES: readonly PaceProfile[] = [
  {
    id: 'DELIBERATE',
    label: 'Deliberate clear',
    // Weapon up, every space treated as unknown. Slower than a civilian stroll on purpose:
    // the limit is not fitness, it is how fast a room can be honestly cleared.
    level_mps: 0.65,
    stair_mps: 0.35,
    door_s: 4.0,
    turn_s: 1.5,
    note: 'Weapon up, every space unknown. Room-by-room clearance.',
  },
  {
    id: 'TACTICAL',
    label: 'Tactical advance',
    // The default. Movement through partially cleared space at a controlled pace — below
    // an unloaded walk (~1.35 m/s) because of kit and because corners are still cut.
    level_mps: 1.20,
    stair_mps: 0.60,
    door_s: 2.0,
    turn_s: 0.6,
    note: 'Controlled advance through partially cleared space. The default.',
  },
  {
    id: 'DYNAMIC',
    label: 'Dynamic entry',
    // Speed-and-surprise assault along a known route. A loaded sprint in the open is
    // ~5 m/s; inside a building with corners and doors nobody sustains that, so this is
    // a fast jog, not a sprint, and the door and turn costs stay non-zero.
    level_mps: 3.20,
    stair_mps: 1.20,
    door_s: 0.8,
    turn_s: 0.2,
    note: 'Speed and surprise on a known route. Assumes the path is already briefed.',
  },
] as const;

export const DEFAULT_PROFILE: ProfileId = 'TACTICAL';

export function profile(id: ProfileId): PaceProfile {
  const p = PROFILES.find((x) => x.id === id);
  if (!p) throw new Error(`unknown movement profile: ${id}`);
  return p;
}

export interface TraverseInput {
  level_m: number;
  climb_m: number;
  /** Doorways crossed. Each costs `door_s` whatever the distance. */
  doors: number;
  /** Direction changes worth clearing. Straight-ahead steps do not count. */
  turns: number;
}

/**
 * Seconds to traverse a route under a profile.
 *
 * Distance alone was the old model, and it under-reported every short route with many
 * doors: five doorways in twelve metres is not a nine-second problem. The fixed costs are
 * usually the larger term indoors, which is the whole reason they are modelled separately
 * rather than folded into a lower average speed.
 */
export function traverseSeconds(t: TraverseInput, id: ProfileId): number {
  const p = profile(id);
  return t.level_m / p.level_mps
    + t.climb_m / p.stair_mps
    + t.doors * p.door_s
    + t.turns * p.turn_s;
}

/** The share of the total that is standing still. Worth showing: indoors it is often most of it. */
export function fixedShare(t: TraverseInput, id: ProfileId): number {
  const total = traverseSeconds(t, id);
  if (!(total > 0)) return 0;
  const p = profile(id);
  return (t.doors * p.door_s + t.turns * p.turn_s) / total;
}
