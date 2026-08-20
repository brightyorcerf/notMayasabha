/**
 * Boot-sequence wiring. The DOM half of the assembly animation.
 *
 * Takes:   the viewer, its meshes, the neighbourhood group and the document to count.
 * Returns: an object with one method, `start()`, which the app calls last.
 * Assumes: purely presentational. `?boot=0` and a reduced-motion preference skip it
 *          entirely, so nothing downstream may depend on the sequence having run. It
 *          never touches the Session and appends no ops.
 */

import * as THREE from 'three';
import { Assembly, type Phase } from '../view3d/assembly';
import type { Viewer } from '../view3d/viewer';
import type { SiteMeshes } from '../geometry/build3d';
import type { SiteDocument } from '../core/types';

const $ = <T extends HTMLElement = HTMLElement>(id: string): T =>
  document.getElementById(id) as T;

export interface BootSequence {
  /** Play it, or drop straight to the finished state if motion is unwanted. */
  start(): void;
  /** True while the sequence owns the camera. Picking is suppressed against this. */
  readonly playing: boolean;
}

/** Restart a CSS animation on an element that already carries the class. */
function replay(el: HTMLElement): void {
  el.classList.remove('in');
  // A layout read between the two writes; without it the browser coalesces them and
  // the animation never restarts.
  void el.offsetWidth;
  el.classList.add('in');
}

export function installBootSequence(
  viewer: Viewer,
  meshes: SiteMeshes,
  hood: THREE.Object3D | null,
  doc: SiteDocument,
  refresh: () => void,
): BootSequence {
  const sum = (f: (st: SiteDocument['storeys'][number]) => number): number =>
    doc.storeys.reduce((n, st) => n + f(st), 0);

  const assembly = new Assembly(
    viewer,
    meshes,
    hood,
    {
      walls: sum((st) => st.walls.length),
      openings: sum((st) => st.openings.length),
      rooms: sum((st) => st.rooms.length),
      storeys: doc.storeys.length,
    },
    {
      onPhase: (ph: Phase) => {
        const label = $('a-label'), detail = $('a-detail');
        label.textContent = ph.label;
        detail.textContent = ph.detail;
        replay(label);
        replay(detail);
        // The chrome arrives on the last phase, overlapping the camera settling. The
        // two motions reading as one is the whole point of the stagger.
        if (ph.index === 4) {
          document.body.classList.remove('booting');
          $('assembly').classList.add('leaving');
        }
      },
      onProgress: (k) => {
        $('a-bar-fill').style.width = `${(k * 100).toFixed(1)}%`;
      },
      onDone: () => {
        document.body.classList.remove('booting');
        $('assembly').classList.remove('on', 'leaving');
        // The panels were laid out at zero width while the sequence held the frame;
        // the plan canvas needs one redraw against its real size.
        refresh();
      },
    },
  );

  const skip = (): void => { if (assembly.playing) assembly.skip(); };
  $('a-skip').onclick = skip;
  viewer.renderer.domElement.addEventListener('pointerdown', skip);
  addEventListener('keydown', (e) => { if (e.code === 'Escape') skip(); });

  return {
    get playing(): boolean { return assembly.playing; },
    start(): void {
      // `boot=1` forces the sequence, `boot=0` refuses it, and absent defers to the
      // operating system. The explicit force exists because a laptop with Reduce Motion
      // switched on would otherwise never show the sequence at all — including, quietly,
      // on a demo machine — and because headless capture reports `reduce` by default.
      const flag = new URLSearchParams(window.location.search).get('boot');
      const wanted = flag === '1'
        || (flag !== '0' && !matchMedia('(prefers-reduced-motion: reduce)').matches);
      if (!wanted) {
        document.body.classList.remove('booting');
        return;
      }
      $('assembly').classList.add('on');
      assembly.play();
    },
  };
}
