/**
 * Routing panel wiring: from/to pickers, compute route, save route as a briefing leg.
 *
 * Takes:   the session, the 2D plan, the tactical overlays, and a live reference to
 *          the current room graph (rebuilt elsewhere on every document change).
 * Returns: `fillPickers`/`showRoute` for the caller to invoke on boot and on change,
 *          and getters for the last computed route — briefing wiring needs both.
 * Assumes: the graph reference's `.gr`/`.br` are updated in place before these run;
 *          this module never rebuilds the graph itself.
 */

import type { Session } from '../core/session';
import type { Plan2D } from '../view2d/plan';
import type { Overlays } from '../view3d/overlays';
import { route as findRoute, OUTSIDE, type Route, type RoomGraph } from '../analysis/graph';

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;

export interface GraphRef {
  gr: RoomGraph;
  br: Set<string>;
}

export interface Routing {
  fillPickers: () => void;
  showRoute: () => void;
  currentRoute: Route | null;
  targetKey: string | null;
  fromSel: HTMLSelectElement;
  toSel: HTMLSelectElement;
}

export function installRouting(S: Session, plan: Plan2D, overlays: Overlays, ref: GraphRef): Routing {
  const fromSel = $<HTMLSelectElement>('sel-from');
  const toSel = $<HTMLSelectElement>('sel-to');
  const state: Routing = {
    fromSel, toSel, currentRoute: null, targetKey: null,
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
      if (r) {
        overlays.drawRoute(ref.gr, r);
        $('route-out').innerHTML =
          `<div class="route-hdr">${r.doors} doors · ${r.nodes.length} spaces</div>` +
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
    },
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
