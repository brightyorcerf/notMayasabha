/**
 * Briefing and export wiring: the LOCKED-gated briefing step-through, GLB export,
 * and the op-log export.
 *
 * Takes:   the session, the briefing player, the viewer, a live graph reference,
 *          and the routing state (briefing walks the last computed route).
 * Returns: nothing. It owns three buttons and one keyboard listener.
 * Assumes: `gate.briefingAllowed`/`exportAllowed` are re-checked here, not just used
 *          to disable the button — a disabled attribute is not access control.
 */

import { statusGate } from '../core/site';
import type { Session } from '../core/session';
import type { Viewer } from '../view3d/viewer';
import type { Briefing } from './briefing';
import type { Routing } from './routing';
import type { RoomGraph } from '../analysis/graph';
import { exportGLB } from './exportGlb';

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;

export interface BriefingGraphRef {
  gr: RoomGraph;
  br: Set<string>;
  ap: Set<string>;
}

export function installBriefingExport(
  S: Session, brief: Briefing, viewer: Viewer, ref: BriefingGraphRef, routing: Routing, refresh: () => void,
): void {
  $('btn-brief').onclick = () => {
    const gate = statusGate(S.doc, S.derived.findings, new Set(S.accepted.keys()));
    if (!gate.briefingAllowed) return;
    brief.mpu = viewer.mpu;
    brief.build(ref.gr, routing.currentRoute, routing.targetKey, ref.br, ref.ap);
    brief.start();
  };
  addEventListener('keydown', (e) => {
    if (!brief.active) return;
    if (e.key === 'ArrowRight' || e.key === ' ') { e.preventDefault(); brief.next(); }
    if (e.key === 'ArrowLeft') { e.preventDefault(); brief.prev(); }
    if (e.key === 'Escape') brief.stop();
  });

  $('btn-export').onclick = async () => {
    const gate = statusGate(S.doc, S.derived.findings, new Set(S.accepted.keys()));
    if (!gate.exportAllowed) return;
    const btn = $<HTMLButtonElement>('btn-export');
    btn.disabled = true;
    btn.textContent = 'Exporting…';
    try {
      const bytes = await exportGLB(viewer.world, `NotMayasabha-${S.doc.doc_id}-${S.derived.hash}.glb`);
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
}
