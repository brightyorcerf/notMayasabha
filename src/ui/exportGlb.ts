/**
 * GLB export.
 *
 * Takes:   the site meshes and the export permission from the status gate.
 * Returns: a .glb the operator saves locally.
 * Assumes: export is blocked while the scale is unresolved. A model with no scale
 *          exports a confidently wrong building, which is the worst failure we have.
 */

import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';

export async function exportGLB(root: THREE.Object3D, filename: string): Promise<number> {
  const exporter = new GLTFExporter();
  const buf = await new Promise<ArrayBuffer>((resolve, reject) => {
    exporter.parse(
      root,
      (out) => (out instanceof ArrayBuffer ? resolve(out) : reject(new Error('expected binary glTF'))),
      (err) => reject(err),
      { binary: true },
    );
  });
  const blob = new Blob([buf], { type: 'model/gltf-binary' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  return buf.byteLength;
}
