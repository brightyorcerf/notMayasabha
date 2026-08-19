/**
 * The op log. ARCHITECTURE-v2 §2.4, with freeze patch 10 applied:
 * no Op.inverse — undo is a rolling cache of the last 50 document states.
 * `prev_hash` does the other job: tamper evidence.
 *
 * Takes:   a SiteDocument and a typed Op.
 * Returns: a new SiteDocument. `apply` is pure; the Session owns the history.
 * Assumes: replay is authoritative, site.json is a checkpoint. Only an Op writes
 *          to the document (invariant I1). Nothing else mutates it, anywhere.
 */

import type { SiteDocument, MarkerKind, ScaleRecord } from './types';

export type OpKind =
  | 'SET_SCALE' | 'CLEAR_SCALE'
  | 'SET_WALL_PROPS' | 'SET_ROOM'
  | 'SET_ENTRY' | 'SET_EXIT'
  | 'ADD_MARKER' | 'DELETE_MARKER'
  | 'ADD_ROUTE'
  | 'ACCEPT_WARNING'
  | 'SET_STATUS';

/** Corrective ops change geometry or semantics. Accepts and status changes do not. */
export const CORRECTIVE: ReadonlySet<OpKind> = new Set<OpKind>([
  'SET_SCALE', 'CLEAR_SCALE', 'SET_WALL_PROPS', 'SET_ROOM', 'SET_ENTRY', 'SET_EXIT',
]);

export interface Op {
  seq: number;
  ts: string;
  actor: 'USER' | 'SYSTEM';
  kind: OpKind;
  targets: string[];
  payload: Record<string, unknown>;
  /** Hash of the document before this op. Tamper evidence, not undo. */
  prev_hash: string;
  /** Time the operator spent on this op, clamped at 30 s so a coffee break cannot skew it. */
  dt_ms: number;
  label: string;
}

const clone = (d: SiteDocument): SiteDocument => JSON.parse(JSON.stringify(d)) as SiteDocument;

export function apply(doc: SiteDocument, op: Op): SiteDocument {
  const d = clone(doc);
  d.modified_utc = op.ts;
  const P = op.payload;

  switch (op.kind) {
    case 'SET_SCALE': {
      d.scale = P.scale as ScaleRecord;
      break;
    }
    case 'CLEAR_SCALE': {
      d.scale = P.scale as ScaleRecord;
      break;
    }
    case 'SET_WALL_PROPS': {
      for (const st of d.storeys) {
        const w = st.walls.find((x) => x.id === op.targets[0]);
        if (!w) continue;
        if (typeof P.breachable === 'boolean') {
          w.breachable = P.breachable;
          w.breach_origin = P.breachable ? 'HUMAN' : null;
          w.breach_note = String(P.breach_note ?? '');
        }
        w.verified = true;
        w.origin = 'HUMAN';
      }
      break;
    }
    case 'SET_ROOM': {
      for (const st of d.storeys) {
        const r = st.rooms.find((x) => x.id === op.targets[0]);
        if (!r) continue;
        if (typeof P.name === 'string') r.name = P.name;
        r.verified = true;
        r.origin = 'HUMAN';
      }
      break;
    }
    case 'SET_ENTRY':
    case 'SET_EXIT': {
      const isEntry = op.kind === 'SET_ENTRY';
      for (const st of d.storeys) {
        const o = st.openings.find((x) => x.id === op.targets[0]);
        if (!o) continue;
        const on = P.on !== false;
        if (isEntry) o.is_entry = on; else o.is_exit = on;
        o.verified = true;
        o.origin = 'HUMAN';
        const list = isEntry ? d.briefing.entry_points : d.briefing.exit_points;
        const at = list.findIndex((e) => e.opening_id === o.id);
        if (on && at < 0) {
          if (isEntry) {
            d.briefing.entry_points.push({
              opening_id: o.id, label: String(P.label ?? 'Entry'), assigned_team: String(P.team ?? ''),
            });
          } else {
            d.briefing.exit_points.push({ opening_id: o.id, label: String(P.label ?? 'Exit') });
          }
        }
        if (!on && at >= 0) list.splice(at, 1);
      }
      break;
    }
    case 'ADD_MARKER': {
      d.briefing.markers.push({
        id: op.targets[0],
        storey_id: String(P.storey_id),
        x_u: Number(P.x_u), y_u: Number(P.y_u), z_m: Number(P.z_m ?? 1.2),
        kind: P.kind as MarkerKind,
        label: String(P.label ?? ''),
        notes: String(P.notes ?? ''),
      });
      break;
    }
    case 'DELETE_MARKER': {
      d.briefing.markers = d.briefing.markers.filter((m) => m.id !== op.targets[0]);
      break;
    }
    case 'ADD_ROUTE': {
      d.briefing.routes = d.briefing.routes.filter((r) => r.id !== op.targets[0]);
      d.briefing.routes.push({
        id: op.targets[0],
        name: String(P.name ?? 'Route'),
        team: String(P.team ?? 'ALPHA'),
        color: String(P.color ?? '#00e5ff'),
        from_key: String(P.from_key ?? ''),
        to_key: String(P.to_key ?? ''),
        legs: (P.legs ?? []) as Array<{ storey_id: string; points_u: Array<[number, number]> }>,
      });
      break;
    }
    case 'ACCEPT_WARNING': {
      // Accepted warnings live in the log, not in the geometry. Nothing to change here.
      break;
    }
    case 'SET_STATUS': {
      d.status = P.status as SiteDocument['status'];
      for (const st of d.storeys) st.status = (P.status === 'TAMPERED' ? 'DRAFT' : P.status) as Storey_status;
      break;
    }
  }
  return d;
}

type Storey_status = 'DRAFT' | 'REVIEWED' | 'LOCKED';

export interface Metrics {
  total_ops: number;
  corrective_ops: number;
  /** Corrective ops per geometric element. Named correction density, not HCI. */
  correction_density: number;
  /** Median seconds per op, clamped. */
  median_dt_s: number;
  elements: number;
  verified_elements: number;
  verified_fraction: number;
  by_kind: Record<string, number>;
}

export function metrics(doc: SiteDocument, ops: Op[]): Metrics {
  let elements = 0, verified = 0;
  for (const st of doc.storeys) {
    for (const w of st.walls) { elements++; if (w.verified) verified++; }
    for (const o of st.openings) { elements++; if (o.verified) verified++; }
  }
  const corrective = ops.filter((o) => CORRECTIVE.has(o.kind));
  const dts = ops.map((o) => Math.min(o.dt_ms, 30_000)).sort((a, b) => a - b);
  const by_kind: Record<string, number> = {};
  for (const o of ops) by_kind[o.kind] = (by_kind[o.kind] ?? 0) + 1;
  return {
    total_ops: ops.length,
    corrective_ops: corrective.length,
    correction_density: elements ? corrective.length / elements : 0,
    median_dt_s: dts.length ? dts[dts.length >> 1] / 1000 : 0,
    elements,
    verified_elements: verified,
    verified_fraction: elements ? verified / elements : 0,
    by_kind,
  };
}

/** The log serialised the way it is stored on disk: one JSON object per line. */
export function toJsonl(ops: Op[]): string {
  return ops.map((o) => JSON.stringify(o)).join('\n') + (ops.length ? '\n' : '');
}
