/**
 * A soft vertical gradient for the scene background, in place of a flat colour.
 *
 * Takes:   nothing — the palette is fixed to match the fog colour already in use.
 * Returns: a small equirect-ish CanvasTexture, cheap enough to regenerate on resize.
 * Assumes: nothing samples this as an environment map — it is background only, so it
 *          does not need to be power-of-two or particularly high resolution. The scene's
 *          actual reflections come from `RoomEnvironment` in `viewer.ts`, not this.
 */

import * as THREE from 'three';

const TOP = '#050810';
const HORIZON = '#141c2c';
const BOTTOM = '#0d1117';

export function skyGradient(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 8;
  canvas.height = 256;
  const c = canvas.getContext('2d')!;
  const g = c.createLinearGradient(0, 0, 0, canvas.height);
  g.addColorStop(0, TOP);
  g.addColorStop(0.55, HORIZON);
  g.addColorStop(1, BOTTOM);
  c.fillStyle = g;
  c.fillRect(0, 0, canvas.width, canvas.height);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
