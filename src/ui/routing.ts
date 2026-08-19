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

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;
const WALK_HEIGHT_M = 3;

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
  let lastPath: RoutePath = { points: [], length_m: 0 };
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
      plan.targetKey = state.targetKey;
      overlays.markTarget(ref.gr, state.targetKey);
      $('no-route-banner').classList.toggle('on', !r);
      lastPath = routePath(ref.gr, r, S.doc, S.derived.mpu);
      if (r) {
        overlays.drawRoute(ref.gr, r);
        const un = S.derived.unscaled;
        const dist = un ? 'distance UNAVAILABLE (unscaled)' : `${lastPath.length_m.toFixed(0)} m · ~${formatEta(etaSeconds(lastPath.length_m))}`;
        $('route-out').innerHTML =
          `<div class="route-hdr">${r.doors} doors · ${r.nodes.length} spaces · ${dist}</div>` +
          r.nodes.map((k, i) => {
            const n = ref.gr.nodes.get(k)!;
            const e = r.edges[i - 1];
            const via = e
              ? ` <span class="k">via ${e.kind === 'STAIR' ? 'stair' : e.opening_id}${ref.br.has(e.key) ? ' · BRIDGE' : ''}</span>`
              : '';
            return `<div class="route-line"><span class="step">${String(i + 1).padStart(2, '0')}</span> ${n.name}${via}</div>`;
          }).join('');
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

  /** Reflects the current route/scale into the walkthrough button. No-op while it is playing — that transition is owned by finishPlayback(). */
  const syncWalkBtn = (): void => {
    if (playing) return;
    const playable = !!state.currentRoute && lastPath.points.length >= 2 && !S.derived.unscaled;
    walkBtn.disabled = !playable;
    walkBtn.title = S.derived.unscaled
      ? 'Blocked: the model is UNSCALED. Set a real scale before timing a route.'
      : !playable
        ? 'Compute a route between two different spaces first.'
        : `Fly the route at walking pace (${formatEta(etaSeconds(lastPath.length_m))}, ` +
          `${formatPace(lastPath.length_m)}). It plays to the end once started.`;
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
    walkBtn.textContent = `Playing · ${formatEta(etaSeconds(lastPath.length_m))} · ${formatPace(lastPath.length_m)}`;
    setControlsLocked(true);
    viewer.followPath(lastPath.points, WALK_HEIGHT_M, walkFlightMs(lastPath.length_m), true);
    pollId = window.setInterval(() => { if (!viewer.busy) finishPlayback(); }, 150);
  };

  $('btn-route').onclick = state.showRoute;
  fromSel.onchange = state.showRoute;
  toSel.onchange = state.showRoute;

  $('btn-save-route').onclick = () => {
    if (!state.currentRoute) return;
    const legs = new Map<string, Array<[number, number]>>();
    for (let i = 0; i < state.currentRoute.nodes.length; i++) {
      const n = ref.gr.nodes.get(state.currentRoute.nodes[i]);
      if (n?.room_id) {
        const arr = legs.get(n.storey_id) ?? [];
        arr.push(n.centre_u);
        legs.set(n.storey_id, arr);
      }
      const e = state.currentRoute.edges[i];
      if (e) {
        const arr = legs.get(e.storey_id) ?? [];
        arr.push(e.point_u);
        legs.set(e.storey_id, arr);
      }
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
