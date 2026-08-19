/**
 * Application wiring. The only module that touches the DOM and the viewer together.
 *
 * Takes:   nothing. It loads the bundled document at start.
 * Returns: nothing. It owns the UI event graph.
 * Assumes: every write goes through Session.do. Everything below this file is pure
 *          and testable without a browser (see tools/smoke.ts).
 */

import * as THREE from 'three';
import { loadDoc, statusGate } from '../core/site';
import { Session } from '../core/session';
import { unscaledRecord, calibrationMpu, runChecks, stateFromChecks } from '../core/scale';
import { health } from '../core/netguard';
import { FACTOR_FIXES } from '../core/scale';
import { buildSiteMeshes } from '../geometry/build3d';
import {
  buildRoomGraph, bridges, articulationPoints, route as findRoute, betweenness,
  OUTSIDE, nodeKey, type Route, type RoomGraph,
} from '../analysis/graph';
import { Viewer } from '../view3d/viewer';
import { Overlays } from '../view3d/overlays';
import { Plan2D, type PlanSelection } from '../view2d/plan';
import { loadPack, buildNeighbourhood } from '../geo/neighbourhood';
import { Briefing } from './briefing';
import { exportGLB } from './exportGlb';
import {
  renderScale, renderFindings, renderGateHint, renderOps, renderMetrics,
  renderSelection, renderParams,
} from './panels';
import type { ScaleRecord } from '../core/types';

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;

export function start(): void {
  const t0 = performance.now();
  const S = new Session(loadDoc());
  let gr: RoomGraph = buildRoomGraph(S.doc, S.derived.grids);
  let br = bridges(gr);
  let ap = articulationPoints(gr);
  let bc = betweenness(gr);
  const meshes = buildSiteMeshes(S.doc, S.derived.grids);
  const bootMs = performance.now() - t0;

  const viewer = new Viewer($('view3d'), S.doc, S.derived.grids, meshes, S.derived.mpu);
  const hood = buildNeighbourhood(loadPack());
  viewer.scene.add(hood);

  const overlays = new Overlays(viewer.overlay, S.doc, meshes);
  const plan = new Plan2D($<HTMLCanvasElement>('plan'), S, gr);
  const brief = new Briefing(viewer, S.doc, S.derived.mpu, {
    wrap: $('briefing'), step: $('b-step'), title: $('b-title'), body: $('b-body'),
  });

  let currentRoute: Route | null = null;
  let targetKey: string | null = null;
  let selection: PlanSelection | null = null;
  /** Two-click calibration state. */
  let calibrating: Array<[number, number]> = [];

  // ------------------------------------------------------------------ refresh
  const rebuildAnalysis = (): void => {
    gr = buildRoomGraph(S.doc, S.derived.grids);
    br = bridges(gr);
    ap = articulationPoints(gr);
    bc = betweenness(gr);
    plan.bridgeKeys = br;
    plan.criticalRooms = ap;
    overlays.applyDoorRoles(gr, br);
    overlays.applyCriticalRooms(ap, gr);
    overlays.drawEntryMarkers(gr);
    overlays.drawMarkers(S.doc.briefing.markers);
  };

  const refresh = (): void => {
    const gate = statusGate(S.doc, S.derived.findings, new Set(S.accepted.keys()));

    viewer.mpu = S.derived.mpu;
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

    ($('btn-export') as HTMLButtonElement).disabled = !gate.exportAllowed;
    ($('btn-brief') as HTMLButtonElement).disabled = !gate.briefingAllowed;
    $('btn-brief').title = gate.briefingAllowed
      ? 'Step through the briefing'
      : 'Briefing requires a LOCKED document. Clear the gate first.';
    ($('btn-review') as HTMLButtonElement).disabled = !gate.canReachReviewed || S.doc.status !== 'DRAFT';
    ($('btn-lock') as HTMLButtonElement).disabled = S.doc.status !== 'REVIEWED';
    ($('btn-undo') as HTMLButtonElement).disabled = !S.canUndo;

    wireScalePanel();
    wireFindings();
    plan.draw();
  };

  S.on(() => { rebuildAnalysis(); refresh(); if (currentRoute) showRoute(); });

  // ------------------------------------------------------------------ scale
  const scaleRecord = (mpu: number, p0: [number, number], p1: [number, number], real: number): ScaleRecord => {
    const rec: ScaleRecord = {
      state: 'VALIDATED',
      meters_per_unit: mpu,
      method: 'CALIBRATION_SEGMENT',
      calibration: { p0, p1, real_length_m: real },
      checks: [],
      evidence: [{ text: `${real} m`, unit: 'm', measured_u: Math.hypot(p1[0] - p0[0], p1[1] - p0[1]), mpu }],
      dispersion: 0,
      confidence: 0.95,
      set_by: 'USER',
      set_at: new Date().toISOString(),
    };
    rec.checks = runChecks(S.doc, S.derived.grids, mpu);
    rec.state = stateFromChecks(mpu, rec.checks);
    return rec;
  };

  function wireScalePanel(): void {
    const cal = document.getElementById('btn-calibrate');
    if (cal) {
      cal.onclick = () => {
        calibrating = [];
        plan.calibrating = true;
        $('plan-mode').innerHTML =
          '<div class="mode">CALIBRATE — click the two ends of a run you know the real length of.</div>';
        plan.draw();
      };
    }
    const clr = document.getElementById('btn-clear-scale');
    if (clr) {
      clr.onclick = () =>
        S.do('CLEAR_SCALE', [], { scale: unscaledRecord(new Date().toISOString()) },
          'operator cleared the scale');
    }
    document.querySelectorAll<HTMLElement>('[data-fix]').forEach((n) => {
      n.onclick = () => {
        const f = FACTOR_FIXES[Number(n.dataset.fix)];
        const base = S.doc.scale.meters_per_unit ?? S.derived.mpu;
        const mpu = base * f.factor;
        const cal2 = S.doc.scale.calibration;
        const rec = scaleRecord(
          mpu,
          cal2?.p0 ?? [0, 0],
          cal2?.p1 ?? [1, 0],
          (cal2?.real_length_m ?? 1) * f.factor,
        );
        rec.method = S.doc.scale.method ?? 'MANUAL_BBOX';
        S.do('SET_SCALE', [], { scale: rec }, `factor fix ${f.label}`);
      };
    });
  }

  plan.onCalibrationPoint = (x, y) => {
    calibrating.push([x, y]);
    if (calibrating.length < 2) {
      $('plan-mode').innerHTML = '<div class="mode">CALIBRATE — now click the second point.</div>';
      return;
    }
    const [p0, p1] = calibrating as [[number, number], [number, number]];
    plan.calibrating = false;
    $('plan-mode').innerHTML =
      `<div class="mode">Real length of that run, in metres:
        <input id="cal-len" type="number" step="0.01" value="20" />
        <button id="cal-ok">Set scale</button></div>`;
    $('cal-ok').onclick = () => {
      const real = Number(($('cal-len') as HTMLInputElement).value);
      const mpu = calibrationMpu(p0, p1, real);
      $('plan-mode').innerHTML = '';
      if (mpu === null) return;
      S.do('SET_SCALE', [], { scale: scaleRecord(mpu, p0, p1, real) },
        `calibration segment, ${real} m`);
    };
  };

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

  $('btn-review').onclick = () => S.do('SET_STATUS', [], { status: 'REVIEWED' }, 'operator marked REVIEWED');
  $('btn-lock').onclick = () => S.do('SET_STATUS', [], { status: 'LOCKED' }, 'operator locked the document');
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
  const fromSel = $<HTMLSelectElement>('sel-from');
  const toSel = $<HTMLSelectElement>('sel-to');
  const fillPickers = (): void => {
    const opts = [...gr.nodes.values()]
      .map((n) => `<option value="${n.key}">${n.key === OUTSIDE ? 'Exterior (entry point)' : `L${n.level} · ${n.name}`}</option>`)
      .join('');
    const a = fromSel.value, b = toSel.value;
    fromSel.innerHTML = opts;
    toSel.innerHTML = opts;
    fromSel.value = a || OUTSIDE;
    const server = [...gr.nodes.values()].find((n) => n.name === 'Server Room');
    toSel.value = b || (server ? server.key : [...gr.nodes.keys()][1]);
  };

  function showRoute(): void {
    const r = findRoute(gr, fromSel.value, toSel.value);
    currentRoute = r;
    targetKey = toSel.value;
    plan.route = r;
    plan.targetKey = targetKey;
    overlays.markTarget(gr, targetKey);
    if (r) {
      overlays.drawRoute(gr, r);
      $('route-out').innerHTML =
        `<div class="route-hdr">${r.doors} doors · ${r.nodes.length} spaces</div>` +
        r.nodes.map((k, i) => {
          const n = gr.nodes.get(k)!;
          const e = r.edges[i - 1];
          const via = e
            ? ` <span class="k">via ${e.kind === 'STAIR' ? 'stair' : e.opening_id}${br.has(e.key) ? ' · BRIDGE' : ''}</span>`
            : '';
          return `<div class="route-line"><span class="step">${String(i + 1).padStart(2, '0')}</span> ${n.name}${via}</div>`;
        }).join('');
    } else {
      overlays.clearRoute();
      $('route-out').innerHTML = '<div class="empty">No route. The graph is disconnected between those two spaces.</div>';
    }
    plan.draw();
  }
  $('btn-route').onclick = showRoute;
  fromSel.onchange = showRoute;
  toSel.onchange = showRoute;

  $('btn-save-route').onclick = () => {
    if (!currentRoute) return;
    const legs = new Map<string, Array<[number, number]>>();
    for (let i = 0; i < currentRoute.nodes.length; i++) {
      const n = gr.nodes.get(currentRoute.nodes[i]);
      if (n?.room_id) {
        const arr = legs.get(n.storey_id) ?? [];
        arr.push(n.centre_u);
        legs.set(n.storey_id, arr);
      }
      const e = currentRoute.edges[i];
      if (e) {
        const arr = legs.get(e.storey_id) ?? [];
        arr.push(e.point_u);
        legs.set(e.storey_id, arr);
      }
    }
    const to = gr.nodes.get(toSel.value)!;
    S.do('ADD_ROUTE', [`route-${toSel.value}`], {
      name: `Entry to ${to.name}`, team: 'ALPHA', color: '#00e5ff',
      from_key: fromSel.value, to_key: toSel.value,
      legs: [...legs].map(([storey_id, points_u]) => ({ storey_id, points_u })),
    }, `saved route: entry to ${to.name}`);
  };

  // ------------------------------------------------------------------ analysers
  const renderAnalysers = (): void => {
    const bridgeEdges = gr.edges.filter((e) => br.has(e.key));
    $('bridges').innerHTML = bridgeEdges.length
      ? bridgeEdges.map((e) => `<div class="item bridge" data-door="${e.opening_id ?? ''}" data-storey="${e.storey_id}">
          <div class="k">${e.kind === 'STAIR' ? 'STAIR' : e.opening_id}</div>${e.label}</div>`).join('')
      : '<div class="empty">No bridges. Every space has a second way in.</div>';
    $('bridges').querySelectorAll<HTMLElement>('[data-door]').forEach((n) => {
      n.onclick = () => {
        if (n.dataset.door) select({ kind: 'door', storeyId: n.dataset.storey!, id: n.dataset.door });
      };
    });

    const crit = [...ap].map((k) => gr.nodes.get(k)!).filter((n) => n && n.room_id);
    crit.sort((a, b) => (bc.get(b.key) ?? 0) - (bc.get(a.key) ?? 0));
    $('critical').innerHTML = crit.length
      ? crit.map((n) => `<div class="item crit" data-room="${n.room_id}" data-storey="${n.storey_id}">
          <div class="k">betweenness ${(bc.get(n.key) ?? 0).toFixed(1)} · ${gr.adj.get(n.key)!.length} doors</div>${n.name}</div>`).join('')
      : '<div class="empty">No articulation points.</div>';
    $('critical').querySelectorAll<HTMLElement>('[data-room]').forEach((n) => {
      n.onclick = () => select({ kind: 'room', storeyId: n.dataset.storey!, id: n.dataset.room! });
    });
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
      add('Set as target', () => { toSel.value = nodeKey(sel.storeyId, sel.id); showRoute(); });
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
  $('btn-walk').onclick = () => {
    $('btn-walk').classList.add('on');
    $('btn-orbit').classList.remove('on');
    const entry = gr.edges.find((e) => e.is_entry);
    const target = new THREE.Vector3(10 * viewer.mpu, 1.6, 6 * viewer.mpu);
    if (entry) viewer.enterWalk(entry.point_u[0] * viewer.mpu, (entry.point_u[1] - 3.5) * viewer.mpu, target);
    else viewer.enterWalk(10 * viewer.mpu, -6 * viewer.mpu, target);
  };
  $('btn-orbit').onclick = () => {
    $('btn-orbit').classList.add('on');
    $('btn-walk').classList.remove('on');
    viewer.enterOrbit();
  };

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

  // ------------------------------------------------------------------ briefing
  $('btn-brief').onclick = () => {
    brief.mpu = viewer.mpu;
    brief.build(gr, currentRoute, targetKey, br, ap);
    brief.start();
  };
  addEventListener('keydown', (e) => {
    if (!brief.active) return;
    if (e.key === 'ArrowRight' || e.key === ' ') { e.preventDefault(); brief.next(); }
    if (e.key === 'ArrowLeft') { e.preventDefault(); brief.prev(); }
    if (e.key === 'Escape') brief.stop();
  });

  // ------------------------------------------------------------------ export
  $('btn-export').onclick = async () => {
    const gate = statusGate(S.doc, S.derived.findings, new Set(S.accepted.keys()));
    if (!gate.exportAllowed) return;
    const btn = $<HTMLButtonElement>('btn-export');
    btn.disabled = true;
    btn.textContent = 'Exporting…';
    try {
      const bytes = await exportGLB(viewer.world, `trinetra-${S.doc.doc_id}-${S.derived.hash}.glb`);
      btn.textContent = `GLB ${(bytes / 1e6).toFixed(1)} MB`;
    } catch (err) {
      btn.textContent = 'Export failed';
      console.error(err);
    }
    setTimeout(() => { btn.textContent = 'Export GLB'; refresh(); }, 2500);
  };

  $('btn-export-ops').onclick = () => {
    const blob = new Blob([S.opsJsonl], { type: 'application/x-ndjson' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ops-${S.doc.doc_id}.jsonl`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  };

  // ------------------------------------------------------------------ boot
  rebuildAnalysis();
  fillPickers();
  renderAnalysers();
  refresh();
  refreshNet();
  showRoute();
  S.on(() => { fillPickers(); renderAnalysers(); if (selection) {
    $('selection').innerHTML = renderSelection(S, gr, br, ap, bc, selection.kind, selection.storeyId, selection.id);
  } });
}
