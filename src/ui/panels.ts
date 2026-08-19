/**
 * Panel renderers. HTML strings in, wiring callbacks out.
 *
 * Takes:   the session and the analyser results.
 * Returns: markup. These functions read state; they never write to the document.
 * Assumes: every write goes through Session.do, so a panel can only ask for an op.
 */

import type { Session } from '../core/session';
import type { Finding, StatusGate } from '../core/site';
import type { ScaleCheck } from '../core/types';
import { FACTOR_FIXES } from '../core/scale';
import type { RoomGraph } from '../analysis/graph';
import { isolationOf, nodeKey } from '../analysis/graph';

export function renderScale(s: Session): string {
  const sc = s.doc.scale;
  const d = s.derived;
  const rows: string[] = [];
  rows.push(`<div class="kv"><span>State</span><b class="${d.unscaled ? 'v-bad' : sc.state === 'PROVISIONAL' ? 'v-warn' : 'v-ok'}">${sc.state}</b></div>`);
  rows.push(`<div class="kv"><span>Metres per unit</span><b>${sc.meters_per_unit === null ? 'REFUSED' : sc.meters_per_unit.toPrecision(6)}</b></div>`);
  rows.push(`<div class="kv"><span>Method</span><b>${sc.method ?? '—'}</b></div>`);
  if (d.unscaled) {
    rows.push(
      `<div class="empty">Rendering at a display-only ratio derived from the median door ` +
      `(0.9 m assumed). It is never written to the model. Areas and export stay disabled ` +
      `until a real scale is set.</div>`,
    );
  }
  for (const c of d.checks) {
    const cls = c.result === 'PASS' ? 'v-ok' : c.result === 'WARN' ? 'v-warn' : 'v-bad';
    rows.push(
      `<div class="kv"><span>${c.name.replace(/_/g, ' ').toLowerCase()}</span>` +
      `<b class="${cls}">${c.measured.toFixed(2)} ${c.result}</b></div>`,
    );
  }
  const failing = d.checks.some((c: ScaleCheck) => c.result === 'FAIL');
  rows.push('<div class="row wrap">');
  rows.push('<button id="btn-calibrate">Calibrate (2 clicks)</button>');
  rows.push('<button id="btn-clear-scale">Clear scale</button>');
  rows.push('</div>');
  if (failing || d.unscaled) {
    rows.push('<div class="hint pad">Common factor errors — one click, one SET_SCALE op, no geometry touched:</div>');
    rows.push('<div class="row wrap">');
    FACTOR_FIXES.forEach((f, i) => rows.push(`<button class="tiny" data-fix="${i}">${f.label}</button>`));
    rows.push('</div>');
  }
  return rows.join('');
}

export function renderFindings(s: Session, findings: Finding[]): string {
  if (findings.length === 0) {
    return '<div class="empty">No findings. Every check passed on this model.</div>';
  }
  return findings
    .map((f) => {
      const acc = s.accepted.has(f.id);
      const cls = f.severity.toLowerCase() + (acc ? ' accepted' : '');
      const tail = acc
        ? `<div class="k">accepted — ${s.accepted.get(f.id)}</div>`
        : f.severity === 'WARNING'
          ? '<div class="k">click to accept with a reason</div>'
          : '';
      return `<div class="item ${cls}" data-f="${f.id}">
        <div class="k">${f.severity} · ${f.check}</div>${f.message}${tail}</div>`;
    })
    .join('');
}

export function renderGateHint(gate: StatusGate, s: Session): string {
  if (gate.blocking.length) return `${gate.blocking.length} blocking`;
  if (gate.unaccepted.length) return `${gate.unaccepted.length} unaccepted`;
  return s.doc.status;
}

export function renderOps(s: Session): string {
  if (s.ops.length === 0) {
    return '<div class="empty">No operator action yet. Every edit lands here, in order, with a hash of the document it was applied to.</div>';
  }
  return [...s.ops]
    .reverse()
    .slice(0, 24)
    .map(
      (o) => `<div class="item">
        <div class="k">#${o.seq} · ${o.kind} · ${(o.dt_ms / 1000).toFixed(1)} s · prev ${o.prev_hash}</div>
        ${o.label}</div>`,
    )
    .join('');
}

export function renderMetrics(s: Session): string {
  const m = s.metrics;
  return (
    `<div class="kv"><span>Elements (walls + openings)</span><b>${m.elements}</b></div>` +
    `<div class="kv"><span>Human-verified</span><b>${(m.verified_fraction * 100).toFixed(0)} %</b></div>` +
    `<div class="kv"><span>Operations logged</span><b>${m.total_ops}</b></div>` +
    `<div class="kv"><span>Corrective ops</span><b>${m.corrective_ops}</b></div>` +
    `<div class="kv"><span>Correction density</span><b>${m.correction_density.toFixed(3)}</b></div>` +
    `<div class="kv"><span>Median time per op</span><b>${m.median_dt_s.toFixed(1)} s</b></div>` +
    `<div class="hint pad">Corrective ops only. Accepts and status changes are excluded, ` +
    `so the number cannot fall simply because the operator clicked accept more often. ` +
    `Times are clamped at 30 s per op.</div>`
  );
}

export function renderSelection(
  s: Session, gr: RoomGraph, bridgesSet: Set<string>, ap: Set<string>,
  bc: Map<string, number>, kind: 'room' | 'door', storeyId: string, id: string,
): string {
  const st = s.doc.storeys.find((x) => x.id === storeyId)!;
  const mpu = s.derived.mpu;
  const un = s.derived.unscaled;
  const m = (v: number, unit = 'm'): string => (un ? '—' : `${v.toFixed(2)} ${unit}`);

  if (kind === 'room') {
    const r = st.rooms.find((x) => x.id === id)!;
    const idx = st.rooms.indexOf(r);
    const key = nodeKey(storeyId, id);
    const n = gr.nodes.get(key);
    const area = s.derived.grids.get(st.id)!.areas_u2[idx] * mpu * mpu;
    const nbrs = n ? gr.adj.get(key)!.map((a) => gr.nodes.get(a.to)!.name) : [];
    return (
      `<b>${r.name}</b><br>${r.use} · ${st.name}<br>` +
      `area: ${un ? 'UNAVAILABLE (unscaled)' : `${area.toFixed(1)} m²`}<br>` +
      `doors: ${n ? gr.adj.get(key)!.length : 0}` +
      `${ap.has(key) ? ' · <b class="v-crit">CRITICAL ROOM — cuts off other spaces if lost</b>' : ''}<br>` +
      `adjacent: ${nbrs.join(', ') || '—'}<br>` +
      `<div class="tech">technical: betweenness ${(bc.get(key) ?? 0).toFixed(1)} · ` +
      `confidence ${r.confidence.toFixed(2)} · origin ${r.origin} · ` +
      `${r.verified ? 'verified' : 'NOT VERIFIED'}</div>`
    );
  }

  const o = st.openings.find((x) => x.id === id)!;
  const w = st.walls.find((x) => x.id === o.wall_id)!;
  const e = gr.edges.find((x) => x.opening_id === o.id);
  const iso = e ? isolationOf(gr, e.key) : [];
  return (
    `<b>${e ? e.label : `${o.kind} (connects nothing)`}</b><br>` +
    `width ${m(o.width_u * mpu)} · head ${o.head_m} m · swing ${o.swing}<br>` +
    `${e && bridgesSet.has(e.key) ? '<b class="v-bad">ONLY WAY IN — critical door</b><br>' : ''}` +
    `${e && iso.length ? `sealing it isolates <b>${iso.length}</b> space(s): ` +
      `${iso.slice(0, 4).map((k) => gr.nodes.get(k)!.name).join(', ')}<br>` : ''}` +
    `breachable: <b>${w.breachable ? 'yes' : 'no'}</b>` +
    `${w.breach_origin ? ` <span class="k">(${w.breach_origin.toLowerCase()} judgement)</span>` : ''}<br>` +
    `${w.breach_note ? `<span class="k">${w.breach_note}</span><br>` : ''}` +
    `<div class="tech">technical: ${o.id} · host wall ${w.id} · ${m(w.thickness_u * mpu)} · ${w.wall_class} · ` +
    `confidence ${o.confidence.toFixed(2)} · origin ${o.origin} · ` +
    `${o.verified ? 'verified' : 'NOT VERIFIED'}</div>`
  );
}

export function renderParams(s: Session): string {
  const p = s.doc.manual_parameters;
  const d = s.doc.defaults;
  const st = s.doc.stairs[0];
  return (
    `<div class="kv"><span>Length</span><b>${p.length_u} u</b></div>` +
    `<div class="kv"><span>Breadth</span><b>${p.breadth_u} u</b></div>` +
    `<div class="kv"><span>Storey height</span><b>${p.storey_height_m} m</b></div>` +
    `<div class="kv"><span>Staircases</span><b>${p.stair_count}</b></div>` +
    (st
      ? `<div class="kv"><span>Stair</span><b>${st.kind} · ${st.step_count} steps · ` +
        `${st.riser_m} m riser</b></div>`
      : '') +
    `<div class="kv"><span>Entry / exit</span><b>${s.doc.briefing.entry_points.length} / ` +
    `${s.doc.briefing.exit_points.length}</b></div>` +
    `<div class="kv"><span>Exterior wall</span><b>${d.ext_wall_thickness_u} u ` +
    `<span class="src">default</span></b></div>` +
    `<div class="kv"><span>Interior wall</span><b>${d.int_wall_thickness_u} u ` +
    `<span class="src">default</span></b></div>` +
    `<div class="hint pad">Every dimension carries its source. Values marked ` +
    `<span class="src">default</span> are assumptions, not measurements.</div>`
  );
}
