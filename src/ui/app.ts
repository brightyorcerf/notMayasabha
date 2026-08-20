/**
 * Application wiring. The only module that touches the DOM and the viewer together.
 *
 * Takes:   nothing. It loads the bundled document at start.
 * Returns: nothing. It owns the UI event graph.
 * Assumes: every write goes through Session.do. Everything below this file is pure
 *          and testable without a browser (see tools/smoke.ts).
 */

import * as THREE from 'three';
import { loadDoc, statusGate, PLANS, DEFAULT_PLAN, isPlanId, type PlanId } from '../core/site';
import { Session } from '../core/session';
import { health } from '../core/netguard';
import { buildSiteMeshes } from '../geometry/build3d';
import {
  buildRoomGraph, bridges, articulationPoints, betweenness,
  nodeKey, OUTSIDE, type RoomGraph,
} from '../analysis/graph';
import { Viewer } from '../view3d/viewer';
import { Overlays } from '../view3d/overlays';
import { Plan2D, type PlanSelection } from '../view2d/plan';
import { loadPack, buildNeighbourhood } from '../geo/neighbourhood';
import { Briefing } from './briefing';
import { installScalePanel } from './scalePanel';
import { installRouting } from './routing';
import { installBriefingExport } from './briefingExport';
import {
  renderScale, renderFindings, renderGateHint, renderOps, renderMetrics,
  renderSelection, renderParams,
} from './panels';

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;

/**
 * Which plan to boot, taken from `?plan=`. Unknown or absent values fall back to the
 * default rather than throwing: a mistyped URL should still show a building.
 */
function planFromUrl(): PlanId {
  const v = new URLSearchParams(window.location.search).get('plan');
  return isPlanId(v) ? v : DEFAULT_PLAN;
}

/**
 * Populate the plan selector and switch plans by reloading with a new `?plan=`.
 * A reload rather than an in-place rebuild: boot is a few milliseconds, and tearing
 * down the viewer, overlays, grids and op log by hand is a whole class of bugs that
 * a demo cannot afford. The URL also makes the choice shareable and bookmarkable.
 */
function installPlanPicker(current: PlanId): void {
  const sel = $<HTMLSelectElement>('sel-plan');
  for (const p of PLANS) {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = p.label;
    sel.appendChild(opt);
  }
  sel.value = current;
  sel.addEventListener('change', () => {
    const url = new URL(window.location.href);
    url.searchParams.set('plan', sel.value);
    window.location.assign(url.toString());
  });
}

/**
 * The small-viewport notice dismisses to a body class, not to storage: CLAUDE.md §6
 * forbids localStorage, and a warning that has to be re-read on the next visit is the
 * correct behaviour for a warning about the device you are holding.
 */
function installViewportNotice(): void {
  const btn = document.getElementById('ts-dismiss');
  if (btn) btn.onclick = () => document.body.classList.add('ts-ok');
}

export function start(): void {
  installViewportNotice();
  const t0 = performance.now();
  const planId = planFromUrl();
  const S = new Session(loadDoc(planId));
  installPlanPicker(planId);
  let gr: RoomGraph = buildRoomGraph(S.doc, S.derived.grids);
  let br = bridges(gr);
  let ap = articulationPoints(gr);
  let bc = betweenness(gr);
  const meshes = buildSiteMeshes(S.doc, S.derived.grids);
  const bootMs = performance.now() - t0;

  const viewer = new Viewer($('view3d'), S.doc, S.derived.grids, meshes, S.derived.mpu);
  const hood = buildNeighbourhood(loadPack());
  viewer.scene.add(hood);

  const overlays = new Overlays(viewer.overlay, S.doc, meshes, S.derived.grids);
  const plan = new Plan2D($<HTMLCanvasElement>('plan'), S, gr);
  const brief = new Briefing(viewer, S.doc, S.derived.grids, S.derived.mpu, {
    wrap: $('briefing'), step: $('b-step'), title: $('b-title'), body: $('b-body'),
  });

  let selection: PlanSelection | null = null;
  /** Live reference the extracted panels read from; app.ts mutates it in place. */
  const A = { gr, br, ap, bc };

  // ------------------------------------------------------------------ refresh
  const rebuildAnalysis = (): void => {
    gr = buildRoomGraph(S.doc, S.derived.grids);
    br = bridges(gr);
    ap = articulationPoints(gr);
    bc = betweenness(gr);
    A.gr = gr; A.br = br; A.ap = ap; A.bc = bc;
    plan.bridgeKeys = br;
    plan.criticalRooms = ap;
    overlays.applyDoorRoles(gr, br);
    overlays.applyCriticalRooms(ap, gr);
    overlays.drawEntryMarkers(gr);
    overlays.drawMarkers(S.doc.briefing.markers);
    overlays.drawRoomLabels(gr);
  };

  const refresh = (): void => {
    const gate = statusGate(S.doc, S.derived.findings, new Set(S.accepted.keys()));

    viewer.mpu = S.derived.mpu;
    // Labels are sized against the plan scale, so the overlays learn it before the
    // next redraw; otherwise a recalibration leaves every chip stretched.
    overlays.mpu = S.derived.mpu;
    viewer.setGrids(S.doc, S.derived.grids);
    $('unscaled-banner').classList.toggle('on', S.derived.unscaled);

    $('badge-hash').textContent = `#${S.derived.hash} · boot ${bootMs.toFixed(0)} ms`;
    const bs = $('badge-scale');
    bs.textContent = `SCALE ${S.doc.scale.state}`;
    bs.className = 'badge ' + (S.derived.unscaled ? 'bad' : S.doc.scale.state === 'PROVISIONAL' ? 'warn' : 'good');
    const st = $('badge-status');
    st.textContent = S.doc.status;
    st.className = 'badge ' + (S.doc.status === 'LOCKED' ? 'good' : S.doc.status === 'TAMPERED' ? 'bad' : 'warn');

    $('scale').innerHTML = renderScale(S);
    $('scale-state').textContent = S.doc.scale.method ?? '';
    $('findings').innerHTML = renderFindings(S, S.derived.findings);
    $('gate-hint').textContent = renderGateHint(gate, S);
    $('params').innerHTML = renderParams(S);
    $('ops').innerHTML = renderOps(S);
    $('metrics').innerHTML = renderMetrics(S);
    $('chain-state').textContent = S.verifyChain() ? 'chain intact' : 'TAMPERED';

    // The uninterruptible walkthrough owns the camera while it plays, so nothing that
    // would take the camera or change the route may re-enable itself underneath it.
    const held = viewer.cinematicLocked;
    ($('btn-export') as HTMLButtonElement).disabled = !gate.exportAllowed;
    ($('btn-brief') as HTMLButtonElement).disabled = !gate.briefingAllowed || held;
    $('btn-brief').title = gate.briefingAllowed
      ? 'Step through the briefing'
      : 'Briefing requires a LOCKED document. Clear the gate first.';
    ($('btn-review') as HTMLButtonElement).disabled = !gate.canReachReviewed || S.doc.status !== 'DRAFT';
    ($('btn-lock') as HTMLButtonElement).disabled = S.doc.status !== 'REVIEWED';
    ($('btn-undo') as HTMLButtonElement).disabled = !S.canUndo;
    ($('btn-walk') as HTMLButtonElement).disabled = held;
    ($('btn-orbit') as HTMLButtonElement).disabled = held;

    scalePanel.rewire();
    wireFindings();
    plan.draw();
  };

  const scalePanel = installScalePanel(S, plan);

  S.on(() => { rebuildAnalysis(); refresh(); if (routing.currentRoute) routing.showRoute(); });

  // There is no persistence path by design (CLAUDE.md forbids localStorage). A refresh
  // mid-review would silently erase the whole op log with no way back.
  addEventListener('beforeunload', (e) => {
    if (S.ops.length === 0) return;
    e.preventDefault();
    e.returnValue = '';
  });

  // ------------------------------------------------------------------ findings
  function wireFindings(): void {
    $('findings').querySelectorAll<HTMLElement>('[data-f]').forEach((n) => {
      n.onclick = () => {
        const f = S.derived.findings.find((x) => x.id === n.dataset.f);
        if (!f || f.severity !== 'WARNING' || S.accepted.has(f.id)) return;
        const reason = prompt(`Accept "${f.check}"? Give the reason that goes in the audit log:`);
        if (!reason) return;
        S.do('ACCEPT_WARNING', [f.id], { finding_id: f.id, reason }, `accepted ${f.check}: ${reason}`);
      };
    });
  }

  $('btn-review').onclick = () => {
    const gate = statusGate(S.doc, S.derived.findings, new Set(S.accepted.keys()));
    if (S.doc.status !== 'DRAFT' || !gate.canReachReviewed) return;
    S.do('SET_STATUS', [], { status: 'REVIEWED' }, 'operator marked REVIEWED');
  };
  $('btn-lock').onclick = () => {
    if (S.doc.status !== 'REVIEWED') return;
    S.do('SET_STATUS', [], { status: 'LOCKED' }, 'operator locked the document');
  };
  $('btn-undo').onclick = () => S.undo();

  // ------------------------------------------------------------------ net badge
  const refreshNet = (): void => {
    const b = $('badge-net');
    b.textContent = health.sealed ? `SEALED · ${health.external} outbound` : `LEAK · ${health.external} outbound`;
    b.className = 'badge ' + (health.sealed ? 'good' : 'bad');
    const log = health.attempts.slice(-5).reverse();
    $('netlog').innerHTML =
      `<div class="kv"><span>Outbound sockets</span><b>${health.external}</b></div>` +
      `<div class="kv"><span>Loopback (own UI)</span><b>${health.loopback}</b></div>` +
      `<div class="kv"><span>Model, area pack</span><b>bundled at build</b></div>` +
      `<div class="kv"><span>Perception</span><b>DEFERRED — every element below is HUMAN origin</b></div>` +
      (log.length
        ? log.map((a) => `<div class="item"><div class="k">${a.api} · ${a.loopback ? 'loopback, allowed' : 'BLOCKED'}</div>${a.url.slice(0, 44)}</div>`).join('')
        : '<div class="empty">No network call has been attempted since start.</div>');
  };
  setInterval(refreshNet, 1000);
  setInterval(() => { $('badge-fps').textContent = `${viewer.fps.toFixed(0)} fps`; }, 500);

  // ------------------------------------------------------------------ storeys
  const tabs = $('storey-tabs');
  S.doc.storeys.forEach((st) => {
    const b = document.createElement('button');
    b.textContent = st.name;
    b.className = st.id === plan.storeyId ? 'on' : '';
    b.onclick = () => {
      plan.storeyId = st.id;
      plan.resetView();
      tabs.querySelectorAll('button').forEach((x) => x.classList.remove('on'));
      b.classList.add('on');
      plan.draw();
    };
    tabs.appendChild(b);
  });
  const syncTabs = (storeyId: string): void => {
    tabs.querySelectorAll('button').forEach((b, i) => b.classList.toggle('on', S.doc.storeys[i].id === storeyId));
  };

  // ------------------------------------------------------------------ routing
  const routing = installRouting(S, plan, overlays, A, viewer);
  // Mirrors the viewer's camera lock into the controls outside the tactical panel. The
  // viewer already refuses these commands while locked; disabling them is so the operator
  // can see that, rather than clicking a live-looking button that does nothing.
  routing.onPlaybackChange = (playing) => {
    for (const id of ['btn-brief', 'btn-walk', 'btn-orbit']) {
      ($(id) as HTMLButtonElement).disabled = playing;
    }
    if (!playing) refresh();
  };

  // ------------------------------------------------------------------ analysers
  /**
   * A long always-open list of bridges or critical rooms was most of what made the
   * right panel feel crowded — a rotunda-shaped plan alone puts nine bridges on
   * screen at once. Items beyond CAP get an `of-item` class the CSS hides by default;
   * a trailing toggle reveals them without a second render, so click handlers on the
   * items already in the DOM never need reattaching.
   */
  const CAP = 4;
  const withShowMore = (id: string, items: string[]): string => {
    if (items.length <= CAP) return items.join('');
    const shown = items.slice(0, CAP).join('');
    const hidden = items.slice(CAP).map((h) => h.replace('class="item', 'class="item of-item')).join('');
    return shown + hidden + `<button class="show-more" data-for="${id}">Show all ${items.length}</button>`;
  };

  const renderAnalysers = (): void => {
    const bridgeEdges = gr.edges.filter((e) => br.has(e.key));
    $('bridges').innerHTML = bridgeEdges.length
      ? withShowMore('bridges', bridgeEdges.map((e) => `<div class="item bridge" data-door="${e.opening_id ?? ''}" data-storey="${e.storey_id}">
          <b>${e.label}</b><br>${e.kind === 'STAIR' ? 'stairway — the only link between these floors' : 'the only door between these spaces'}
          <div class="tech">technical: ${e.kind === 'STAIR' ? e.stair_id : e.opening_id}</div></div>`))
      : '<div class="empty">No bridges. Every space has a second way in.</div>';
    $('bridges').querySelectorAll<HTMLElement>('[data-door]').forEach((n) => {
      n.onclick = () => {
        if (n.dataset.door) select({ kind: 'door', storeyId: n.dataset.storey!, id: n.dataset.door });
      };
    });

    const crit = [...ap].map((k) => gr.nodes.get(k)!).filter((n) => n && n.room_id);
    crit.sort((a, b) => (bc.get(b.key) ?? 0) - (bc.get(a.key) ?? 0));
    $('critical').innerHTML = crit.length
      ? withShowMore('critical', crit.map((n) => `<div class="item crit" data-room="${n.room_id}" data-storey="${n.storey_id}">
          <b>${n.name}</b><br>losing this room cuts off other spaces — ${gr.adj.get(n.key)!.length} doors
          <div class="tech">technical: betweenness ${(bc.get(n.key) ?? 0).toFixed(1)}</div></div>`))
      : '<div class="empty">No articulation points.</div>';
    $('critical').querySelectorAll<HTMLElement>('[data-room]').forEach((n) => {
      n.onclick = () => select({ kind: 'room', storeyId: n.dataset.storey!, id: n.dataset.room! });
    });

    for (const el of document.querySelectorAll<HTMLButtonElement>('.show-more')) {
      el.onclick = () => {
        const target = $(el.dataset.for!);
        const expanded = target.classList.toggle('expanded');
        el.textContent = expanded ? 'Show fewer' : el.dataset.label!;
      };
      if (!el.dataset.label) el.dataset.label = el.textContent!;
    }
  };

  // ------------------------------------------------------------------ selection
  function select(sel: PlanSelection, fly = false): void {
    selection = sel;
    plan.selection = sel;
    plan.storeyId = sel.storeyId;
    syncTabs(sel.storeyId);
    overlays.select(sel.kind, sel.storeyId, sel.id);
    $('selection').innerHTML = renderSelection(S, gr, br, ap, bc, sel.kind, sel.storeyId, sel.id);
    renderSelectionActions(sel);
    if (fly && viewer.mode === 'ORBIT') {
      const st = S.doc.storeys.find((x) => x.id === sel.storeyId)!;
      let p: THREE.Vector3 | null = null;
      if (sel.kind === 'room') {
        const n = gr.nodes.get(nodeKey(sel.storeyId, sel.id));
        if (n) p = new THREE.Vector3(n.centre_u[0] * viewer.mpu, st.elevation_m, n.centre_u[1] * viewer.mpu);
      } else {
        const e = gr.edges.find((x) => x.opening_id === sel.id);
        if (e) p = new THREE.Vector3(e.point_u[0] * viewer.mpu, st.elevation_m, e.point_u[1] * viewer.mpu);
      }
      if (p) viewer.flyTo(new THREE.Vector3(p.x - 6, p.y + 8, p.z - 8), p, 1100);
    }
    plan.draw();
  }

  function renderSelectionActions(sel: PlanSelection): void {
    const row = $('sel-actions');
    row.innerHTML = '';
    const add = (label: string, fn: () => void): void => {
      const b = document.createElement('button');
      b.textContent = label;
      b.onclick = fn;
      row.appendChild(b);
    };
    if (sel.kind === 'door') {
      const st = S.doc.storeys.find((x) => x.id === sel.storeyId)!;
      const o = st.openings.find((x) => x.id === sel.id)!;
      const w = st.walls.find((x) => x.id === o.wall_id)!;
      add(o.is_entry ? 'Unset entry' : 'Set as entry', () =>
        S.do('SET_ENTRY', [o.id], { on: !o.is_entry, label: 'Operator-marked entry', team: 'ALPHA' },
          `${o.is_entry ? 'cleared' : 'set'} entry on ${o.id}`));
      add(o.is_exit ? 'Unset exit' : 'Set as exit', () =>
        S.do('SET_EXIT', [o.id], { on: !o.is_exit, label: 'Operator-marked exit' },
          `${o.is_exit ? 'cleared' : 'set'} exit on ${o.id}`));
      add(w.breachable ? 'Not breachable' : 'Mark breachable', () => {
        const note = w.breachable ? '' : prompt('Why is this wall breachable? It goes in the log:') ?? '';
        if (!w.breachable && !note) return;
        S.do('SET_WALL_PROPS', [w.id], { breachable: !w.breachable, breach_note: note },
          `${w.breachable ? 'cleared' : 'set'} breachable on ${w.id}`);
      });
    } else {
      const n = gr.nodes.get(nodeKey(sel.storeyId, sel.id));
      add('Set as target', () => { routing.toSel.value = nodeKey(sel.storeyId, sel.id); routing.showRoute(); });
      add('Threat marker', () => {
        if (!n) return;
        const label = prompt('Marker label:', 'Suspect last seen') ?? '';
        S.do('ADD_MARKER', [`mk-${Date.now().toString(36)}`], {
          storey_id: sel.storeyId, x_u: n.centre_u[0], y_u: n.centre_u[1], z_m: 1.2,
          kind: 'THREAT', label,
        }, `threat marker in ${n.name}`);
      });
      add('Rename', () => {
        const name = prompt('Room name:', n?.name ?? '');
        if (name) S.do('SET_ROOM', [sel.id], { name }, `renamed room to ${name}`);
      });
    }
  }

  plan.onSelect = (s) => select(s, true);
  viewer.renderer.domElement.addEventListener('click', (e) => {
    if (viewer.mode === 'WALK') return;
    const ud = viewer.pick(e.clientX, e.clientY);
    if (!ud) return;
    if (ud.kind === 'room') select({ kind: 'room', storeyId: String(ud.storey), id: String(ud.room) });
    if (ud.kind === 'door') select({ kind: 'door', storeyId: String(ud.storey), id: String(ud.opening) });
  });

  // ------------------------------------------------------------------ toggles
  const toggle = (label: string, initial: boolean, fn: (v: boolean) => void): HTMLElement => {
    const wrap = document.createElement('label');
    wrap.className = 'toggle';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = initial;
    cb.onchange = () => fn(cb.checked);
    wrap.append(cb, document.createTextNode(label));
    return wrap;
  };
  const tg = $('toggles');
  S.doc.storeys.forEach((st) => tg.append(toggle(st.name, true, (v) => viewer.setStoreyVisible(st.id, v))));
  tg.append(toggle('Roof', false, (v) => viewer.setRoofVisible(v)));
  tg.append(toggle('Neighbourhood', true, (v) => { hood.visible = v; }));
  viewer.setRoofVisible(false);

  // ------------------------------------------------------------------ modes
  const setWalkUI = (walking: boolean): void => {
    $('btn-walk').classList.toggle('on', walking);
    $('btn-orbit').classList.toggle('on', !walking);
  };

  $('btn-walk').onclick = () => {
    setWalkUI(true);
    const entry = gr.edges.find((e) => e.is_entry);
    if (!entry) {
      viewer.enterWalk(10 * viewer.mpu, -6 * viewer.mpu, new THREE.Vector3(10 * viewer.mpu, 1.6, 0));
      return;
    }
    // The interior side of the entry edge tells us which way is "in": stand outside
    // the door along that line and look back at the room, whichever way the building
    // actually faces. A fixed world-space target only worked for one building.
    const insideKey = entry.a === OUTSIDE ? entry.b : entry.a;
    const inside = gr.nodes.get(insideKey);
    const [dx, dy] = entry.point_u;
    const ix = inside ? dx - inside.centre_u[0] : 0;
    const iy = inside ? dy - inside.centre_u[1] : -1;
    const len = Math.hypot(ix, iy) || 1;
    const nx = ix / len, ny = iy / len;
    const spawnX = dx + nx * 3.5, spawnY = dy + ny * 3.5;
    const lookX = inside ? inside.centre_u[0] : dx - nx * 3.5;
    const lookY = inside ? inside.centre_u[1] : dy - ny * 3.5;
    const target = new THREE.Vector3(lookX * viewer.mpu, 1.6, lookY * viewer.mpu);
    viewer.enterWalk(spawnX * viewer.mpu, spawnY * viewer.mpu, target);
  };
  $('btn-orbit').onclick = () => {
    setWalkUI(false);
    viewer.enterOrbit();
  };
  $('btn-labels').onclick = () => {
    const on = overlays.toggleRoomLabels(!$('btn-labels').classList.contains('on'));
    $('btn-labels').classList.toggle('on', on);
  };
  // Esc unlocks the pointer at the browser level even when we never asked for it
  // to. Without this the app was left thinking it was still in WALK mode: WASD kept
  // moving the (now static) camera and the Walkthrough button stayed lit.
  viewer.onWalkExit = () => setWalkUI(false);

  viewer.onRoomEnter = (roomId) => {
    if (!roomId) { $('hud-room').textContent = 'Exterior'; return; }
    for (const st of S.doc.storeys) {
      const r = st.rooms.find((x) => x.id === roomId);
      if (!r) continue;
      const key = nodeKey(st.id, r.id);
      $('hud-room').textContent = r.name + (ap.has(key) ? '  ·  CRITICAL ROOM' : '');
      plan.storeyId = st.id;
      syncTabs(st.id);
      break;
    }
  };
  setInterval(() => {
    if (viewer.mode !== 'WALK') return;
    const st = S.doc.storeys.reduce((a, b) =>
      Math.abs(b.elevation_m - (viewer.camera.position.y - 1.6)) <
      Math.abs(a.elevation_m - (viewer.camera.position.y - 1.6)) ? b : a);
    plan.player = { x: viewer.camera.position.x / viewer.mpu, y: viewer.camera.position.z / viewer.mpu, storeyId: st.id };
    plan.draw();
  }, 120);

  // ------------------------------------------------------------------ briefing + export
  installBriefingExport(S, brief, viewer, A, routing, refresh);

  // ------------------------------------------------------------------ boot
  rebuildAnalysis();
  routing.fillPickers();
  renderAnalysers();
  refresh();
  refreshNet();
  routing.showRoute();
  S.on(() => { routing.fillPickers(); renderAnalysers(); if (selection) {
    $('selection').innerHTML = renderSelection(S, gr, br, ap, bc, selection.kind, selection.storeyId, selection.id);
  } });
}
