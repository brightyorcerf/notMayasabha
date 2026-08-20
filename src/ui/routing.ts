/**
 * Routing panel wiring: from/to pickers, compute route, save route as a briefing leg,
 * and the animated walkthrough preview.
 *
 * Takes:   the session, the 2D plan, the tactical overlays, the viewer, and a live
 *          reference to the current room graph (rebuilt elsewhere on every doc change).
 * Returns: `fillPickers`/`showRoute` for the caller to invoke on boot and on change,
 *          and getters for the last computed route — briefing wiring needs both.
 * Assumes: the graph reference's `.gr`/`.br` are updated in place before these run;
 *          this module never rebuilds the graph itself. The walkthrough button previews
 *          the same route Briefing Mode would fly — see `routePath.ts` for the shared
 *          point sequence — but is gated on I4 only, not on LOCKED: it is an operator's
 *          review aid, not the artifact that reaches a commander (ARCHITECTURE.md §5.1).
 *          Playback is uninterruptible and the route pickers freeze while it runs; the
 *          viewer enforces that, this module only mirrors it into the controls.
 */

import type { Session } from '../core/session';
import type { Plan2D } from '../view2d/plan';
import type { Overlays } from '../view3d/overlays';
import type { Viewer } from '../view3d/viewer';
import { route as findRoute, OUTSIDE, type Route, type RoomGraph } from '../analysis/graph';
import { routePath, etaSeconds, formatEta, formatPace, walkFlightMs, type RoutePath } from './routePath';
import { PROFILES, DEFAULT_PROFILE, profile, fixedShare, type ProfileId } from '../analysis/pace';
import type { Turn } from '../analysis/path';

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;

/** One glyph per instruction. Direction has to survive being read at a glance. */
const ARROW: Record<Turn, string> = {
  START: '\u25CF', AHEAD: '\u2191', LEFT: '\u2190', RIGHT: '\u2192',
  HARD_LEFT: '\u21B0', HARD_RIGHT: '\u21B1', UP: '\u21D1', DOWN: '\u21D3',
  ARRIVE: '\u25C9',
};
/**
 * The preview rides the path itself. It used to add 3 m on top of a path already at
 * eye height, which on a 3.2 m storey put the camera above the wall tops — a drone
 * shot, not a walkthrough. A short leash keeps a sense of a body moving ahead.
 */
const WALK_RISE_M = 0;
const WALK_LEASH_M = 1.2;

export interface GraphRef {
  gr: RoomGraph;
  br: Set<string>;
}

export interface Routing {
  fillPickers: () => void;
  showRoute: () => void;
  /** Notified when the uninterruptible walkthrough starts and ends, so the app can disable
   *  the controls outside this panel that would otherwise fight it for the camera. */
  onPlaybackChange: ((playing: boolean) => void) | null;
  currentRoute: Route | null;
  targetKey: string | null;
  fromSel: HTMLSelectElement;
  toSel: HTMLSelectElement;
}

export function installRouting(S: Session, plan: Plan2D, overlays: Overlays, ref: GraphRef, viewer: Viewer): Routing {
  const fromSel = $<HTMLSelectElement>('sel-from');
  const toSel = $<HTMLSelectElement>('sel-to');
  const walkBtn = $<HTMLButtonElement>('btn-walk-route');
  const paceSel = $<HTMLSelectElement>('sel-pace');
  let paceId: ProfileId = DEFAULT_PROFILE;
  let lastPath: RoutePath = {
    points: [], length_m: 0, steps: [], cumulative_m: [], plan: [],
    traverse: { level_m: 0, climb_m: 0, doors: 0, turns: 0 },
  };
  let playing = false;
  let pollId: number | null = null;

  const state: Routing = {
    fromSel, toSel, currentRoute: null, targetKey: null,
    onPlaybackChange: null,
    fillPickers: () => {
      const opts = [...ref.gr.nodes.values()]
        .map((n) => `<option value="${n.key}">${n.key === OUTSIDE ? 'Exterior (entry point)' : `L${n.level} · ${n.name}`}</option>`)
        .join('');
      const a = fromSel.value, b = toSel.value;
      fromSel.innerHTML = opts;
      toSel.innerHTML = opts;
      fromSel.value = a || OUTSIDE;
      const server = [...ref.gr.nodes.values()].find((n) => n.name === 'Server Room');
      toSel.value = b || (server ? server.key : [...ref.gr.nodes.keys()][1]);
    },
    showRoute: () => {
      const r = findRoute(ref.gr, fromSel.value, toSel.value);
      state.currentRoute = r;
      state.targetKey = toSel.value;
      plan.route = r;
      plan.routeWalk = null;
      plan.targetKey = state.targetKey;
      overlays.markTarget(ref.gr, state.targetKey);
      $('no-route-banner').classList.toggle('on', !r);
      lastPath = routePath(ref.gr, r, S.doc, S.derived.grids, S.derived.mpu);
      if (r) {
        plan.routeWalk = lastPath.plan;
        overlays.drawRoute(ref.gr, r, lastPath.plan);
        const un = S.derived.unscaled;
        const eta = etaSeconds(lastPath.traverse, paceId);
        // Bridge count folded into the header rather than repeated in a per-door list:
        // the Critical Doors panel already names every bridge in the building, so a
        // second, route-scoped listing of the same doors was the same fact twice.
        const bridgeCrossings = r.edges.filter((e) => ref.br.has(e.key)).length;
        const dist = un
          ? 'distance UNAVAILABLE (unscaled)'
          : `${lastPath.length_m.toFixed(0)} m · ~${formatEta(eta)} · ${profile(paceId).label}`;
        const doorLabel = `${r.doors} door${r.doors === 1 ? '' : 's'}` +
          (bridgeCrossings ? ` (${bridgeCrossings} critical)` : '');
        // Indoors the fixed costs usually dominate, so the share is shown rather than
        // buried in an average speed — but the formula behind it is a hover, not a
        // permanent line, so the panel does not spend three rows explaining one number.
        const pf = profile(paceId);
        const share = Math.round(fixedShare(lastPath.traverse, paceId) * 100);
        const formula = un ? '' :
          `${pf.level_mps.toFixed(2)} m/s level · ${pf.stair_mps.toFixed(2)} m/s stair · ` +
          `${lastPath.traverse.doors} doors × ${pf.door_s}s · ${lastPath.traverse.turns} turns × ${pf.turn_s}s`;
        const breakdown = un ? '' :
          `<div class="pace-note" title="${formula}">${pf.note} ` +
          `<span class="k">${share}% doors &amp; corners</span></div>`;
        const turns = un ? '' :
          '<div class="turn-list">' + lastPath.steps.map((st) =>
            `<div class="turn-line turn-${st.turn.toLowerCase()}"><span class="arrow">${ARROW[st.turn]}</span>${st.text}</div>`,
          ).join('') + '</div>';
        $('route-out').innerHTML =
          `<div class="route-hdr">${doorLabel} · ${r.nodes.length} spaces · ${dist}</div>` +
          breakdown +
          turns;
      } else {
        overlays.clearRoute();
        $('route-out').innerHTML =
          '<div class="item blocking"><div class="k">NO ROUTE</div>' +
          'The graph is disconnected between those two spaces — no door or stair links them. ' +
          'Check for a missing opening before you brief this path.</div>';
      }
      plan.draw();
      syncWalkBtn();
    },
  };

  /**
   * The live instruction for a point in the flight. The camera is at `k` of the total
   * arc, so the current step is the last one whose anchor point lies at or behind it.
   * Captioning is why `steps` carry a point index at all: a distance alone could not be
   * matched to the curve the camera is actually on.
   */
  const showCaption = (k: number): void => {
    const el = $('walk-caption');
    const n = lastPath.points.length;
    if (n < 2 || lastPath.steps.length === 0) { el.classList.remove('on'); return; }
    const at = k * (n - 1);
    let cur = lastPath.steps[0];
    for (const s of lastPath.steps) { if (s.at <= at + 0.5) cur = s; else break; }
    el.textContent = cur.text;
    el.classList.add('on');
  };

  /** Reflects the current route/scale into the walkthrough button. No-op while it is playing — that transition is owned by finishPlayback(). */
  const syncWalkBtn = (): void => {
    if (playing) return;
    const playable = !!state.currentRoute && lastPath.points.length >= 2 && !S.derived.unscaled;
    walkBtn.disabled = !playable;
    walkBtn.title = S.derived.unscaled
      ? 'Blocked: the model is UNSCALED. Set a real scale before timing a route.'
      : !playable
        ? 'Compute a route between two different spaces first.'
        : `Fly the route at ${profile(paceId).label} pace ` +
          `(${formatEta(etaSeconds(lastPath.traverse, paceId))}, ` +
          `${formatPace(lastPath.traverse, paceId)}). It plays to the end once started.`;
  };

  /**
   * The route pickers are frozen for the duration. The animation is a timed measurement of
   * one specific route, so letting the operator select a different one underneath it would
   * put the 2D plan and the flying camera on two different paths at once.
   */
  const setControlsLocked = (on: boolean): void => {
    fromSel.disabled = on;
    toSel.disabled = on;
    $<HTMLButtonElement>('btn-route').disabled = on;
    $<HTMLButtonElement>('btn-save-route').disabled = on;
    state.onPlaybackChange?.(on);
  };

  const finishPlayback = (): void => {
    playing = false;
    viewer.onPathProgress = null;
    $('walk-caption').classList.remove('on');
    if (pollId !== null) { clearInterval(pollId); pollId = null; }
    walkBtn.textContent = 'Animated walkthrough';
    walkBtn.classList.remove('on');
    setControlsLocked(false);
    syncWalkBtn();
  };

  walkBtn.onclick = () => {
    if (playing || walkBtn.disabled) return;
    playing = true;
    walkBtn.classList.add('on');
    walkBtn.disabled = true;
    walkBtn.textContent = `Playing · ${formatEta(etaSeconds(lastPath.traverse, paceId))} · ${formatPace(lastPath.traverse, paceId)}`;
    setControlsLocked(true);
    viewer.followPath(
      lastPath.points, WALK_RISE_M, walkFlightMs(lastPath.traverse, paceId), true, WALK_LEASH_M,
    );
    showCaption(0);
    viewer.onPathProgress = showCaption;
    pollId = window.setInterval(() => { if (!viewer.busy) finishPlayback(); }, 150);
  };

  // The pace profiles, and the honest note under whichever is selected. Changing the
  // profile recomputes the route rather than just relabelling it: the preview duration,
  // the button text and the ETA all derive from it.
  for (const p of PROFILES) {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = p.label;
    opt.title = p.note;
    paceSel.appendChild(opt);
  }
  paceSel.value = paceId;
  paceSel.onchange = () => {
    if (playing) return;
    paceId = paceSel.value as ProfileId;
    state.showRoute();
  };

  $('btn-route').onclick = state.showRoute;
  fromSel.onchange = state.showRoute;
  toSel.onchange = state.showRoute;

  $('btn-save-route').onclick = () => {
    if (!state.currentRoute) return;
    // The saved leg is the searched walkable path, not the centroid line. What a
    // commander is briefed on has to be the path that was previewed and timed.
    const legs = new Map<string, Array<[number, number]>>();
    for (const p of lastPath.plan) {
      const arr = legs.get(p.storey_id) ?? [];
      arr.push([p.x_u, p.y_u]);
      legs.set(p.storey_id, arr);
    }
    const to = ref.gr.nodes.get(toSel.value)!;
    S.do('ADD_ROUTE', [`route-${toSel.value}`], {
      name: `Entry to ${to.name}`, team: 'ALPHA', color: '#00e5ff',
      from_key: fromSel.value, to_key: toSel.value,
      legs: [...legs].map(([storey_id, points_u]) => ({ storey_id, points_u })),
    }, `saved route: entry to ${to.name}`);
  };

  return state;
}
