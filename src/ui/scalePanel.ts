/**
 * Scale panel wiring: calibration clicks, factor-fix buttons, clear scale.
 *
 * Takes:   the session and the 2D plan (calibration clicks arrive through it).
 * Returns: a `rewire` function the caller re-runs after every innerHTML replace,
 *          since fresh DOM nodes need fresh listeners.
 * Assumes: every write goes through Session.do. This module never touches the document.
 */

import type { Session } from '../core/session';
import type { Plan2D } from '../view2d/plan';
import { unscaledRecord, calibrationMpu, runChecks, stateFromChecks, FACTOR_FIXES } from '../core/scale';
import type { ScaleRecord } from '../core/types';

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;

export interface ScalePanel {
  /** Re-bind the buttons the last innerHTML render replaced. Call after every refresh. */
  rewire: () => void;
}

export function installScalePanel(S: Session, plan: Plan2D): ScalePanel {
  let calibrating: Array<[number, number]> = [];

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

  function rewire(): void {
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

  return { rewire };
}
