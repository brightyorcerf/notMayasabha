/**
 * Neighbourhood context. The literal reading of "covering the nearby geographical areas".
 *
 * Takes:   an area pack in the OpenStreetMap schema (footprints + road centrelines).
 * Returns: extruded neighbour blocks and flat road ribbons, in metres, in the site frame.
 * Assumes: the pack is bundled at install time. Nothing here fetches a tile.
 *          Neighbour heights come from building:levels at 3.1 m per level. That is an
 *          assumption, and it is labelled as one in the UI.
 */

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Neighbourhood } from '../core/types';
import packJson from '../../fixtures/neighbourhood.json';

export const LEVEL_HEIGHT_M = 3.1;

export function loadPack(): Neighbourhood {
  return packJson as unknown as Neighbourhood;
}

export function buildNeighbourhood(pack: Neighbourhood): THREE.Group {
  const group = new THREE.Group();
  group.name = 'neighbourhood';

  const buildingMat = new THREE.MeshStandardMaterial({ color: 0x39424e, roughness: 1 });
  const roadMat = new THREE.MeshStandardMaterial({ color: 0x23282f, roughness: 1 });

  const buildings: THREE.BufferGeometry[] = [];
  const roads: THREE.BufferGeometry[] = [];

  for (const it of pack.items) {
    if (it.kind === 'BUILDING') {
      const shape = new THREE.Shape();
      it.outline_m.forEach((p, i) => (i === 0 ? shape.moveTo(p[0], p[1]) : shape.lineTo(p[0], p[1])));
      shape.closePath();
      const h = Math.max(1, it.levels) * LEVEL_HEIGHT_M;
      const geo = new THREE.ExtrudeGeometry(shape, { depth: h, bevelEnabled: false });
      // Extrusion runs along +Z of the shape plane. Lay it down so height becomes +Y.
      geo.rotateX(-Math.PI / 2);
      buildings.push(geo);
    } else {
      for (let i = 0; i + 1 < it.outline_m.length; i++) {
        const [ax, ay] = it.outline_m[i];
        const [bx, by] = it.outline_m[i + 1];
        const len = Math.hypot(bx - ax, by - ay);
        const geo = new THREE.BoxGeometry(len, 0.04, it.width_m);
        geo.applyMatrix4(
          new THREE.Matrix4()
            .makeTranslation((ax + bx) / 2, 0.0, (ay + by) / 2)
            .multiply(new THREE.Matrix4().makeRotationY(Math.atan2(-(by - ay), bx - ax))),
        );
        roads.push(geo);
      }
    }
  }

  if (roads.length) {
    const m = new THREE.Mesh(mergeGeometries(roads, false), roadMat);
    m.receiveShadow = true;
    m.userData = { kind: 'road' };
    group.add(m);
  }
  if (buildings.length) {
    const m = new THREE.Mesh(mergeGeometries(buildings, false), buildingMat);
    m.castShadow = true; m.receiveShadow = true;
    m.userData = { kind: 'neighbour' };
    group.add(m);
  }
  return group;
}
